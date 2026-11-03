/* Match logic for the scored game. No DOM and no audio in here: the view
 * (js/app.js) asks for the next question, plays the sound, and passes taps in.
 *
 * Only Notes mode with button answers exists so far.
 *
 * Depends on: MusicData (js/data.js), Store (js/storage.js).
 */
var Game = (function () {
  'use strict';

  var D = MusicData;

  /* ---------- rules (see "Preserve exactly" in CLAUDE.md) ---------- */

  var MATCH_LENGTH = 24;
  var REPLAY_COST = 8;          // health per replay, Medium and Hard only
  var MAX_PENALTY = 200;        // cap per question, so one miss cannot end a match
  var BASE_POINTS = 100;
  var STREAK_BONUS = 10;        // per streak step
  var STREAK_CAP = 10;          // steps counted
  var ADVANCE_DELAY_MS = 1100;  // pause after a graded answer, before the next question
  var SUMMARY_CONFUSIONS = 5;

  var DIFFICULTY = {
    easy:   { label: 'Easy',   health: null },
    medium: { label: 'Medium', health: 800 },
    hard:   { label: 'Hard',   health: 500 }
  };

  // How far off a miss was, by pitch-class distance, for the feedback line.
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
  function correctPoints(streak, rarityMultiplier) {
    var raw = BASE_POINTS + Math.min(streak, STREAK_CAP) * STREAK_BONUS;
    return Math.round(raw * (rarityMultiplier || 1));
  }

  function missSuffix(d) { return MISS_SIZE[d] ? ' — off by ' + MISS_SIZE[d] : ''; }

  // Every selected note in every enabled register, as MIDI numbers.
  function noteCandidates(noteSel, registers) {
    var out = [];
    D.enabledRegisters(registers).forEach(function (reg) {
      noteSel.forEach(function (on, pc) {
        if (on) out.push(D.midiInRegister(pc, reg));
      });
    });
    return out;
  }

  // Uniform pick that never repeats the previous question, unless it is the
  // only candidate.
  function pickQuestion(candidates, previous, rng) {
    var pool = candidates.length > 1
      ? candidates.filter(function (m) { return m !== previous; })
      : candidates;
    return pool[Math.floor(rng() * pool.length)];
  }

  /* ---------- a match ---------- */

  // The question picked last, kept across matches so a new match does not open
  // with the question the last one ended on.
  var previousMidi = null;

  /* options: { difficulty, noteSel: [12 bools], registers: [3 bools], rng? }
   * Settings are read once. Change them by starting a new match, so a score
   * always belongs to one rule set. */
  function createMatch(options) {
    var difficulty = DIFFICULTY[options.difficulty] ? options.difficulty : 'easy';
    var noteSel = options.noteSel.slice();
    var registers = options.registers.slice();
    var rng = options.rng || Math.random;
    var maxHealth = DIFFICULTY[difficulty].health;      // null on Easy
    var hasHealth = maxHealth !== null;

    var candidates = noteCandidates(noteSel, registers);

    var points = 0, streak = 0, hits = 0, answered = 0;
    var health = hasHealth ? maxHealth : 0;
    var over = false, knockedOut = false;

    var question = null;       // { midi, pc, name } while one is pending
    var awaiting = false;      // a question is waiting for its answer
    var roundPlays = 0;        // listens so far this question

    var misses = [];           // { from, to, n } in first-seen order
    var rounds = [];           // { correct, plays } per graded question

    function state() {
      return {
        mode: 'notes',
        difficulty: difficulty,
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
        knockedOut: knockedOut
      };
    }

    // Pick the next question. Returns it, or null once the match is over.
    function nextQuestion() {
      if (over) return null;
      var midi = pickQuestion(candidates, previousMidi, rng);
      previousMidi = midi;
      question = { midi: midi, pc: D.pc(midi), name: D.pcToName(midi) };
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
      Store.pushMatch({
        ts: Date.now(),
        points: points,
        hits: hits,
        answered: answered,
        acc: answered ? hits / answered : 0,
        mode: 'notes',
        method: 'buttons',
        difficulty: difficulty,
        quals: null,
        guess: null,
        playAs: null,
        notes: noteSel.filter(Boolean).length,
        registers: registers.slice(),
        ko: knockedOut
      });
    }

    /* Count one listen of the pending question. Replays cost health on Medium
     * and Hard, and can knock the player out.
     * Returns null if there is nothing to listen to, else
     * { pitches, replay, cost, over, knockedOut }. When `over` is true the
     * match just ended and no sound should play. */
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
          return { pitches: [], replay: true, cost: cost, over: true, knockedOut: true };
        }
      }
      return { pitches: [question.midi], replay: replay, cost: cost, over: false, knockedOut: false };
    }

    /* Grade a tap on a note button. `guessPc` is a pitch class 0-11.
     * Returns null if no question is pending, else
     * { correct, message, delta, targetPc, guessPc, distance, over, knockedOut }
     * where delta is points gained (+), health lost (-), or 0. */
    function answer(guessPc) {
      if (over || !awaiting) return null;
      awaiting = false;

      var targetPc = question.pc;
      var d = D.pcDistance(guessPc, targetPc);
      var correct = d === 0;
      var plays = Math.max(1, roundPlays);

      Store.pushAnswer('note', targetPc, guessPc);
      Store.pushPlay(correct, plays, 'notes');
      answered++;
      rounds.push({ correct: correct, plays: plays });

      var delta = 0, message;
      if (correct) {
        streak++;
        delta = correctPoints(streak, 1);
        points += delta;
        hits++;
        message = 'Correct — ' + question.name;
      } else {
        streak = 0;
        if (hasHealth) {
          delta = -Math.min(notePenalty(d), MAX_PENALTY);
          health += delta;
        }
        message = 'That was ' + question.name + missSuffix(d);
        recordMiss(targetPc, guessPc);
      }

      var dead = hasHealth && health <= 0;
      if (dead || answered >= MATCH_LENGTH) finish(dead);
      Store.saveHistory();

      return {
        correct: correct,
        message: message,
        delta: delta,
        targetPc: targetPc,
        guessPc: guessPc,
        distance: d,
        over: over,
        knockedOut: knockedOut
      };
    }

    function recordMiss(targetPc, guessPc) {
      for (var i = 0; i < misses.length; i++) {
        if (misses[i].from === targetPc && misses[i].to === guessPc) { misses[i].n++; return; }
      }
      misses.push({ from: targetPc, to: guessPc, n: 1 });
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
        points: points,
        hits: hits,
        answered: answered,
        accuracyPct: answered ? Math.round(hits / answered * 100) : 0,
        avgReplays: correctRounds.length ? replays / correctRounds.length : null,
        hasHealth: hasHealth,
        healthLeft: hasHealth ? Math.max(0, health) : null,
        difficultyLabel: DIFFICULTY[difficulty].label,
        knockedOut: knockedOut,
        confusions: shown.map(function (c) {
          return { from: D.pcToName(c.from), to: D.pcToName(c.to), n: c.n };
        }),
        moreMisses: totalMisses - shownCount,
        clean: totalMisses === 0
      };
    }

    return {
      state: state,
      nextQuestion: nextQuestion,
      listen: listen,
      answer: answer,
      summary: summary
    };
  }

  return {
    MATCH_LENGTH: MATCH_LENGTH,
    REPLAY_COST: REPLAY_COST,
    MAX_PENALTY: MAX_PENALTY,
    ADVANCE_DELAY_MS: ADVANCE_DELAY_MS,
    DIFFICULTY: DIFFICULTY,

    notePenalty: notePenalty,
    correctPoints: correctPoints,
    missSuffix: missSuffix,
    noteCandidates: noteCandidates,
    pickQuestion: pickQuestion,
    createMatch: createMatch
  };
})();
