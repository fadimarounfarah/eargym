/* The page: navigation between the tabs and, inside Practice, the menu, the
 * setup screen and the match, the match itself (all three modes, buttons or piano), the question timer,
 * and the progress cards on the menu.
 *
 * Every listener is attached once, at the bottom of this file or in
 * Setup.init(). Answer buttons and piano keys are handled by delegation on
 * their containers, so redrawing them can never stack handlers.
 *
 * Depends on: MusicData, PianoAudio, Store, Keyboard, Game, Setup, Learn.
 */
(function () {
  'use strict';

  var D = MusicData;
  var $ = function (id) { return document.getElementById(id); };

  var els = {
    card: $('card'), title: $('title'), subtitle: $('subtitle'),
    tabs: $('tabs'),
    menuView: $('menuView'), menuList: $('menuList'),
    setupView: $('setupView'), gameView: $('gameView'), learnView: $('learnView'),
    gameBack: $('gameBack'), methodSeg: $('methodSeg'), methodNote: $('methodNote'),
    points: $('points'), qNum: $('qNum'), qTotal: $('qTotal'), qLabel: $('qLabel'),
    streak: $('streak'), hits: $('hits'), delta: $('delta'),
    health: $('health'), healthVal: $('healthVal'), healthFill: $('healthFill'),
    game: $('game'), playBtn: $('playBtn'), hint: $('hint'),
    timerTrack: $('timerTrack'), timerFill: $('timerFill'),
    feedback: $('feedback'), drill: $('drill'),
    answers: $('answers'), pianoWrap: $('pianoWrap'), piano: $('piano'), submitBtn: $('submitBtn'),
    summary: $('summary'), sumTitle: $('sumTitle'), sumPoints: $('sumPoints'),
    sumStats: $('sumStats'), sumBreakdown: $('sumBreakdown'), newMatchBtn: $('newMatchBtn'),
    source: $('source'), storageNote: $('storageNote')
  };

  var SUBTITLES = {
    notes: { buttons: 'Listen, then name the note.', piano: 'Listen, then play the note you hear.' },
    chords: { buttons: 'Listen, then name the chord.', piano: 'Listen, then play every note in the chord.' },
    intervals: { buttons: 'Listen to two notes, then name the distance.' }
  };

  var MENU_RECENT_MATCHES = 5;
  var TIMER_TICK_MS = 50;

  Store.loadSettings();
  Store.loadHistory();

  var view = 'menu';              // menu | setup | game (Practice tab), or learn (Learn tab)
  var match = null;
  var audioReady = false;
  var timer = null;               // pending "next question" or "show summary"
  var qTimer = null;              // the running question countdown

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

  function clearTimer() {
    if (timer !== null) { clearTimeout(timer); timer = null; }
  }

  function setHint(text) { els.hint.textContent = text; }

  function awaiting() { return !!match && match.state().awaiting; }

  function usingPiano() { return Game.effectiveMethod(Store.settings()) === 'piano'; }

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

  /* ---------- navigation ---------- */

  // The card widens only while a piano board is on screen: the answer board in
  // a match, or the Learn tab.
  function updateWidth() {
    var piano = view === 'game' && !!match && usingPiano() && els.summary.classList.contains('hidden');
    els.card.classList.toggle('wide', piano || view === 'learn');
  }

  function updateHeading() {
    var mode = Store.settings().mode;
    var meta = Game.MODES[mode];
    if (view === 'learn') {
      els.title.textContent = 'Learn ' + Game.MODES[Store.settings().learnMode].label;
      els.subtitle.textContent = 'Explore freely \u2014 nothing is scored here.';
    } else if (view === 'menu') {
      els.title.textContent = 'Ear Trainer';
      els.subtitle.textContent = 'Train a skill.';
    } else if (view === 'setup') {
      els.title.textContent = 'Set up your match';
      els.subtitle.textContent = 'Choose what to practice.';
    } else {
      els.title.textContent = meta.title;
      var subs = SUBTITLES[mode];
      els.subtitle.textContent = subs[Game.effectiveMethod(Store.settings())] || subs.buttons;
    }
  }

  function showView(name) {
    // Leaving Learn silences it, so nothing keeps sounding behind another screen.
    if (view === 'learn' && name !== 'learn') Learn.hide();
    view = name;
    els.menuView.classList.toggle('hidden', name !== 'menu');
    els.setupView.classList.toggle('hidden', name !== 'setup');
    els.gameView.classList.toggle('hidden', name !== 'game');
    els.learnView.classList.toggle('hidden', name !== 'learn');
    each(els.tabs.querySelectorAll('[data-tab]'), function (t) {
      var on = t.getAttribute('data-tab') === (name === 'learn' ? 'learn' : 'practice');
      t.classList.toggle('active', on);
      if (on) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    });
    if (name === 'menu') renderMenu();
    if (name === 'learn') Learn.show();
    updateHeading();
    updateWidth();
  }

  // Practice and Learn. Leaving a match for another tab abandons it.
  function onTab(e) {
    var tab = e.target.closest ? e.target.closest('button[data-tab]') : null;
    if (!tab || tab.disabled) return;
    var name = tab.getAttribute('data-tab');
    if (name === 'learn' && view !== 'learn') {
      if (view === 'game') { stopMatchActivity(); match = null; }
      showView('learn');
    } else if (name === 'practice' && view === 'learn') {
      showView('menu');
    }
  }

  // The setup screen's "Refresher" link: Learn opens on the same sub-mode.
  function openLearnFor() {
    Store.change(function (s) { s.learnMode = s.mode; });
    showView('learn');
  }

  // Learn's "Practice this": apply the change, then start a match straight
  // away. If those settings cannot start a match, show the setup screen so the
  // reason is visible and can be fixed.
  function practiceFromLearn(patch) {
    Store.change(patch);
    Setup.sync();
    if (Game.setupProblem(Store.settings())) { showView('setup'); return; }
    startFromSetup();
  }

  // Stop anything tied to a running match. Used when leaving the game view.
  function stopMatchActivity() {
    clearTimer();
    stopQuestionTimer();
    PianoAudio.silenceAll();
  }

  /* ---------- menu ---------- */

  // The bar shows average accuracy over the last 5 matches of that exercise, so
  // the card reflects real progress rather than being decorative.
  function renderMenu() {
    var matches = Store.history().matches;
    Object.keys(Game.MODES).forEach(function (mode) {
      var played = matches.filter(function (m) { return m.mode === mode; });
      var fill = els.menuList.querySelector('[data-fill="' + mode + '"]');
      var stat = els.menuList.querySelector('[data-stat="' + mode + '"]');
      if (!played.length) {
        fill.style.width = '0%';
        stat.textContent = 'Not played yet';
        return;
      }
      var recent = played.slice(-MENU_RECENT_MATCHES);
      var acc = recent.reduce(function (sum, m) { return sum + (m.acc || 0); }, 0) / recent.length;
      var best = played.reduce(function (max, m) { return Math.max(max, m.points || 0); }, 0);
      var pct = Math.round(acc * 100);
      fill.style.width = pct + '%';
      stat.textContent = pct + '% recent · best ' + best;
    });
  }

  function onMenuClick(e) {
    var card = e.target.closest ? e.target.closest('.ex-card') : null;
    if (!card) return;
    Store.change(function (s) { s.mode = card.getAttribute('data-ex'); });
    Setup.sync();
    showView('setup');
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
    els.qLabel.textContent = Game.MODES[Store.settings().mode].noun;

    var showHealth = !!s && s.hasHealth;
    els.health.classList.toggle('hidden', !showHealth);
    if (!showHealth) return;
    var pct = s.health / s.maxHealth * 100;
    els.healthVal.textContent = s.health;
    els.healthFill.style.width = pct + '%';
    els.healthFill.className = 'health-fill' + (pct <= 25 ? ' danger' : pct <= 55 ? ' warn' : '');
  }

  /* ---------- question timer ---------- */

  function stopQuestionTimer() {
    if (qTimer !== null) { clearInterval(qTimer); qTimer = null; }
    els.timerTrack.classList.add('hidden');
    els.timerFill.style.width = '100%';
    els.timerFill.classList.remove('low');
  }

  // Starts on the first listen of a question only. A replay never restarts it,
  // so replaying cannot be used to dodge the clock.
  function startQuestionTimer() {
    stopQuestionTimer();
    var limit = match ? match.settings.timeLimit : 0;
    if (!limit) return;
    els.timerTrack.classList.remove('hidden');
    var started = Date.now();
    qTimer = setInterval(function () {
      var left = 1 - (Date.now() - started) / (limit * 1000);
      els.timerFill.style.width = Math.max(0, left * 100) + '%';
      els.timerFill.classList.toggle('low', left < 0.25);
      if (left > 0) return;
      stopQuestionTimer();
      if (awaiting()) showResult(match.timeout(usingPiano()));
    }, TIMER_TICK_MS);
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
        var label = Store.settings().ivlMethod === 'semitones' ? String(semi) : iv.label;
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
        text = Store.settings().ivlMethod === 'semitones' ? 'How many semitones apart?' : 'Name the interval.';
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
  // Type-only chord answers have no piano, so the toggle gives way to a note.
  function renderMethodControls() {
    var st = Store.settings();
    var isIntervals = st.mode === 'intervals';
    var showToggle = !!match && (isIntervals || Game.pianoAllowed(st));
    els.methodSeg.classList.toggle('hidden', !showToggle);
    els.methodNote.classList.toggle('hidden', !match || showToggle);
    each(els.methodSeg.querySelectorAll('[data-method]'), function (b) {
      var forIntervals = b.getAttribute('data-method') === 'names' || b.getAttribute('data-method') === 'semitones';
      b.classList.toggle('hidden', forIntervals !== isIntervals);
    });
    setActive(els.methodSeg, 'data-method', isIntervals ? st.ivlMethod : Game.effectiveMethod(st));
  }

  function syncSubmit() {
    var show = !!match && match.settings.mode === 'chords' && usingPiano() && match.settings.guessTarget === 'both';
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
    if (match) {
      if (piano) renderPiano();
      else renderButtons();
    }
    renderMethodControls();
    renderDrill();
    syncSubmit();
    updateHeading();
    updateWidth();
  }

  function clearAnswerMarks() {
    each(els.answers.querySelectorAll('.ans-btn'), function (b) {
      b.classList.remove('correct', 'incorrect', 'selected');
    });
    Keyboard.clearMarks(els.piano);
  }

  function markButton(attr, value, cls) {
    if (value === undefined || value === null) return;
    var b = els.answers.querySelector('[' + attr + '="' + value + '"]');
    if (b) b.classList.add(cls);
  }

  // Colour the answer: right in green, wrong in red, right-but-not-chosen
  // piano keys striped. After a timeout there is no guess, so only the right
  // answer is shown.
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
    stopMatchActivity();
    els.summary.classList.add('hidden');
    els.game.classList.remove('hidden');
    flashDelta(0);
    els.feedback.textContent = '';
    els.feedback.className = 'feedback';

    match = Game.setupProblem(Store.settings()) ? null : Game.createMatch(Store.settings());
    renderAnswerArea();
    if (!match) return;
    showNextQuestion();
    setHint(audioReady ? 'tap to listen' : 'loading piano samples…');
  }

  function showNextQuestion() {
    stopMatchActivity();
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
    stopMatchActivity();
    var s = match.summary();

    els.game.classList.add('hidden');
    els.summary.classList.remove('hidden');
    els.methodSeg.classList.add('hidden');
    els.methodNote.classList.add('hidden');
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
    updateWidth();
    setHint(s.knockedOut ? 'health ran out' : 'all ' + Game.MATCH_LENGTH + ' ' + Game.MODES[s.mode].plural + ' played');
  }

  // After any graded answer or timeout: colour it, report it, then move on.
  function showResult(res) {
    if (!res) return;
    stopQuestionTimer();
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

    // The clock runs from the first listen only; replays leave it alone.
    if (!res.replay) startQuestionTimer();

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

  // Switching input mid-match keeps the question, the score and the clock, and
  // drops any half-given answer.
  function onMethod(e) {
    var btn = e.target.closest ? e.target.closest('button[data-method]') : null;
    if (!btn || btn.disabled) return;
    var m = btn.getAttribute('data-method');
    var st = Store.settings();
    if (m === 'names' || m === 'semitones') {
      if (st.ivlMethod === m) return;
      Store.change(function (s) { s.ivlMethod = m; });
    } else {
      if (st.method === m) return;
      Store.change(function (s) { s.method = m; });
    }
    renderAnswerArea();
  }

  function leaveGame() {
    stopMatchActivity();
    match = null;
    els.card.classList.remove('wide');
    Setup.sync();
    showView('setup');
  }

  function startFromSetup() {
    showView('game');
    startMatch();
  }

  /* ---------- wiring (once) ---------- */

  els.tabs.addEventListener('click', onTab);
  els.menuList.addEventListener('click', onMenuClick);
  els.gameBack.addEventListener('click', leaveGame);
  els.playBtn.addEventListener('click', onPlay);
  els.answers.addEventListener('click', onAnswerButton);
  els.piano.addEventListener('click', onPianoKey);
  els.submitBtn.addEventListener('click', onSubmit);
  els.methodSeg.addEventListener('click', onMethod);
  els.newMatchBtn.addEventListener('click', startMatch);

  Setup.init({
    onStart: startFromSetup,
    onBack: function () { showView('menu'); },
    onLearn: openLearnFor
  });

  Learn.init({
    onPractice: practiceFromLearn,
    onModeChange: updateHeading
  });

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

  syncStorageNote();
  showView('menu');
  PianoAudio.init();
})();
