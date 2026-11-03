/* The page: draws the match for all three modes, the input-method toggle,
 * the piano board and the temporary dev setup panel, and wires taps to the
 * game and the audio.
 *
 * Every listener is attached once, at the bottom of this file. Answer
 * buttons, piano keys and setup chips are handled by delegation on their
 * containers, so redrawing them can never stack handlers.
 *
 * Depends on: MusicData, PianoAudio, Store, Keyboard, Game.
 */
(function () {
  'use strict';

  var D = MusicData;
  var $ = function (id) { return document.getElementById(id); };

  var els = {
    card: $('card'), subtitle: $('subtitle'),
    points: $('points'), qNum: $('qNum'), qTotal: $('qTotal'), qLabel: $('qLabel'),
    streak: $('streak'), hits: $('hits'), delta: $('delta'),
    health: $('health'), healthVal: $('healthVal'), healthFill: $('healthFill'),
    game: $('game'), methodRow: $('methodRow'), methodSeg: $('methodSeg'),
    playBtn: $('playBtn'), hint: $('hint'), feedback: $('feedback'), drill: $('drill'),
    answers: $('answers'), pianoWrap: $('pianoWrap'), piano: $('piano'), submitBtn: $('submitBtn'),
    summary: $('summary'), sumTitle: $('sumTitle'), sumPoints: $('sumPoints'),
    sumStats: $('sumStats'), sumBreakdown: $('sumBreakdown'), newMatchBtn: $('newMatchBtn'),
    diffSeg: $('diffSeg'), source: $('source'), storageNote: $('storageNote'),
    setupBody: $('setupBody'), modeSeg: $('modeSeg'), setupProblem: $('setupProblem'),
    noteChips: $('noteChips'), noteCount: $('noteCount'),
    ivlChips: $('ivlChips'), ivlCount: $('ivlCount'), dirSeg: $('dirSeg'), ivlRootSel: $('ivlRootSel'),
    qualChips: $('qualChips'), qualCount: $('qualCount'), chordRootSel: $('chordRootSel'),
    guessSeg: $('guessSeg'), guessNote: $('guessNote'), playSeg: $('playSeg'),
    setupNotes: $('setupNotes'), setupIntervals: $('setupIntervals'), setupChords: $('setupChords')
  };

  var SUBTITLES = {
    notes: 'Name the note you hear.',
    chords: 'Name the chord you hear.',
    intervals: 'Name the interval you hear.'
  };

  var settings = Store.loadSettings();
  Store.loadHistory();

  var match = null;
  var audioReady = false;
  var timer = null;               // pending "next question" or "show summary"
  var guessBeforePin = null;      // chord guess target to restore when the root is unpinned

  // A half-given answer: chord root and type picked so far, piano keys held.
  // Cleared on every new question and whenever the input method changes.
  var partial = { root: null, qual: null, keys: [] };

  /* ---------- small helpers ---------- */

  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function each(list, fn) { Array.prototype.forEach.call(list, fn); }

  function countOn(arr) { return arr.filter(Boolean).length; }

  function clearTimer() {
    if (timer !== null) { clearTimeout(timer); timer = null; }
  }

  function setHint(text) { els.hint.textContent = text; }

  function awaiting() { return !!match && match.state().awaiting; }

  function usingPiano() { return Game.effectiveMethod(settings) === 'piano'; }

  function syncPlayButton() {
    els.playBtn.disabled = !audioReady || !match || match.state().over;
  }

  function syncStorageNote() {
    els.storageNote.classList.toggle('hidden', Store.available());
  }

  // Briefly show "+110" or "-50" on the points cell. Restarting the CSS
  // animation needs a reflow between removing and re-adding the class.
  function flashDelta(n) {
    els.delta.classList.remove('show');
    if (!n) { els.delta.textContent = ''; return; }
    els.delta.textContent = (n > 0 ? '+' : '−') + Math.abs(n);
    els.delta.className = 'delta ' + (n > 0 ? 'plus' : 'minus');
    void els.delta.offsetWidth;
    els.delta.classList.add('show');
  }

  function setActive(container, attr, value) {
    each(container.querySelectorAll('[' + attr + ']'), function (b) {
      var on = b.getAttribute(attr) === String(value);
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  /* ---------- score strip ---------- */

  function renderScore() {
    var s = match ? match.state() : null;
    els.points.textContent = s ? s.points : 0;
    els.streak.textContent = s ? s.streak : 0;
    els.hits.textContent = s ? s.hits : 0;
    els.qNum.textContent = s ? s.questionNumber : 1;
    els.qTotal.textContent = Game.MATCH_LENGTH;
    // The counter names the mode ("chord 3/24"), not always "note".
    els.qLabel.textContent = Game.MODES[settings.mode].noun;

    var showHealth = !!s && s.hasHealth;
    els.health.classList.toggle('hidden', !showHealth);
    if (!showHealth) return;
    var pct = s.health / s.maxHealth * 100;
    els.healthVal.textContent = s.health;
    els.healthFill.style.width = pct + '%';
    els.healthFill.className = 'health-fill' + (pct <= 25 ? ' danger' : pct <= 55 ? ' warn' : '');
  }

  /* ---------- answer area ---------- */

  function resetPartial() {
    partial.root = null;
    partial.qual = null;
    partial.keys = [];
  }

  function answerButton(text, attrs, title) {
    var b = make('button', 'ans-btn', text);
    b.type = 'button';
    b.disabled = !audioReady;
    if (title) b.title = title;
    Object.keys(attrs).forEach(function (k) { b.setAttribute(k, attrs[k]); });
    return b;
  }

  function answerGroup(label, gridClass) {
    var group = make('div', 'ans-group');
    if (label) group.appendChild(make('div', 'ans-label', label));
    var grid = make('div', gridClass);
    group.appendChild(grid);
    els.answers.appendChild(group);
    return grid;
  }

  function renderButtons() {
    var s = match.settings;
    if (s.mode === 'notes') {
      var grid = answerGroup('', 'note-grid');
      s.noteSel.forEach(function (on, pc) {
        if (on) grid.appendChild(answerButton(D.pcToName(pc), { 'data-pc': pc }));
      });
    } else if (s.mode === 'intervals') {
      var ivlGrid = answerGroup('', 'ivl-grid');
      match.intervals.forEach(function (semi) {
        var iv = D.intervalBySemi(semi);
        var label = settings.ivlMethod === 'semitones' ? String(semi) : iv.label;
        ivlGrid.appendChild(answerButton(label, { 'data-semi': semi }, iv.name));
      });
    } else {
      var needs = match.chordNeeds();
      if (needs.root) {
        var rootGrid = answerGroup('Root', 'root-grid');
        D.NOTES.forEach(function (n, pc) { rootGrid.appendChild(answerButton(n, { 'data-root': pc })); });
      }
      if (needs.type) {
        var qualGrid = answerGroup('Type', 'qual-grid');
        match.qualities.forEach(function (q) {
          qualGrid.appendChild(answerButton(D.CHORDS[q].label, { 'data-qual': q }, D.CHORDS[q].name));
        });
      }
    }
  }

  function renderPiano() {
    var s = match.settings;
    var board = Game.boardFor(s);
    Keyboard.render(els.piano, {
      low: board.low,
      octaves: board.octaves,
      extra: board.extra,
      labels: s.mode === 'chords' ? 'letters' : 'octaves',
      // Notes: keys outside the note pool or a switched-off register can never
      // be the answer. Chords: every board key is playable.
      isDead: s.mode === 'notes'
        ? function (m) {
            var reg = D.registerOf(m);
            return reg < 0 || !s.registers[reg] || !s.noteSel[D.pc(m)];
          }
        : null
    });
  }

  function renderDrill() {
    var text = '';
    if (match) {
      var s = match.settings;
      var piano = usingPiano();
      if (s.mode === 'notes' && piano) text = 'Play the note — any octave.';
      else if (s.mode === 'intervals') {
        text = settings.ivlMethod === 'semitones' ? 'How many semitones apart?' : 'Name the interval.';
      } else if (s.mode === 'chords') {
        if (piano && s.guessTarget === 'root') text = 'Play the root of the chord — any octave.';
        else if (piano) text = 'Play the chord in root position, any octave: the lowest key you press is the root.';
        else if (s.guessTarget !== 'root' && match.qualities.length === 1) {
          text = 'Only ' + D.CHORDS[match.qualities[0]].name + ' chords in play — you just need the root.';
        }
      }
    }
    els.drill.textContent = text;
  }

  // Buttons / Piano for Notes and Chords; Names / Semitones for Intervals.
  // Hidden when the setup leaves only one choice (chord type-only).
  function renderMethodRow() {
    var isIntervals = settings.mode === 'intervals';
    var show = !!match && (isIntervals || Game.pianoAllowed(settings));
    els.methodRow.classList.toggle('hidden', !show);
    each(els.methodSeg.querySelectorAll('[data-method]'), function (b) {
      var forIntervals = b.dataset.method === 'names' || b.dataset.method === 'semitones';
      b.classList.toggle('hidden', forIntervals !== isIntervals);
    });
    setActive(els.methodSeg, 'data-method', isIntervals ? settings.ivlMethod : Game.effectiveMethod(settings));
  }

  function syncSubmit() {
    var show = !!match && settings.mode === 'chords' && usingPiano() && match.settings.guessTarget === 'both';
    els.submitBtn.classList.toggle('hidden', !show);
    var n = partial.keys.length;
    els.submitBtn.disabled = !show || !audioReady || !awaiting() || n === 0;
    els.submitBtn.textContent = n ? 'Submit answer (' + n + ' key' + (n > 1 ? 's' : '') + ')' : 'Submit answer';
  }

  // Draw the answer area for the current mode and input method. Drops any
  // half-given answer, keeps the question and the score.
  function renderAnswerArea() {
    resetPartial();
    els.answers.textContent = '';
    els.piano.textContent = '';
    var piano = !!match && usingPiano();
    els.pianoWrap.classList.toggle('hidden', !piano);
    els.card.classList.toggle('wide', piano && !els.game.classList.contains('hidden'));
    if (match) {
      if (piano) renderPiano();
      else renderButtons();
    }
    renderMethodRow();
    renderDrill();
    syncSubmit();
  }

  function clearAnswerMarks() {
    each(els.answers.querySelectorAll('.ans-btn'), function (b) {
      b.classList.remove('correct', 'incorrect', 'selected');
    });
    Keyboard.clearMarks(els.piano);
  }

  function markButton(attr, value, cls) {
    var b = els.answers.querySelector('[' + attr + '="' + value + '"]');
    if (b) b.classList.add(cls);
  }

  // Colour the answer: right in green, wrong in red, right-but-not-chosen
  // piano keys striped.
  function markResult(res) {
    clearAnswerMarks();
    if (res.keys) {
      Keyboard.mark(els.piano, res.keys.ok, 'ok');
      Keyboard.mark(els.piano, res.keys.no, 'no');
      Keyboard.mark(els.piano, res.keys.missed, 'missed');
    } else if (typeof res.guessMidi === 'number') {
      Keyboard.mark(els.piano, [res.guessMidi], res.correct ? 'ok' : 'no');
      if (res.targetMidi !== res.guessMidi) Keyboard.mark(els.piano, [res.targetMidi], res.correct ? 'ok' : 'missed');
    } else if (typeof res.targetPc === 'number') {
      markButton('data-pc', res.targetPc, 'correct');
      if (!res.correct) markButton('data-pc', res.guessPc, 'incorrect');
    } else if (typeof res.targetSemi === 'number') {
      markButton('data-semi', res.targetSemi, 'correct');
      if (!res.correct) markButton('data-semi', res.guessSemi, 'incorrect');
    } else {
      markButton('data-root', res.targetRoot, 'correct');
      if (res.guessRoot !== res.targetRoot) markButton('data-root', res.guessRoot, 'incorrect');
      markButton('data-qual', res.targetQual, 'correct');
      if (res.guessQual !== res.targetQual) markButton('data-qual', res.guessQual, 'incorrect');
    }
  }

  /* ---------- match flow ---------- */

  function startMatch() {
    clearTimer();
    PianoAudio.silenceAll();
    els.summary.classList.add('hidden');
    els.game.classList.remove('hidden');
    els.subtitle.textContent = SUBTITLES[settings.mode];
    flashDelta(0);
    els.feedback.textContent = '';
    els.feedback.className = 'feedback';

    var problem = Game.setupProblem(settings);
    showSetupProblem(problem);
    match = problem ? null : Game.createMatch(settings);
    renderAnswerArea();
    if (match) {
      showNextQuestion();
      setHint(audioReady ? 'tap to listen' : 'loading piano samples…');
    } else {
      renderScore();
      syncPlayButton();
      setHint(problem);
    }
  }

  function showNextQuestion() {
    PianoAudio.silenceAll();
    match.nextQuestion();
    resetPartial();
    clearAnswerMarks();
    els.feedback.textContent = '';
    els.feedback.className = 'feedback';
    flashDelta(0);
    renderScore();
    syncPlayButton();
    syncSubmit();
  }

  function showSummary() {
    clearTimer();
    PianoAudio.silenceAll();
    var s = match.summary();

    els.game.classList.add('hidden');
    els.card.classList.remove('wide');
    els.summary.classList.remove('hidden');
    els.sumTitle.textContent = s.title;
    els.sumPoints.textContent = s.points;

    els.sumStats.textContent = '';
    function row(label, value) {
      els.sumStats.appendChild(make('dt', '', label));
      els.sumStats.appendChild(make('dd', '', value));
    }
    row('Correct', s.hits + ' / ' + s.answered);
    row('Accuracy', s.accuracyPct + '%');
    if (s.avgReplays !== null) row('Replays per correct answer', s.avgReplays.toFixed(1));
    if (s.hasHealth) row('Health left', s.healthLeft);
    else row('Difficulty', s.difficultyLabel);

    els.sumBreakdown.textContent = '';
    if (s.clean) {
      els.sumBreakdown.appendChild(make('div', 'clean', 'Clean sheet — no mistakes this match.'));
    } else {
      els.sumBreakdown.appendChild(make('div', 'break-label', 'Missed this match'));
      s.confusions.forEach(function (c) {
        var r = make('div', 'conf-row');
        var pair = make('span', 'pair');
        pair.appendChild(make('b', '', c.from));
        pair.appendChild(document.createTextNode(' heard as '));
        pair.appendChild(make('b', '', c.to));
        if (c.tag) pair.appendChild(document.createTextNode(c.tag));
        r.appendChild(pair);
        r.appendChild(make('span', 'cnt', c.n + '×'));
        els.sumBreakdown.appendChild(r);
      });
      if (s.moreMisses > 0) els.sumBreakdown.appendChild(make('div', 'more', '+ ' + s.moreMisses + ' more'));
    }

    syncPlayButton();
    syncStorageNote();
    setHint(s.knockedOut ? 'health ran out' : 'all ' + Game.MATCH_LENGTH + ' ' + Game.MODES[s.mode].plural + ' played');
  }

  // After any graded answer: colour it, report it, then move on.
  function showResult(res) {
    if (!res) return;
    markResult(res);
    els.feedback.textContent = res.message;
    els.feedback.className = 'feedback ' + (res.correct ? 'good' : 'bad');
    flashDelta(res.delta);
    renderScore();
    syncPlayButton();
    syncSubmit();

    clearTimer();
    if (res.over) {
      // Leave the feedback on screen for a moment before the summary replaces it.
      timer = setTimeout(showSummary, res.delay);
      setHint(res.knockedOut ? 'health ran out' : 'last one played');
    } else {
      timer = setTimeout(function () {
        timer = null;
        showNextQuestion();
      }, res.delay);
      setHint('tap play for the next one');
    }
  }

  /* ---------- taps: game ---------- */

  function onPlay() {
    if (!match || match.state().over) return;
    // Tapping Play during the pause after an answer skips straight ahead.
    if (!match.state().awaiting) { clearTimer(); showNextQuestion(); }

    var res = match.listen();
    if (!res) return;
    if (res.cost) flashDelta(-res.cost);
    renderScore();

    if (res.over) { showSummary(); return; }

    var s = match.state();
    setHint(res.replay
      ? 'replay ' + (s.roundPlays - 1) + (res.cost ? ' · −' + res.cost + ' health' : '')
      : 'now answer below');
    PianoAudio.playPitches(res.pitches, res.gap, res.blockAfter);
  }

  function onAnswerButton(e) {
    var btn = e.target.closest ? e.target.closest('.ans-btn') : null;
    if (!btn || btn.disabled || !audioReady || !awaiting()) return;

    if (btn.hasAttribute('data-pc')) { showResult(match.answerNote(+btn.getAttribute('data-pc'))); return; }
    if (btn.hasAttribute('data-semi')) { showResult(match.answerInterval(+btn.getAttribute('data-semi'))); return; }

    // Chords: pick halves, submit automatically once every needed half is in.
    if (btn.hasAttribute('data-root')) {
      partial.root = +btn.getAttribute('data-root');
      each(els.answers.querySelectorAll('[data-root]'), function (b) { b.classList.toggle('selected', b === btn); });
    } else if (btn.hasAttribute('data-qual')) {
      partial.qual = btn.getAttribute('data-qual');
      each(els.answers.querySelectorAll('[data-qual]'), function (b) { b.classList.toggle('selected', b === btn); });
    }
    showResult(match.answerChord(partial.root, partial.qual));
  }

  function onPianoKey(e) {
    var midi = Keyboard.keyFromEvent(e);
    if (midi === null || !audioReady || !awaiting()) return;
    var s = match.settings;

    if (s.mode === 'notes') { showResult(match.answerNote(null, midi)); return; }
    if (s.mode !== 'chords') return;
    if (s.guessTarget === 'root') { showResult(match.answerChordRoot(midi)); return; }

    // Root and type: toggle keys, then Submit.
    var i = partial.keys.indexOf(midi);
    if (i === -1) partial.keys.push(midi);
    else partial.keys.splice(i, 1);
    Keyboard.toggle(els.piano, midi, 'sel', i === -1);
    syncSubmit();
  }

  function onSubmit() {
    if (!awaiting() || !partial.keys.length) return;
    showResult(match.answerChordKeys(partial.keys.slice()));
  }

  // Switching input mid-match keeps the question and the score, and drops any
  // half-given answer.
  function onMethod(e) {
    var btn = e.target.closest ? e.target.closest('button[data-method]') : null;
    if (!btn || btn.disabled) return;
    var m = btn.dataset.method;
    if (m === 'names' || m === 'semitones') {
      if (settings.ivlMethod === m) return;
      settings.ivlMethod = m;
    } else {
      if (settings.method === m) return;
      settings.method = m;
    }
    settings = Store.saveSettings(settings);
    renderAnswerArea();
  }

  function onDifficulty(e) {
    var btn = e.target.closest ? e.target.closest('button[data-diff]') : null;
    if (!btn || btn.dataset.diff === settings.difficulty) return;
    // A score has to belong to one rule set, so changing it starts a fresh match.
    settings.difficulty = btn.dataset.diff;
    settings = Store.saveSettings(settings);
    setActive(els.diffSeg, 'data-diff', settings.difficulty);
    startMatch();
    if (match) setHint(Game.DIFFICULTY[settings.difficulty].label + ' — new match');
  }

  /* ---------- dev setup panel (temporary) ---------- */

  function chip(text, attrs) {
    var b = make('button', 'chip', text);
    b.type = 'button';
    Object.keys(attrs).forEach(function (k) { b.setAttribute(k, attrs[k]); });
    return b;
  }

  function fillRootSelect(sel) {
    sel.appendChild(new Option('Random', 'random'));
    D.NOTES.forEach(function (n, pc) { sel.appendChild(new Option(n, String(pc))); });
  }

  // Draw the chips once; syncSetup() only toggles their state.
  function buildSetup() {
    D.NOTES.forEach(function (n, i) { els.noteChips.appendChild(chip(n, { 'data-note': i })); });
    D.INTERVALS.forEach(function (iv, i) { els.ivlChips.appendChild(chip(iv.label, { 'data-ivl': i, title: iv.name })); });
    D.QUALITY_KEYS.forEach(function (k, i) { els.qualChips.appendChild(chip(D.CHORDS[k].label, { 'data-qual-chip': i, title: D.CHORDS[k].name })); });
    each(els.setupBody.querySelectorAll('[data-regs]'), function (row) {
      D.REGISTERS.forEach(function (r) { row.appendChild(chip(r.label, { 'data-reg': r.index })); });
    });
    fillRootSelect(els.ivlRootSel);
    fillRootSelect(els.chordRootSel);
  }

  function syncChips(container, attr, sel) {
    each(container.querySelectorAll('[' + attr + ']'), function (b) {
      var on = !!sel[+b.getAttribute(attr)];
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function syncSetup() {
    var m = settings.mode;
    setActive(els.modeSeg, 'data-mode', m);
    els.setupNotes.classList.toggle('hidden', m !== 'notes');
    els.setupIntervals.classList.toggle('hidden', m !== 'intervals');
    els.setupChords.classList.toggle('hidden', m !== 'chords');

    syncChips(els.noteChips, 'data-note', settings.noteSel);
    els.noteCount.textContent = countOn(settings.noteSel) + ' of 12';
    syncChips(els.ivlChips, 'data-ivl', settings.ivlSel);
    els.ivlCount.textContent = countOn(settings.ivlSel) + ' of 12';
    syncChips(els.qualChips, 'data-qual-chip', settings.qualSel);
    els.qualCount.textContent = countOn(settings.qualSel) + ' of 9';
    each(els.setupBody.querySelectorAll('[data-regs]'), function (row) {
      syncChips(row, 'data-reg', settings[row.getAttribute('data-regs')]);
    });

    setActive(els.dirSeg, 'data-dir', settings.ivlDir);
    setActive(els.guessSeg, 'data-guess', settings.guessTarget);
    setActive(els.playSeg, 'data-play', settings.chordPlay);
    els.ivlRootSel.value = String(settings.ivlRoot);
    els.chordRootSel.value = String(settings.chordRoot);

    // A pinned root is already known, so only the type can be asked.
    var pinned = settings.chordRoot !== 'random';
    each(els.guessSeg.querySelectorAll('[data-guess]'), function (b) {
      b.disabled = pinned && b.dataset.guess !== 'type';
    });
    els.guessNote.textContent = pinned ? 'root is pinned, so type only'
      : settings.guessTarget === 'type' ? 'answered with buttons' : '';
  }

  function showSetupProblem(text) {
    els.setupProblem.textContent = text || '';
    els.setupProblem.classList.toggle('hidden', !text);
  }

  // Turn an entry of a [bool] selection on or off, keeping at least `min` on.
  function toggleKeepingMin(sel, i, min, what) {
    if (sel[i] && countOn(sel) <= min) {
      showSetupProblem('Keep at least ' + min + ' ' + what + '.');
      return false;
    }
    sel[i] = !sel[i];
    return true;
  }

  // Pinning a chord root forces type-only; unpinning restores the earlier target.
  function setChordRoot(value) {
    var wasPinned = settings.chordRoot !== 'random';
    settings.chordRoot = value;
    if (value !== 'random') {
      if (settings.guessTarget !== 'type') guessBeforePin = settings.guessTarget;
      settings.guessTarget = 'type';
    } else if (wasPinned && guessBeforePin) {
      settings.guessTarget = guessBeforePin;
      guessBeforePin = null;
    }
  }

  function enforceChordRules() {
    if (settings.chordRoot !== 'random') settings.guessTarget = 'type';
  }

  // Any setup change saves and starts a fresh match.
  function applySetup() {
    enforceChordRules();
    settings = Store.saveSettings(settings);
    syncSetup();
    startMatch();
    if (match) setHint('New ' + Game.MODES[settings.mode].label.toLowerCase() + ' match — tap to listen');
  }

  function onSetupClick(e) {
    var b = e.target.closest ? e.target.closest('button') : null;
    if (!b || b.disabled) return;
    var changed = true;

    if (b.hasAttribute('data-mode')) {
      if (settings.mode === b.dataset.mode) return;
      settings.mode = b.dataset.mode;
    } else if (b.hasAttribute('data-note')) {
      changed = toggleKeepingMin(settings.noteSel, +b.dataset.note, 2, 'notes');
    } else if (b.hasAttribute('data-npreset')) {
      settings.noteSel = D.NOTES.map(function (n) {
        return b.dataset.npreset === 'all' || D.NATURALS.indexOf(n) !== -1;
      });
    } else if (b.hasAttribute('data-reg')) {
      var key = b.closest('[data-regs]').getAttribute('data-regs');
      changed = toggleKeepingMin(settings[key], +b.dataset.reg, 1, 'register');
    } else if (b.hasAttribute('data-ivl')) {
      changed = toggleKeepingMin(settings.ivlSel, +b.dataset.ivl, 2, 'intervals');
    } else if (b.hasAttribute('data-ipreset')) {
      var semis = D.INTERVAL_PRESETS[b.dataset.ipreset];
      settings.ivlSel = D.INTERVALS.map(function (iv) { return semis.indexOf(iv.semi) !== -1; });
    } else if (b.hasAttribute('data-dir')) {
      settings.ivlDir = b.dataset.dir;
    } else if (b.hasAttribute('data-qual-chip')) {
      changed = toggleKeepingMin(settings.qualSel, +b.getAttribute('data-qual-chip'), 1, 'chord type');
    } else if (b.hasAttribute('data-qpreset')) {
      var keys = D.QUALITY_PRESETS[b.dataset.qpreset];
      settings.qualSel = D.QUALITY_KEYS.map(function (k) { return keys.indexOf(k) !== -1; });
    } else if (b.hasAttribute('data-guess')) {
      settings.guessTarget = b.dataset.guess;
      guessBeforePin = null;
    } else if (b.hasAttribute('data-play')) {
      settings.chordPlay = b.dataset.play;
    } else {
      return;
    }
    if (changed) applySetup();
  }

  function onSetupChange(e) {
    var t = e.target;
    if (t !== els.ivlRootSel && t !== els.chordRootSel) return;
    var value = t.value === 'random' ? 'random' : parseInt(t.value, 10);
    if (t === els.ivlRootSel) settings.ivlRoot = value;
    else setChordRoot(value);
    applySetup();
  }

  /* ---------- wiring (once) ---------- */

  els.playBtn.addEventListener('click', onPlay);
  els.answers.addEventListener('click', onAnswerButton);
  els.piano.addEventListener('click', onPianoKey);
  els.submitBtn.addEventListener('click', onSubmit);
  els.methodSeg.addEventListener('click', onMethod);
  els.diffSeg.addEventListener('click', onDifficulty);
  els.newMatchBtn.addEventListener('click', startMatch);
  els.setupBody.addEventListener('click', onSetupClick);
  els.setupBody.addEventListener('change', onSetupChange);

  PianoAudio.onReady(function (label, kind) {
    audioReady = true;
    els.source.textContent = label;
    els.source.className = kind === 'samples' ? 'samples' : 'synth';
    // Redraw so the answer buttons come up enabled. Nothing can have been
    // answered yet, so there is no partial answer to lose.
    if (match && !match.state().over) {
      renderAnswerArea();
      setHint('tap to listen');
    }
    syncPlayButton();
    syncSubmit();
  });

  enforceChordRules();
  buildSetup();
  syncSetup();
  setActive(els.diffSeg, 'data-diff', settings.difficulty);
  syncStorageNote();
  startMatch();
  PianoAudio.init();
})();
