/* The "Set up your match" screen for the exercise in Store.settings().mode.
 *
 * The chips and selects are drawn once in init(), and every listener is
 * attached there, once, by delegation on the screen. sync() only re-reads the
 * settings and updates what is shown, so it is safe to call whenever the screen
 * is shown or something changes.
 *
 * Every change goes through Store.change(), which validates and saves it.
 *
 * Depends on: MusicData, Store, Game.
 */
var Setup = (function () {
  'use strict';

  var D = MusicData;
  var $ = function (id) { return document.getElementById(id); };
  function each(list, fn) { Array.prototype.forEach.call(list, fn); }
  function countOn(arr) { return arr.filter(Boolean).length; }

  var els = null;
  var callbacks = { start: null, back: null, learn: null };

  // The chord guess target to restore when a pinned root is set back to
  // random. Kept for this visit only; a pinned root is saved as type-only.
  var guessBeforePin = null;

  var DIFFICULTY_NOTES = {
    easy: 'No health. Mistakes cost your streak, not your progress. Replays are free.',
    medium: '800 health. Misses drain it, and each replay costs ' + Game.REPLAY_COST + '.',
    hard: '500 health. Same rules, less room.'
  };

  /* ---------- building (once) ---------- */

  function chip(text, attrs) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = text;
    Object.keys(attrs).forEach(function (k) { b.setAttribute(k, attrs[k]); });
    return b;
  }

  function fillRootSelect(sel) {
    sel.appendChild(new Option('Random', 'random'));
    D.NOTES.forEach(function (n, pc) { sel.appendChild(new Option(n, String(pc))); });
  }

  // "None", then every note across the three registers: C3 to B5.
  function fillReferenceSelect(sel) {
    sel.appendChild(new Option('None', '0'));
    for (var m = D.REGISTER_LOW; m < D.REGISTER_LOW + 12 * D.REGISTER_COUNT; m++) {
      sel.appendChild(new Option(D.midiToName(m), String(m)));
    }
  }

  function build() {
    D.NOTES.forEach(function (n, i) { els.noteChips.appendChild(chip(n, { 'data-note': i })); });
    D.INTERVALS.forEach(function (iv, i) {
      els.ivlChips.appendChild(chip(iv.label, { 'data-ivl': i, title: iv.name }));
    });
    D.QUALITY_KEYS.forEach(function (k, i) {
      els.qualChips.appendChild(chip(D.CHORDS[k].label, { 'data-qual-chip': i, title: D.CHORDS[k].name }));
    });
    D.REGISTERS.forEach(function (r) { els.regChips.appendChild(chip(r.label, { 'data-reg': r.index })); });
    fillRootSelect(els.ivlRootSel);
    fillRootSelect(els.chordRootSel);
    fillReferenceSelect(els.refSel);
  }

  /* ---------- showing ---------- */

  function setActive(container, attr, value) {
    each(container.querySelectorAll('[' + attr + ']'), function (b) {
      var on = b.getAttribute(attr) === String(value);
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function syncChips(container, attr, sel) {
    each(container.querySelectorAll('[' + attr + ']'), function (b) {
      var on = !!sel[+b.getAttribute(attr)];
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function setCount(el, text) {
    el.textContent = text;
    el.className = 'field-note';
  }

  // Shown until the next sync, when a tap would break a minimum.
  function warn(el, text) {
    el.textContent = text;
    el.className = 'field-note warn';
  }

  function regsKey(mode) { return mode === 'chords' ? 'chordRegisters' : 'registers'; }

  function sync() {
    var st = Store.settings();
    var mode = st.mode;
    var meta = Game.MODES[mode];

    els.setupName.textContent = meta.title;
    els.setupIcon.textContent = meta.icon;

    // Sections that belong to one or two exercises.
    each(els.view.querySelectorAll('[data-for]'), function (f) {
      f.classList.toggle('hidden', f.getAttribute('data-for').split(' ').indexOf(mode) === -1);
    });

    syncChips(els.noteChips, 'data-note', st.noteSel);
    setCount(els.noteCount, countOn(st.noteSel) + ' selected');
    syncChips(els.ivlChips, 'data-ivl', st.ivlSel);
    setCount(els.ivlCount, countOn(st.ivlSel) + ' selected');
    syncChips(els.qualChips, 'data-qual-chip', st.qualSel);
    setCount(els.qualCount, countOn(st.qualSel) + ' selected');

    els.regLabel.textContent = mode === 'chords' ? 'Registers of the root'
      : mode === 'intervals' ? 'Registers of the lower note' : 'Registers';
    syncChips(els.regChips, 'data-reg', st[regsKey(mode)]);
    setCount(els.regNote, mode === 'intervals' ? 'shared with Pitch' : '');

    // Weak-note focus, and how much it has to lean on.
    els.focusToggle.classList.toggle('on', st.focusWeak);
    els.focusToggle.setAttribute('aria-pressed', st.focusWeak ? 'true' : 'false');
    if (!st.focusWeak) {
      els.focusNote.textContent = 'Draws the notes you miss more often.';
    } else {
      var info = Game.focusInfo(st, Store.history().answers);
      els.focusNote.textContent = info.leaning
        ? 'Leaning on ' + info.leaning + ' weak note' + (info.leaning > 1 ? 's' : '') + '.'
        : 'No history yet, drawing evenly.';
    }

    els.refSel.value = String(st.refPitch);
    els.ivlRootSel.value = String(st.ivlRoot);
    els.chordRootSel.value = String(st.chordRoot);

    setActive(els.dirSeg, 'data-dir', st.ivlDir);
    setActive(els.guessSeg, 'data-guess', st.guessTarget);
    setActive(els.playSeg, 'data-play', st.chordPlay);
    setActive(els.timeSeg, 'data-time', st.timeLimit);
    setActive(els.diffSeg, 'data-diff', st.difficulty);

    // A pinned root is already known, so only the type can be asked.
    var pinned = st.chordRoot !== 'random';
    each(els.guessSeg.querySelectorAll('[data-guess]'), function (b) {
      b.disabled = pinned && b.getAttribute('data-guess') !== 'type';
    });
    els.guessNote.textContent = pinned ? 'The root is pinned, so you only guess the type.'
      : st.guessTarget === 'type' ? 'Type-only answers use buttons, not the piano.'
      : st.guessTarget === 'root' ? 'Name only the root; any octave works on the piano.'
      : 'Name the root and the type.';
    els.playNote.textContent = st.chordPlay === 'block'
      ? 'All notes at once — harder to pick apart.'
      : 'Notes roll out one by one, then strike together.';
    els.diffNote.textContent = DIFFICULTY_NOTES[st.difficulty];

    var problem = Game.setupProblem(st);
    els.setupProblem.textContent = problem || '';
    els.setupProblem.classList.toggle('hidden', !problem);
    els.startBtn.disabled = !!problem;
  }

  /* ---------- changing ---------- */

  // Flip entry i of a [bool] setting, but never below `min` selected.
  // Returns false (and warns at `noteEl`) if that would break the minimum.
  function toggleKeepingMin(key, i, min, noteEl, what) {
    if (Store.settings()[key][i] && countOn(Store.settings()[key]) <= min) {
      warn(noteEl, 'keep at least ' + min + ' ' + what);
      return false;
    }
    Store.change(function (s) { s[key][i] = !s[key][i]; });
    return true;
  }

  // Pinning a chord root forces type-only; unpinning restores the earlier
  // choice.
  function setChordRoot(s, value) {
    var wasPinned = s.chordRoot !== 'random';
    s.chordRoot = value;
    if (value !== 'random') {
      if (s.guessTarget !== 'type') guessBeforePin = s.guessTarget;
      s.guessTarget = 'type';
    } else if (wasPinned && guessBeforePin) {
      s.guessTarget = guessBeforePin;
      guessBeforePin = null;
    }
  }

  function onClick(e) {
    var b = e.target.closest ? e.target.closest('button') : null;
    if (!b || b.disabled) return;

    if (b === els.startBtn) { if (callbacks.start) callbacks.start(); return; }
    if (b === els.backBtn) { if (callbacks.back) callbacks.back(); return; }
    if (b === els.learnBtn) { if (callbacks.learn) callbacks.learn(); return; }

    var st = Store.settings();
    var mode = st.mode;

    if (b.hasAttribute('data-note')) {
      if (!toggleKeepingMin('noteSel', +b.getAttribute('data-note'), 2, els.noteCount, 'notes')) return;
    } else if (b.hasAttribute('data-npreset')) {
      var all = b.getAttribute('data-npreset') === 'all';
      Store.change(function (s) {
        s.noteSel = D.NOTES.map(function (n) { return all || D.NATURALS.indexOf(n) !== -1; });
      });
    } else if (b === els.focusToggle) {
      Store.change(function (s) { s.focusWeak = !s.focusWeak; });
    } else if (b.hasAttribute('data-reg')) {
      if (!toggleKeepingMin(regsKey(mode), +b.getAttribute('data-reg'), 1, els.regNote, 'register')) return;
    } else if (b.hasAttribute('data-ivl')) {
      if (!toggleKeepingMin('ivlSel', +b.getAttribute('data-ivl'), 2, els.ivlCount, 'intervals')) return;
    } else if (b.hasAttribute('data-ipreset')) {
      var semis = D.INTERVAL_PRESETS[b.getAttribute('data-ipreset')];
      Store.change(function (s) {
        s.ivlSel = D.INTERVALS.map(function (iv) { return semis.indexOf(iv.semi) !== -1; });
      });
    } else if (b.hasAttribute('data-dir')) {
      Store.change(function (s) { s.ivlDir = b.getAttribute('data-dir'); });
    } else if (b.hasAttribute('data-qual-chip')) {
      if (!toggleKeepingMin('qualSel', +b.getAttribute('data-qual-chip'), 1, els.qualCount, 'chord type')) return;
    } else if (b.hasAttribute('data-qpreset')) {
      var keys = D.QUALITY_PRESETS[b.getAttribute('data-qpreset')];
      Store.change(function (s) {
        s.qualSel = D.QUALITY_KEYS.map(function (k) { return keys.indexOf(k) !== -1; });
      });
    } else if (b.hasAttribute('data-guess')) {
      guessBeforePin = null;
      Store.change(function (s) { s.guessTarget = b.getAttribute('data-guess'); });
    } else if (b.hasAttribute('data-play')) {
      Store.change(function (s) { s.chordPlay = b.getAttribute('data-play'); });
    } else if (b.hasAttribute('data-time')) {
      Store.change(function (s) { s.timeLimit = +b.getAttribute('data-time'); });
    } else if (b.hasAttribute('data-diff')) {
      Store.change(function (s) { s.difficulty = b.getAttribute('data-diff'); });
    } else {
      return;
    }
    sync();
  }

  function rootValue(sel) { return sel.value === 'random' ? 'random' : parseInt(sel.value, 10); }

  function onChange(e) {
    var t = e.target;
    if (t === els.refSel) Store.change(function (s) { s.refPitch = parseInt(t.value, 10); });
    else if (t === els.ivlRootSel) Store.change(function (s) { s.ivlRoot = rootValue(t); });
    else if (t === els.chordRootSel) Store.change(function (s) { setChordRoot(s, rootValue(t)); });
    else return;
    sync();
  }

  /* ---------- start ---------- */

  /* Call once. `options`: { onStart, onBack, onLearn }. */
  function init(options) {
    callbacks.start = options.onStart;
    callbacks.back = options.onBack;
    callbacks.learn = options.onLearn;
    els = {
      view: $('setupView'), backBtn: $('setupBack'), startBtn: $('startBtn'), learnBtn: $('goLearn'),
      setupName: $('setupName'), setupIcon: $('setupIcon'), setupProblem: $('setupProblem'),
      noteChips: $('noteChips'), noteCount: $('noteCount'),
      qualChips: $('qualChips'), qualCount: $('qualCount'),
      ivlChips: $('ivlChips'), ivlCount: $('ivlCount'),
      regLabel: $('regLabel'), regChips: $('regChips'), regNote: $('regNote'),
      focusToggle: $('focusToggle'), focusNote: $('focusNote'),
      refSel: $('refSel'), ivlRootSel: $('ivlRootSel'), chordRootSel: $('chordRootSel'),
      dirSeg: $('dirSeg'), guessSeg: $('guessSeg'), guessNote: $('guessNote'),
      playSeg: $('playSeg'), playNote: $('playNote'),
      timeSeg: $('timeSeg'), diffSeg: $('diffSeg'), diffNote: $('diffNote')
    };
    build();
    els.view.addEventListener('click', onClick);
    els.view.addEventListener('change', onChange);
    sync();
  }

  return { init: init, sync: sync };
})();
