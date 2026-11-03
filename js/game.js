/* Match logic for the scored game. No DOM and no audio in here: the view
 * (js/app.js) asks for the next question, plays the sound, and passes answers
 * in. Every mode shares one match loop (scoring, streak, health, replays,
 * history, summary). A mode only supplies its candidates, its questions and
 * how to grade an answer.
 *
 * Depends on: MusicData (js/data.js), Store (js/storage.js).
 */
var Game = (function () {
  'use strict';

  var D = MusicData;

  /* ---------- rules (see "Preserve exactly" in CLAUDE.md) ---------- */

  var MATCH_LENGTH = 24;
  var REPLAY_COST = 8;            // health per replay, Medium and Hard only
  var MAX_PENALTY = 200;          // cap per question, so one miss cannot end a match
  var BASE_POINTS = 100;
  var CHORD_BOTH_POINTS = 150;    // naming root and type of a chord
  var STREAK_BONUS = 10;          // per streak step
  var STREAK_CAP = 10;            // steps counted
  var WRONG_QUALITY_PENALTY = 75;
  var PIANO_KEY_PENALTY = 45;     // per missed or stray key in a piano chord
  var TIMEOUT_PENALTY = 100;      // flat health cost when the question timer runs out
  var SUMMARY_CONFUSIONS = 5;

  // Weak-note focus: a note's draw weight is 1 + FOCUS_K x (1 - accuracy), from
  // its last FOCUS_WINDOW note answers, and only once it has FOCUS_MIN_ATTEMPTS.
  var FOCUS_K = 3;
  var FOCUS_WINDOW = 100;
  var FOCUS_MIN_ATTEMPTS = 3;
  var FOCUS_LEAN = 1.2;           // weights above this count as "leaning on" a note

  // Pause after a graded answer before the next question, by answer kind.
  // Piano chords get longer so there is time to read the marked keys.
  var DELAY_MS = {
    note: 1100,
    interval: 1200,
    chord: 1100,
    pianoNote: 1100,
    pianoRoot: 1300,
    pianoChord: 1900,
    timeout: 1300
  };

  // Playback spacing in seconds.
  var INTERVAL_GAP = 0.6;
  var ARP_GAP = 0.42;
  var ARP_BLOCK_PAUSE = 0.95;
  var REFERENCE_GAP = 0.7;        // reference note first, then the target

  // Chords are always answered on a fixed two-octave board from C3, plus
  // drawn-but-unplayable keys on top for upper notes of high-rooted chords.
  var CHORD_BOARD = { low: D.REGISTER_LOW, octaves: 2, extra: D.CHORD_REACH };

  var DIFFICULTY = {
    easy:   { label: 'Easy',   health: null },
    medium: { label: 'Medium', health: 800 },
    hard:   { label: 'Hard',   health: 500 }
  };

  var MODES = {
    notes:     { label: 'Notes',     noun: 'note',     plural: 'notes',     title: 'Pitch Trainer',     icon: '\u266a' },
    chords:    { label: 'Chords',    noun: 'chord',    plural: 'chords',    title: 'Chord Recognition', icon: '\u266c' },
    intervals: { label: 'Intervals', noun: 'interval', plural: 'intervals', title: 'Interval Trainer',  icon: '\u266b' }
  };

  // How far off a miss was (pitch-class or interval distance).
  var MISS_SIZE = {
    1: 'a semitone',
    2: 'a whole tone',
    3: 'a minor 3rd',
    4: 'a major 3rd',
    5: 'a 4th',
    6: 'a tritone'
  };

  /* ---------- pure helpers ---------- */

  // 0 if exact, else 25 + 25 x d: 50 at a semitone, 175 at a tritone.
  function notePenalty(d) { return d === 0 ? 0 : 25 + 25 * d; }

  // `streak` is the streak after this answer has been counted.
  function correctPoints(streak, rarityMultiplier, base) {
    var raw = (base || BASE_POINTS) + Math.min(streak, STREAK_CAP) * STREAK_BONUS;
    return Math.round(raw * (rarityMultiplier || 1));
  }

  function missSuffix(d) { return MISS_SIZE[d] ? ' — off by ' + MISS_SIZE[d] : ''; }

  // Interval misses compare sizes, not pitch classes: |guess - answer|, max 6.
  function intervalDistance(a, b) { return Math.min(Math.abs(a - b), 6); }

  function onIndices(sel) {
    var out = [];
    sel.forEach(function (on, i) { if (on) out.push(i); });
    return out;
  }

  function qualityList(qualSel) {
    return D.QUALITY_KEYS.filter(function (k, i) { return qualSel[i]; });
  }

  function intervalList(ivlSel) {
    return D.INTERVALS.filter(function (iv, i) { return ivlSel[i]; }).map(function (iv) { return iv.semi; });
  }

  // All 12 pitch classes, or the pinned one.
  function rootPool(root) {
    return root === 'random' ? D.NOTES.map(function (n, i) { return i; }) : [root];
  }

  function guessesRoot(s) { return s.mode === 'chords' && s.guessTarget !== 'type'; }
  function guessesType(s) { return s.mode === 'chords' && s.guessTarget !== 'root'; }

  // Can this setup be answered on the piano? Intervals never; chord type-only
  // never, because playing keys always implies a root.
  function pianoAllowed(s) {
    if (s.mode === 'intervals') return false;
    if (s.mode === 'chords' && s.guessTarget === 'type') return false;
    return true;
  }

  // The input actually used: the saved method unless the setup forbids piano.
  function effectiveMethod(s) {
    return pianoAllowed(s) && s.method === 'piano' ? 'piano' : 'buttons';
  }

  // The note pool registers for a mode. Intervals share the Notes registers.
  function registersFor(s) {
    return s.mode === 'chords' ? s.chordRegisters : s.registers;
  }

  // Why a setup cannot start, or null if it can.
  function setupProblem(s) {
    if (D.enabledRegisters(registersFor(s)).length === 0) return 'Turn on at least one register.';
    if (s.mode === 'notes' && onIndices(s.noteSel).length < 2) return 'Pick at least 2 notes.';
    if (s.mode === 'intervals' && intervalList(s.ivlSel).length < 2) return 'Pick at least 2 intervals.';
    if (s.mode === 'chords') {
      var n = qualityList(s.qualSel).length;
      if (n < 1) return 'Pick at least 1 chord type.';
      if (s.guessTarget === 'type' && n < 2) return 'Guessing the type needs at least 2 chord types.';
    }
    return null;
  }

  // The piano board for a setup: { low, octaves, extra }.
  function boardFor(s) {
    if (s.mode === 'chords') return { low: CHORD_BOARD.low, octaves: CHORD_BOARD.octaves, extra: CHORD_BOARD.extra };
    var on = D.enabledRegisters(s.registers);
    return { low: D.REGISTER_LOW + on[0] * 12, octaves: on[on.length - 1] - on[0] + 1, extra: 0 };
  }

  // Quality whose shape is exactly these offsets from the lowest note, or null.
  function shapeToQuality(offsets) {
    for (var i = 0; i < D.QUALITY_KEYS.length; i++) {
      var shape = D.CHORDS[D.QUALITY_KEYS[i]].intervals;
      if (shape.length === offsets.length && shape.every(function (v, j) { return v === offsets[j]; })) {
        return D.QUALITY_KEYS[i];
      }
    }
    return null;
  }

  // Uniform pick that never repeats the previous question, unless it is the
  // only candidate.
  function pickQuestion(candidates, previous, rng) {
    var pool = candidates.length > 1
      ? candidates.filter(function (k) { return k !== previous; })
      : candidates;
    return pool[Math.floor(rng() * pool.length)];
  }

  // Weighted pick that never repeats the previous question, unless it is the
  // only candidate. `weightOf(candidate)` gives each candidate's draw weight.
  function pickWeighted(candidates, weightOf, previous, rng) {
    var pool = candidates.length > 1
      ? candidates.filter(function (k) { return k !== previous; })
      : candidates;
    var weights = pool.map(weightOf);
    var total = weights.reduce(function (a, b) { return a + b; }, 0);
    var r = rng() * total;
    for (var i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r <= 0) return pool[i];
    }
    return pool[pool.length - 1];
  }

  // Draw weights for the 12 pitch classes from recent history: 1 for a note
  // with too few attempts, else 1 + 3 x (1 - accuracy). A note missed half the
  // time comes up about 2.5 times as often as one that is always right.
  function noteWeights(answers) {
    var attempts = {}, right = {};
    (answers || []).filter(function (a) { return a.k === 'note'; })
      .slice(-FOCUS_WINDOW)
      .forEach(function (a) {
        attempts[a.t] = (attempts[a.t] || 0) + 1;
        if (a.g === a.t) right[a.t] = (right[a.t] || 0) + 1;
      });
    return D.NOTES.map(function (n, pc) {
      var tries = attempts[pc] || 0;
      return tries >= FOCUS_MIN_ATTEMPTS ? 1 + FOCUS_K * (1 - (right[pc] || 0) / tries) : 1;
    });
  }

  // For the setup screen: how many of the selected notes the focus leans on.
  function focusInfo(settings, answers) {
    var weights = noteWeights(answers);
    var leaning = onIndices(settings.noteSel).filter(function (pc) { return weights[pc] > FOCUS_LEAN; }).length;
    return { weights: weights, leaning: leaning };
  }

  /* ---------- candidates and questions, per mode ---------- */

  // Every selected note in every enabled register, as MIDI numbers.
  function noteCandidates(noteSel, registers) {
    var out = [];
    D.enabledRegisters(registers).forEach(function (reg) {
      onIndices(noteSel).forEach(function (pc) { out.push(D.midiInRegister(pc, reg)); });
    });
    return out;
  }

  // Keys are compared with !== to avoid repeats, so they are numbers or strings.
  function candidatesFor(s) {
    var out = [];
    if (s.mode === 'notes') return noteCandidates(s.noteSel, s.registers);
    var regs = D.enabledRegisters(registersFor(s));
    if (s.mode === 'intervals') {
      var semis = intervalList(s.ivlSel);
      regs.forEach(function (reg) {
        rootPool(s.ivlRoot).forEach(function (pc) {
          semis.forEach(function (semi) { out.push(D.midiInRegister(pc, reg) + '|' + semi); });
        });
      });
      return out;
    }
    var quals = qualityList(s.qualSel);
    regs.forEach(function (reg) {
      rootPool(s.chordRoot).forEach(function (pc) {
        quals.forEach(function (q) { out.push(D.midiInRegister(pc, reg) + '|' + q); });
      });
    });
    return out;
  }

  function makeQuestion(s, key, rng) {
    if (s.mode === 'notes') {
      // With a reference pitch set, it sounds first and the target follows.
      var ref = s.refPitch || 0;
      return {
        key: key, midi: key, pc: D.pc(key), name: D.pcToName(key), mult: 1,
        pitches: ref ? [ref, key] : [key],
        gap: ref ? REFERENCE_GAP : 0, blockAfter: 0
      };
    }
    var parts = String(key).split('|');
    var low = parseInt(parts[0], 10);
    if (s.mode === 'intervals') {
      var semi = parseInt(parts[1], 10);
      var desc = s.ivlDir === 'desc' || (s.ivlDir === 'mixed' && rng() < 0.5);
      var iv = D.intervalBySemi(semi);
      return {
        key: key, low: low, semi: semi, descending: desc,
        text: iv.label + ' (' + iv.name + ')' + (desc ? ' descending' : ''),
        pitches: desc ? [low + semi, low] : [low, low + semi],
        gap: INTERVAL_GAP, blockAfter: 0
      };
    }
    var q = parts[1];
    var arp = s.chordPlay === 'arp';
    return {
      key: key, rootMidi: low, rootPc: D.pc(low), quality: q,
      text: D.chordName(D.pc(low), q),
      pitches: D.chordPitches(low, q),
      gap: arp ? ARP_GAP : 0, blockAfter: arp ? ARP_BLOCK_PAUSE : 0
    };
  }

  /* ---------- a match ---------- */

  // The question picked last, kept across matches so a new match does not open
  // with the question the last one ended on.
  var previousKey = null;

  /* `settings` is a full settings object (see Store.defaultSettings). It is
   * copied once: change settings by starting a new match, so a score always
   * belongs to one rule set. Only the input method may change mid-match, and
   * it is passed with each answer. `rng` is optional, for testing. */
  function createMatch(settings, rng) {
    rng = rng || Math.random;
    // A validated copy: missing or bad fields fall back to defaults.
    var s = Store.normalizeSettings(settings);
    var mode = s.mode;
    var maxHealth = DIFFICULTY[s.difficulty].health;      // null on Easy
    var hasHealth = maxHealth !== null;
    var quals = qualityList(s.qualSel);
    var candidates = candidatesFor(s);

    var points = 0, streak = 0, hits = 0, answered = 0;
    var health = hasHealth ? maxHealth : 0;
    var over = false, knockedOut = false;
    var lastMethod = effectiveMethod(s);

    var question = null;       // the pending question
    var awaiting = false;      // a question is waiting for its answer
    var roundPlays = 0;        // listens so far this question

    var misses = [];           // { kind, from, to, n } in first-seen order
    var rounds = [];           // { correct, plays } per graded question

    function state() {
      return {
        mode: mode,
        difficulty: s.difficulty,
        points: points,
        streak: streak,
        hits: hits,
        answered: answered,
        total: MATCH_LENGTH,
        questionNumber: Math.min(answered + 1, MATCH_LENGTH),
        hasHealth: hasHealth,
        health: hasHealth ? Math.max(0, health) : null,
        maxHealth: maxHealth,
        awaiting: awaiting,
        roundPlays: roundPlays,
        over: over,
        knockedOut: knockedOut,
        question: question
      };
    }

    // Pick the next question. Returns it, or null once the match is over.
    function nextQuestion() {
      if (over) return null;
      var key, mult = 1;
      if (mode === 'notes' && s.focusWeak) {
        // Weights come from history as it stands now, so they follow the match.
        var w = noteWeights(Store.history().answers);
        var pool = onIndices(s.noteSel);
        var totalW = pool.reduce(function (sum, pc) { return sum + w[pc]; }, 0);
        key = pickWeighted(candidates, function (m) { return w[D.pc(m)]; }, previousKey, rng);
        // A note drawn twice as often pays half, so a focused match and an even
        // one are worth about the same at equal skill.
        mult = (totalW / pool.length) / w[D.pc(key)];
      } else {
        key = pickQuestion(candidates, previousKey, rng);
      }
      previousKey = key;
      question = makeQuestion(s, key, rng);
      question.mult = mult;
      awaiting = true;
      roundPlays = 0;
      return question;
    }

    function finish(ko) {
      over = true;
      knockedOut = !!ko;
      awaiting = false;
      // Same fields, names and types the old app wrote, so old and new
      // matches sit together in one history.
      var isChords = mode === 'chords';
      Store.pushMatch({
        ts: Date.now(),
        points: points,
        hits: hits,
        answered: answered,
        acc: answered ? hits / answered : 0,
        mode: mode,
        method: lastMethod,
        difficulty: s.difficulty,
        quals: isChords ? quals.join('+') : null,
        guess: isChords ? s.guessTarget : null,
        playAs: isChords ? s.chordPlay : null,
        notes: onIndices(s.noteSel).length,
        registers: registersFor(s).slice(),
        ko: knockedOut
      });
    }

    /* Count one listen of the pending question. Replays cost health on Medium
     * and Hard, and can knock the player out.
     * Returns null if there is nothing to listen to, else
     * { pitches, gap, blockAfter, replay, cost, over, knockedOut }. When `over`
     * is true the match just ended and no sound should play. */
    function listen() {
      if (over || !awaiting) return null;
      roundPlays++;
      var replay = roundPlays > 1;
      var cost = replay && hasHealth ? REPLAY_COST : 0;
      if (cost) {
        health -= cost;
        if (health <= 0) {
          finish(true);
          Store.saveHistory();
          return { pitches: [], gap: 0, blockAfter: 0, replay: true, cost: cost, over: true, knockedOut: true };
        }
      }
      return {
        pitches: question.pitches.slice(), gap: question.gap, blockAfter: question.blockAfter,
        replay: replay, cost: cost, over: false, knockedOut: false
      };
    }

    function canAnswer(forMode) { return !over && awaiting && mode === forMode; }

    /* The shared end of every answer. `grade` is
     *   { correct, penalty, base, message, delay, method, logs: [[kind, target, guess]], detail }
     * Returns { correct, message, delta, delay, over, knockedOut, ...detail }
     * where delta is points gained (+), health lost (-), or 0. */
    function settle(grade) {
      awaiting = false;
      lastMethod = grade.method;
      var plays = Math.max(1, roundPlays);

      grade.logs.forEach(function (log) {
        Store.pushAnswer(log[0], log[1], log[2]);
        if (String(log[1]) !== String(log[2])) recordMiss(log[0], log[1], log[2]);
      });
      Store.pushPlay(grade.correct, plays, mode);
      answered++;
      rounds.push({ correct: grade.correct, plays: plays });

      var delta = 0;
      if (grade.correct) {
        streak++;
        delta = correctPoints(streak, grade.mult, grade.base);
        points += delta;
        hits++;
      } else {
        streak = 0;
        if (hasHealth) {
          delta = -Math.min(grade.penalty, MAX_PENALTY);
          health += delta;
        }
      }

      var dead = hasHealth && health <= 0;
      if (dead || answered >= MATCH_LENGTH) finish(dead);
      Store.saveHistory();

      var out = {
        correct: grade.correct,
        message: grade.message,
        delta: delta,
        delay: grade.delay,
        over: over,
        knockedOut: knockedOut
      };
      Object.keys(grade.detail || {}).forEach(function (k) { out[k] = grade.detail[k]; });
      return out;
    }

    function recordMiss(kind, from, to) {
      from = String(from); to = String(to);
      for (var i = 0; i < misses.length; i++) {
        var m = misses[i];
        if (m.kind === kind && m.from === from && m.to === to) { m.n++; return; }
      }
      misses.push({ kind: kind, from: from, to: to, n: 1 });
    }

    /* ---------- answers ---------- */

    /* Notes: a pitch class from a button, or a piano key (`pianoMidi`), which
     * answers by pitch class in any octave.
     * detail: { targetPc, guessPc, targetMidi, guessMidi } */
    function answerNote(guessPc, pianoMidi) {
      if (!canAnswer('notes')) return null;
      var viaPiano = typeof pianoMidi === 'number';
      if (viaPiano) guessPc = D.pc(pianoMidi);
      var d = D.pcDistance(guessPc, question.pc);
      var correct = d === 0;
      // On the piano the octave is visible, so name it.
      var name = viaPiano ? D.midiToName(question.midi) : question.name;
      return settle({
        correct: correct,
        penalty: notePenalty(d),
        base: BASE_POINTS,
        mult: question.mult,
        message: correct ? 'Correct — ' + name : 'That was ' + name + missSuffix(d),
        delay: viaPiano ? DELAY_MS.pianoNote : DELAY_MS.note,
        method: viaPiano ? 'piano' : 'buttons',
        logs: [['note', question.pc, guessPc]],
        detail: { targetPc: question.pc, guessPc: guessPc, targetMidi: question.midi, guessMidi: viaPiano ? pianoMidi : null }
      });
    }

    /* Intervals: a semitone count 1-12.
     * detail: { targetSemi, guessSemi } */
    function answerInterval(guessSemi) {
      if (!canAnswer('intervals')) return null;
      var d = intervalDistance(guessSemi, question.semi);
      var correct = d === 0;
      return settle({
        correct: correct,
        penalty: notePenalty(d),
        base: BASE_POINTS,
        message: correct ? 'Correct — ' + question.text : 'That was ' + question.text + missSuffix(d),
        delay: DELAY_MS.interval,
        method: 'buttons',
        logs: [['ivl', question.semi, guessSemi]],
        detail: { targetSemi: question.semi, guessSemi: guessSemi }
      });
    }

    // The halves of a chord answer that the player has to give. The type is
    // filled in when only one quality is in play.
    function chordNeeds() {
      return { root: guessesRoot(s), type: guessesType(s) && quals.length > 1 };
    }

    /* Chords by buttons. Pass the halves the player chose; halves not being
     * asked count as given. Returns null until every needed half is given.
     * detail: { targetRoot, guessRoot, targetQual, guessQual } */
    function answerChord(rootPc, qual) {
      if (!canAnswer('chords')) return null;
      var needs = chordNeeds();
      if ((needs.root && (rootPc === null || rootPc === undefined)) || (needs.type && !qual)) return null;
      var askRoot = guessesRoot(s), askType = guessesType(s);
      var guessRoot = askRoot ? rootPc : question.rootPc;
      var guessQual = askType ? (needs.type ? qual : quals[0]) : question.quality;

      var rootOk = guessRoot === question.rootPc;
      var qualOk = guessQual === question.quality;
      var d = D.pcDistance(guessRoot, question.rootPc);
      var penalty = (rootOk ? 0 : notePenalty(d)) + (qualOk ? 0 : WRONG_QUALITY_PENALTY);

      var message;
      if (rootOk && qualOk) message = 'Correct — ' + question.text;
      else if (askRoot && askType && qualOk) message = 'Right type, wrong root — ' + question.text;
      else if (askRoot && askType && rootOk) message = 'Right root, wrong type — ' + question.text;
      else if (askRoot && !askType) message = 'That was ' + question.text + missSuffix(d);
      else message = 'That was ' + question.text;

      var logs = [];
      if (askRoot) logs.push(['root', question.rootPc, guessRoot]);
      if (askType) logs.push(['qual', question.quality, guessQual]);

      return settle({
        correct: rootOk && qualOk,
        penalty: penalty,
        base: askRoot && askType ? CHORD_BOTH_POINTS : BASE_POINTS,
        message: message,
        delay: DELAY_MS.chord,
        method: 'buttons',
        logs: logs,
        detail: { targetRoot: question.rootPc, guessRoot: guessRoot, targetQual: question.quality, guessQual: guessQual }
      });
    }

    /* Chords on the piano, root only: one key, any octave.
     * detail: { keys: { ok, no, missed } } as MIDI lists to mark on the board. */
    function answerChordRoot(midi) {
      if (!canAnswer('chords') || s.guessTarget !== 'root') return null;
      var guessPc = D.pc(midi);
      var d = D.pcDistance(guessPc, question.rootPc);
      var correct = d === 0;
      return settle({
        correct: correct,
        penalty: notePenalty(d),
        base: BASE_POINTS,
        message: correct ? 'Correct — ' + question.text : 'That was ' + question.text + missSuffix(d),
        delay: DELAY_MS.pianoRoot,
        method: 'piano',
        logs: [['root', question.rootPc, guessPc]],
        detail: { keys: { ok: correct ? [midi] : [], no: correct ? [] : [midi], missed: correct ? [] : [CHORD_BOARD.low + question.rootPc] } }
      });
    }

    // The keys of the pending chord on the practice board, starting at
    // `preferredRoot` (a MIDI key) or, if null, in the lowest octave. Pulled
    // down an octave if the top note would run off the drawn board.
    function chordKeysOnBoard(preferredRoot) {
      var shape = D.CHORDS[question.quality].intervals;
      var boardTop = CHORD_BOARD.low + CHORD_BOARD.octaves * 12 - 1 + CHORD_BOARD.extra;
      var anchor = preferredRoot === null ? CHORD_BOARD.low + question.rootPc : preferredRoot;
      if (anchor + shape[shape.length - 1] > boardTop) anchor -= 12;
      return shape.map(function (i) { return anchor + i; });
    }

    /* Chords on the piano, root and type: the set of keys pressed.
     * Octave-agnostic but voicing-sensitive: the lowest key names the root and
     * the gaps above it must match the chord's shape exactly. C-E-G anywhere
     * is right; E-G-C reads as an E chord and is wrong.
     * Each missed or stray key costs 45. A shape that is no known chord logs
     * the root only.
     * detail: { keys: { ok, no, missed } } */
    function answerChordKeys(midis) {
      if (!canAnswer('chords') || s.guessTarget !== 'both' || !midis || !midis.length) return null;
      var sel = midis.slice().sort(function (a, b) { return a - b; })
        .filter(function (m, i, a) { return i === 0 || m !== a[i - 1]; });
      var shape = D.CHORDS[question.quality].intervals;
      var offsets = sel.map(function (m) { return m - sel[0]; });
      var guessRootPc = D.pc(sel[0]);
      var rootOk = guessRootPc === question.rootPc;
      var shapeOk = offsets.length === shape.length && offsets.every(function (v, i) { return v === shape[i]; });
      var correct = rootOk && shapeOk;

      // Show the right chord where the player put it if the root was right,
      // otherwise in the lower octave.
      var expected = chordKeysOnBoard(rootOk ? sel[0] : null);

      var ok = sel.filter(function (m) { return expected.indexOf(m) !== -1; });
      var no = sel.filter(function (m) { return expected.indexOf(m) === -1; });
      var missed = expected.filter(function (m) { return sel.indexOf(m) === -1; });

      var message;
      if (correct) message = 'Correct — ' + question.text;
      else if (rootOk) message = 'Right root, wrong shape — ' + question.text;
      else if (shapeOk) message = 'Right shape, wrong root — ' + question.text;
      else message = 'That was ' + question.text;

      var logs = [['root', question.rootPc, guessRootPc]];
      var playedQual = shapeToQuality(offsets);
      if (playedQual) logs.push(['qual', question.quality, playedQual]);

      return settle({
        correct: correct,
        penalty: (missed.length + no.length) * PIANO_KEY_PENALTY,
        base: CHORD_BOTH_POINTS,
        message: message,
        delay: DELAY_MS.pianoChord,
        method: 'piano',
        logs: logs,
        detail: { keys: { ok: ok, no: no, missed: missed } }
      });
    }

    /* ---------- timeout ---------- */

    /* The question timer ran out. A miss with a flat 100 health penalty. There
     * is no guess, so no answer or confusion pair is logged, but the question
     * still goes into history.plays. `viaPiano` says which input was showing.
     * Returns null if no question is pending, else the same shape as the other
     * answers, with `timedOut: true`, the target fields and, on the piano,
     * `keys.missed` listing the right keys to show. */
    function timeout(viaPiano) {
      if (over || !awaiting) return null;
      var answer, detail = {};
      if (mode === 'notes') {
        answer = viaPiano ? D.midiToName(question.midi) : question.name;
        detail = { targetPc: question.pc, targetMidi: question.midi };
        if (viaPiano) detail.keys = { ok: [], no: [], missed: [question.midi] };
      } else if (mode === 'intervals') {
        answer = question.text;
        detail = { targetSemi: question.semi };
      } else {
        // Type-only asks for the type alone, so the answer is just the type.
        answer = s.guessTarget === 'type' ? D.CHORDS[question.quality].name : question.text;
        detail = { targetRoot: question.rootPc, targetQual: question.quality };
        if (viaPiano) {
          detail.keys = {
            ok: [], no: [],
            missed: s.guessTarget === 'root' ? [CHORD_BOARD.low + question.rootPc] : chordKeysOnBoard(null)
          };
        }
      }
      detail.timedOut = true;
      return settle({
        correct: false,
        penalty: TIMEOUT_PENALTY,
        base: BASE_POINTS,
        mult: 1,
        message: 'Time \u2014 it was ' + answer,
        delay: DELAY_MS.timeout,
        method: viaPiano ? 'piano' : 'buttons',
        logs: [],
        detail: detail
      });
    }

    /* ---------- summary ---------- */

    function missLabel(kind, value) {
      if (kind === 'qual') return D.CHORDS[value] ? D.CHORDS[value].label : value;
      if (kind === 'ivl') { var iv = D.intervalBySemi(+value); return iv ? iv.label : value; }
      return D.pcToName(+value);
    }

    // Stats for the end-of-match screen. Meaningful once the match is over.
    function summary() {
      var correctRounds = rounds.filter(function (r) { return r.correct; });
      var replays = correctRounds.reduce(function (sum, r) { return sum + (r.plays - 1); }, 0);

      // Sorting is stable, so equal counts stay in the order first missed.
      var sorted = misses.slice().sort(function (a, b) { return b.n - a.n; });
      var totalMisses = sorted.reduce(function (sum, c) { return sum + c.n; }, 0);
      var shown = sorted.slice(0, SUMMARY_CONFUSIONS);
      var shownCount = shown.reduce(function (sum, c) { return sum + c.n; }, 0);

      return {
        title: knockedOut ? 'Out of health' : 'Match complete',
        mode: mode,
        points: points,
        hits: hits,
        answered: answered,
        accuracyPct: answered ? Math.round(hits / answered * 100) : 0,
        avgReplays: correctRounds.length ? replays / correctRounds.length : null,
        hasHealth: hasHealth,
        healthLeft: hasHealth ? Math.max(0, health) : null,
        difficultyLabel: DIFFICULTY[s.difficulty].label,
        knockedOut: knockedOut,
        confusions: shown.map(function (c) {
          return {
            from: missLabel(c.kind, c.from),
            to: missLabel(c.kind, c.to),
            tag: c.kind === 'root' ? ' (root)' : '',
            n: c.n
          };
        }),
        moreMisses: totalMisses - shownCount,
        clean: totalMisses === 0
      };
    }

    return {
      mode: mode,
      settings: s,
      qualities: quals,
      intervals: intervalList(s.ivlSel),
      chordNeeds: chordNeeds,
      state: state,
      nextQuestion: nextQuestion,
      listen: listen,
      answerNote: answerNote,
      answerInterval: answerInterval,
      answerChord: answerChord,
      answerChordRoot: answerChordRoot,
      answerChordKeys: answerChordKeys,
      timeout: timeout,
      summary: summary
    };
  }

  return {
    MATCH_LENGTH: MATCH_LENGTH,
    REPLAY_COST: REPLAY_COST,
    MAX_PENALTY: MAX_PENALTY,
    WRONG_QUALITY_PENALTY: WRONG_QUALITY_PENALTY,
    PIANO_KEY_PENALTY: PIANO_KEY_PENALTY,
    DELAY_MS: DELAY_MS,
    CHORD_BOARD: CHORD_BOARD,
    TIMEOUT_PENALTY: TIMEOUT_PENALTY,
    REFERENCE_GAP: REFERENCE_GAP,
    DIFFICULTY: DIFFICULTY,
    MODES: MODES,

    notePenalty: notePenalty,
    correctPoints: correctPoints,
    missSuffix: missSuffix,
    intervalDistance: intervalDistance,
    shapeToQuality: shapeToQuality,
    qualityList: qualityList,
    intervalList: intervalList,
    pianoAllowed: pianoAllowed,
    effectiveMethod: effectiveMethod,
    registersFor: registersFor,
    setupProblem: setupProblem,
    boardFor: boardFor,
    noteCandidates: noteCandidates,
    candidatesFor: candidatesFor,
    pickQuestion: pickQuestion,
    noteWeights: noteWeights,
    focusInfo: focusInfo,
    createMatch: createMatch
  };
})();
