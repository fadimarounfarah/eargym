/* The page: draws the Notes match and wires taps to the game and the audio.
 * Every listener is attached once, here, never from inside a render function.
 *
 * Depends on: MusicData, PianoAudio, Store, Game.
 */
(function () {
  'use strict';

  var D = MusicData;
  var $ = function (id) { return document.getElementById(id); };

  var els = {
    points: $('points'), qNum: $('qNum'), qTotal: $('qTotal'),
    streak: $('streak'), hits: $('hits'), delta: $('delta'),
    health: $('health'), healthVal: $('healthVal'), healthFill: $('healthFill'),
    game: $('game'), playBtn: $('playBtn'), hint: $('hint'),
    feedback: $('feedback'), answers: $('answers'),
    summary: $('summary'), sumTitle: $('sumTitle'), sumPoints: $('sumPoints'),
    sumStats: $('sumStats'), sumBreakdown: $('sumBreakdown'), newMatchBtn: $('newMatchBtn'),
    diffSeg: $('diffSeg'), source: $('source'), storageNote: $('storageNote')
  };

  var settings = Store.loadSettings();
  Store.loadHistory();

  var match = null;
  var audioReady = false;
  var timer = null;           // pending "next question" or "show summary"

  /* ---------- small helpers ---------- */

  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function clearTimer() {
    if (timer !== null) { clearTimeout(timer); timer = null; }
  }

  function setHint(text) { els.hint.textContent = text; }

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

  /* ---------- score strip ---------- */

  function renderScore() {
    var s = match.state();
    els.points.textContent = s.points;
    els.streak.textContent = s.streak;
    els.hits.textContent = s.hits;
    els.qNum.textContent = s.questionNumber;
    els.qTotal.textContent = s.total;

    els.health.classList.toggle('hidden', !s.hasHealth);
    if (!s.hasHealth) return;
    var pct = s.health / s.maxHealth * 100;
    els.healthVal.textContent = s.health;
    els.healthFill.style.width = pct + '%';
    els.healthFill.className = 'health-fill' + (pct <= 25 ? ' danger' : pct <= 55 ? ' warn' : '');
  }

  /* ---------- answer buttons ---------- */

  // One button per selected note, in chromatic order.
  function buildAnswerButtons() {
    els.answers.textContent = '';
    settings.noteSel.forEach(function (on, pc) {
      if (!on) return;
      var b = make('button', 'ans-btn', D.pcToName(pc));
      b.type = 'button';
      b.dataset.pc = pc;
      b.disabled = !audioReady;
      els.answers.appendChild(b);
    });
  }

  function clearAnswerMarks() {
    Array.prototype.forEach.call(els.answers.children, function (b) {
      b.classList.remove('correct', 'incorrect');
    });
  }

  function buttonFor(pc) {
    return els.answers.querySelector('[data-pc="' + pc + '"]');
  }

  /* ---------- match flow ---------- */

  function startMatch() {
    clearTimer();
    PianoAudio.silenceAll();
    match = Game.createMatch({
      difficulty: settings.difficulty,
      noteSel: settings.noteSel,
      registers: settings.registers
    });
    els.summary.classList.add('hidden');
    els.game.classList.remove('hidden');
    buildAnswerButtons();
    flashDelta(0);
    showNextQuestion();
    setHint(audioReady ? 'tap to listen' : 'loading piano samples…');
  }

  function showNextQuestion() {
    PianoAudio.silenceAll();
    match.nextQuestion();
    clearAnswerMarks();
    els.feedback.textContent = '';
    els.feedback.className = 'feedback';
    flashDelta(0);
    renderScore();
    syncPlayButton();
  }

  function showSummary() {
    clearTimer();
    PianoAudio.silenceAll();
    var s = match.summary();

    els.game.classList.add('hidden');
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
        r.appendChild(pair);
        r.appendChild(make('span', 'cnt', c.n + '×'));
        els.sumBreakdown.appendChild(r);
      });
      if (s.moreMisses > 0) els.sumBreakdown.appendChild(make('div', 'more', '+ ' + s.moreMisses + ' more'));
    }

    syncPlayButton();
    syncStorageNote();
    setHint(s.knockedOut ? 'health ran out' : 'all ' + Game.MATCH_LENGTH + ' notes played');
  }

  /* ---------- taps ---------- */

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
    PianoAudio.playPitches(res.pitches);
  }

  function onAnswer(e) {
    var btn = e.target.closest ? e.target.closest('.ans-btn') : null;
    if (!btn || btn.disabled || !match) return;
    var res = match.answer(+btn.dataset.pc);
    if (!res) return;

    if (res.correct) {
      btn.classList.add('correct');
    } else {
      btn.classList.add('incorrect');
      var right = buttonFor(res.targetPc);
      if (right) right.classList.add('correct');
    }
    els.feedback.textContent = res.message;
    els.feedback.className = 'feedback ' + (res.correct ? 'good' : 'bad');
    flashDelta(res.delta);
    renderScore();
    syncPlayButton();

    if (res.over) {
      // Leave the feedback on screen for a moment before the summary replaces it.
      timer = setTimeout(showSummary, Game.ADVANCE_DELAY_MS);
      setHint(res.knockedOut ? 'health ran out' : 'last note played');
    } else {
      timer = setTimeout(function () {
        timer = null;
        showNextQuestion();
      }, Game.ADVANCE_DELAY_MS);
      setHint('tap play for the next one');
    }
  }

  function onDifficulty(e) {
    var btn = e.target.closest ? e.target.closest('button[data-diff]') : null;
    if (!btn || btn.dataset.diff === settings.difficulty) return;
    // A score has to belong to one rule set, so changing it starts a fresh match.
    settings.difficulty = btn.dataset.diff;
    settings = Store.saveSettings(settings);
    renderDifficulty();
    startMatch();
    setHint(Game.DIFFICULTY[settings.difficulty].label + ' — new match');
  }

  function renderDifficulty() {
    Array.prototype.forEach.call(els.diffSeg.querySelectorAll('button'), function (b) {
      var on = b.dataset.diff === settings.difficulty;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  /* ---------- wiring (once) ---------- */

  els.playBtn.addEventListener('click', onPlay);
  els.answers.addEventListener('click', onAnswer);
  els.diffSeg.addEventListener('click', onDifficulty);
  els.newMatchBtn.addEventListener('click', startMatch);

  PianoAudio.onReady(function (label, kind) {
    audioReady = true;
    els.source.textContent = label;
    els.source.className = kind === 'samples' ? 'samples' : 'synth';
    Array.prototype.forEach.call(els.answers.children, function (b) { b.disabled = false; });
    syncPlayButton();
    if (match && !match.state().over) setHint('tap to listen');
  });

  renderDifficulty();
  syncStorageNote();
  startMatch();
  PianoAudio.init();
})();
