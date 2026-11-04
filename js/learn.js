/* The Learn tab: unscored exploration with three sub-modes.
 *
 *   Notes      anchor trainer: hear a note as a distance from a fixed anchor
 *   Intervals  compare two intervals from the same root
 *   Chords     compare two chord types from the same root
 *
 * Nothing here is scored or logged: Learn never writes to the history. It
 * only reads and saves its own settings (learnMode, anchorOn, anchorMidi,
 * cmpA, cmpB, arpeggio) through Store.change().
 *
 * All sound goes through PianoAudio.playPitches(). The board is drawn by the
 * shared Keyboard. Every listener is attached once, in init(), by delegation;
 * show() and the render helpers only update what is on screen.
 *
 * The text builders (anchorText, intervalDisplay, chordDisplay) are pure and
 * exported so they can be checked on their own.
 *
 * Depends on: MusicData, PianoAudio, Store, Keyboard.
 */
var Learn = (function () {
  'use strict';

  var D = MusicData;
  var $ = function (id) { return document.getElementById(id); };
  function each(list, fn) { Array.prototype.forEach.call(list, fn); }

  var BOARD_LOW = D.REGISTER_LOW;                               // C3
  var BOARD_OCTAVES = D.REGISTER_COUNT;                         // three: C3 to B5
  var BOARD_TOP = BOARD_LOW + BOARD_OCTAVES * 12 - 1;           // B5, the last playable key
  var ANCHOR_LOW = 60;                                          // the anchor menu spans C4 to B4

  // Spacing in seconds, as in the practice game.
  var ANCHOR_GAP = 0.62;
  var INTERVAL_GAP = 0.55;
  var ARP_GAP = 0.42;
  var ARP_BLOCK_PAUSE = 0.95;

  // Unplayable ghost keys above the board, by sub-mode, so the top of a high
  // interval or chord still has somewhere to show.
  var GHOST_KEYS = { notes: 0, intervals: D.INTERVAL_REACH, chords: D.CHORD_REACH };

  var PROMPTS = {
    notes: 'tap a key or a note to hear it',
    intervals: 'pick two intervals, then flip between them',
    chords: 'pick a root, then compare two chord types'
  };

  /* ---------- pure text builders ---------- */

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  // Anchor trainer: how the tapped note sits against the anchor. With the
  // anchor off, or when the tapped note is the anchor itself, it plays alone.
  function anchorText(anchorOn, anchorMidi, midi) {
    var d = midi - anchorMidi;
    if (!anchorOn || d === 0) return 'played on its own';
    var size = Math.abs(d);
    var name;
    if (size <= 12) {
      name = D.intervalBySemi(size).name;
    } else {
      var octaves = Math.floor(size / 12);
      var rest = size % 12;
      var octaveText = octaves === 1 ? 'an octave' : octaves + ' octaves';
      name = rest === 0 ? octaveText : D.intervalBySemi(rest).name + ' + ' + octaveText;
    }
    return name + (d > 0 ? ' above ' : ' below ') + D.midiToName(anchorMidi);
  }

  // The notes of an interval in the order they are played: root first when
  // ascending, upper note first when descending.
  function intervalPitches(root, semi, descending) {
    return descending ? [root + semi, root] : [root, root + semi];
  }

  function intervalDisplay(root, semi, descending) {
    var iv = D.intervalBySemi(semi);
    var pitches = intervalPitches(root, semi, descending);
    return {
      name: iv.label + ' — ' + iv.name,
      spell: pitches.map(D.midiToName).join(descending ? ' ↓ ' : ' ↑ ') +
        '  ·  ' + plural(semi, 'semitone') +
        '  ·  ' + iv.song + (descending ? ' (ascending)' : ''),
      pitches: pitches
    };
  }

  // Notes above the last playable key are drawn on the ghost keys, or beyond.
  function chordDisplay(root, quality) {
    var chord = D.CHORDS[quality];
    var pitches = D.chordPitches(root, quality);
    var above = pitches.filter(function (m) { return m > BOARD_TOP; }).length;
    return {
      name: D.midiToName(root) + ' ' + chord.name,
      spell: pitches.map(D.midiToName).join(' · ') +
        '  —  ' + chord.intervals.join(', ') + ' semitones' +
        (above ? '  ·  ' + above + ' above the keyboard' : ''),
      pitches: pitches
    };
  }

  /* ---------- state ---------- */

  var els = null;
  var callbacks = { practice: null, modeChange: null };

  // Session-only state: not saved, so each visit starts from the same place.
  var state = {
    root: 60,              // root for Intervals and Chords: C4
    ivlA: 3,               // m3 vs M3: the pair that matters most
    ivlB: 4,
    ivlDesc: false,
    ivlHarm: false,
    lastIvlB: false,       // which of A / B played last, so a key tap can replay it
    lastChordB: false,
    noteOct: 1             // register the note buttons play in: 0 = C3, 1 = C4, 2 = C5
  };

  function settings() { return Store.settings(); }
  function mode() { return settings().learnMode; }

  /* ---------- playing ---------- */

  function setDisplay(name, spell) {
    els.dispName.textContent = name;
    els.dispSpell.textContent = spell;
  }

  function light(pitches) {
    Keyboard.clearMarks(els.piano);
    Keyboard.mark(els.piano, pitches, 'lit');
  }

  // Every sound in Learn comes through here. Returns false (and says so) if the
  // piano is still loading.
  function sound(pitches, gap, blockAfter) {
    if (!PianoAudio.isReady()) {
      setDisplay('—', PianoAudio.loadingLabel());
      return false;
    }
    light(pitches);
    PianoAudio.playPitches(pitches, gap || 0, blockAfter || 0);
    return true;
  }

  function registerOf(midi) {
    return Math.max(0, Math.min(D.REGISTER_COUNT - 1, D.registerOf(midi)));
  }

  // Notes: a key or a note button was tapped.
  function playNote(midi) {
    var st = settings();
    state.noteOct = registerOf(midi);
    syncOctave();
    if (!PianoAudio.isReady()) { sound([midi]); return; }
    var withAnchor = st.anchorOn && midi !== st.anchorMidi;
    setDisplay(D.midiToName(midi), anchorText(st.anchorOn, st.anchorMidi, midi));
    if (withAnchor) sound([st.anchorMidi, midi], ANCHOR_GAP);
    else sound([midi]);
  }

  function playAnchor() {
    var st = settings();
    if (!sound([st.anchorMidi])) return;
    setDisplay(D.midiToName(st.anchorMidi), 'anchor reference');
  }

  function playInterval(useB) {
    state.lastIvlB = useB;
    var shown = intervalDisplay(state.root, useB ? state.ivlB : state.ivlA, state.ivlDesc);
    if (!sound(shown.pitches, state.ivlHarm ? 0 : INTERVAL_GAP)) return;
    setDisplay(shown.name, shown.spell);
  }

  function playChord(useB) {
    state.lastChordB = useB;
    var st = settings();
    var shown = chordDisplay(state.root, useB ? st.cmpB : st.cmpA);
    if (!sound(shown.pitches, st.arpeggio ? ARP_GAP : 0, st.arpeggio ? ARP_BLOCK_PAUSE : 0)) return;
    setDisplay(shown.name, shown.spell);
  }

  /* ---------- showing ---------- */

  function setActive(container, attr, value) {
    each(container.querySelectorAll('[' + attr + ']'), function (b) {
      var on = b.getAttribute(attr) === String(value);
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function syncOctave() { setActive(els.octSeg, 'data-oct', state.noteOct); }

  function syncRoots() {
    var pc = D.pc(state.root);
    each(els.roots.querySelectorAll('[data-root]'), function (b) {
      b.classList.toggle('selected', +b.getAttribute('data-root') === pc);
    });
  }

  // What "Practice this" will do, and whether it can.
  function syncPractice() {
    var st = settings();
    var text, blocked = false;
    if (st.learnMode === 'intervals') {
      if (state.ivlA === state.ivlB) {
        blocked = true;
        text = 'Pick two different intervals to practice them.';
      } else {
        text = 'Starts an interval match with ' + D.intervalBySemi(state.ivlA).label + ' and ' +
          D.intervalBySemi(state.ivlB).label + ', ' + (state.ivlDesc ? 'descending' : 'ascending') + '.';
      }
    } else if (st.learnMode === 'chords') {
      text = 'Starts a chord match with ' + D.CHORDS[st.cmpA].label +
        (st.cmpA === st.cmpB ? ' only.' : ' and ' + D.CHORDS[st.cmpB].label + '.');
    } else {
      text = 'Starts a Pitch match with your current Pitch settings.';
    }
    els.practiceBtn.disabled = blocked;
    els.practiceNote.textContent = text;
  }

  // Draw the board for the sub-mode. render() attaches no listeners.
  function renderBoard() {
    var m = mode();
    Keyboard.render(els.piano, {
      low: BOARD_LOW,
      octaves: BOARD_OCTAVES,
      extra: GHOST_KEYS[m],
      labels: m === 'chords' ? 'letters' : 'octaves',
      minKeyPx: 24
    });
  }

  function sync() {
    var st = settings();
    var m = st.learnMode;
    setActive(els.modeSeg, 'data-lmode', m);
    els.notesView.classList.toggle('hidden', m !== 'notes');
    els.intervalsView.classList.toggle('hidden', m !== 'intervals');
    els.chordsView.classList.toggle('hidden', m !== 'chords');

    els.anchorToggle.classList.toggle('on', st.anchorOn);
    els.anchorToggle.setAttribute('aria-pressed', st.anchorOn ? 'true' : 'false');
    els.anchorToggle.textContent = st.anchorOn ? 'Anchor on' : 'Anchor off';
    els.anchorSel.disabled = !st.anchorOn;
    els.anchorSel.value = String(st.anchorMidi);
    syncOctave();

    els.ivlA.value = String(state.ivlA);
    els.ivlB.value = String(state.ivlB);
    setActive(els.ivlTime, 'data-ivltime', state.ivlHarm ? 'harmonic' : 'melodic');
    setActive(els.ivlDir, 'data-ivldir', state.ivlDesc ? 'desc' : 'asc');

    els.chordA.value = st.cmpA;
    els.chordB.value = st.cmpB;
    setActive(els.chordPlay, 'data-chordplay', st.arpeggio ? 'arp' : 'block');
    syncRoots();
    syncPractice();
  }

  /* ---------- changing ---------- */

  function setMode(m) {
    Store.change(function (s) { s.learnMode = m; });
    PianoAudio.silenceAll();
    renderBoard();
    sync();
    setDisplay('—', PROMPTS[m]);
    if (callbacks.modeChange) callbacks.modeChange();
  }

  // Tapping a key: Notes plays it, Intervals and Chords move the root.
  function onKey(e) {
    var midi = Keyboard.keyFromEvent(e);
    if (midi === null) return;
    var m = mode();
    if (m === 'notes') {
      playNote(midi);
    } else if (m === 'intervals') {
      state.root = midi;
      playInterval(state.lastIvlB);
    } else {
      state.root = midi;
      syncRoots();
      playChord(state.lastChordB);
    }
  }

  // The twelve root buttons keep the octave you are already exploring.
  function rootFromButton(pc) {
    var oct = Math.max(0, Math.min(D.REGISTER_COUNT - 1, Math.floor((state.root - BOARD_LOW) / 12)));
    return D.midiInRegister(pc, oct);
  }

  function onClick(e) {
    var b = e.target.closest ? e.target.closest('button') : null;
    if (!b || b.disabled) return;

    if (b.hasAttribute('data-lmode')) {
      if (b.getAttribute('data-lmode') !== mode()) setMode(b.getAttribute('data-lmode'));
    } else if (b === els.anchorToggle) {
      Store.change(function (s) { s.anchorOn = !s.anchorOn; });
      sync();
    } else if (b.hasAttribute('data-oct')) {
      state.noteOct = +b.getAttribute('data-oct');
      syncOctave();
    } else if (b.hasAttribute('data-pc')) {
      playNote(D.midiInRegister(+b.getAttribute('data-pc'), state.noteOct));
    } else if (b === els.ivlPlayA) {
      playInterval(false);
    } else if (b === els.ivlPlayB) {
      playInterval(true);
    } else if (b === els.ivlFlip) {
      playInterval(!state.lastIvlB);
    } else if (b.hasAttribute('data-ivltime')) {
      state.ivlHarm = b.getAttribute('data-ivltime') === 'harmonic';
      sync();
    } else if (b.hasAttribute('data-ivldir')) {
      state.ivlDesc = b.getAttribute('data-ivldir') === 'desc';
      sync();
      playInterval(state.lastIvlB);     // a change of direction is heard straight away
    } else if (b.hasAttribute('data-root')) {
      state.root = rootFromButton(+b.getAttribute('data-root'));
      syncRoots();
      playChord(state.lastChordB);
    } else if (b === els.chordPlayA) {
      playChord(false);
    } else if (b === els.chordPlayB) {
      playChord(true);
    } else if (b === els.chordFlip) {
      playChord(!state.lastChordB);
    } else if (b.hasAttribute('data-chordplay')) {
      var arp = b.getAttribute('data-chordplay') === 'arp';
      Store.change(function (s) { s.arpeggio = arp; });
      sync();
    } else if (b === els.practiceBtn) {
      practiceThis();
    }
  }

  function onChange(e) {
    var t = e.target;
    if (t === els.anchorSel) {
      Store.change(function (s) { s.anchorMidi = parseInt(t.value, 10); });
      playAnchor();
    } else if (t === els.ivlA) {
      state.ivlA = parseInt(t.value, 10);
      syncPractice();
      playInterval(false);
    } else if (t === els.ivlB) {
      state.ivlB = parseInt(t.value, 10);
      syncPractice();
      playInterval(true);
    } else if (t === els.chordA) {
      Store.change(function (s) { s.cmpA = t.value; });
      syncPractice();
      playChord(false);
    } else if (t === els.chordB) {
      Store.change(function (s) { s.cmpB = t.value; });
      syncPractice();
      playChord(true);
    }
  }

  // Carry what is being explored into a scored match: Notes uses the current
  // Pitch settings, Intervals and Chords make the two compared items the pool.
  function practiceThis() {
    var m = mode();
    var patch;
    if (m === 'intervals') {
      if (state.ivlA === state.ivlB) return;
      var semis = [state.ivlA, state.ivlB];
      var desc = state.ivlDesc;
      patch = function (s) {
        s.mode = 'intervals';
        s.ivlSel = D.INTERVALS.map(function (iv) { return semis.indexOf(iv.semi) !== -1; });
        s.ivlDir = desc ? 'desc' : 'asc';
      };
    } else if (m === 'chords') {
      var pair = [settings().cmpA, settings().cmpB];
      patch = function (s) {
        s.mode = 'chords';
        s.qualSel = D.QUALITY_KEYS.map(function (k) { return pair.indexOf(k) !== -1; });
      };
    } else {
      patch = function (s) { s.mode = 'notes'; };
    }
    if (callbacks.practice) callbacks.practice(patch);
  }

  /* ---------- building (once) ---------- */

  function fillOptions(sel, items) {
    items.forEach(function (it) { sel.appendChild(new Option(it[1], String(it[0]))); });
  }

  function chip(text, attrs, className) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = className;
    b.textContent = text;
    Object.keys(attrs).forEach(function (k) { b.setAttribute(k, attrs[k]); });
    return b;
  }

  function build() {
    var anchors = [];
    for (var m = ANCHOR_LOW; m < ANCHOR_LOW + 12; m++) anchors.push([m, 'Anchor ' + D.midiToName(m)]);
    fillOptions(els.anchorSel, anchors);

    var ivls = D.INTERVALS.map(function (iv) { return [iv.semi, iv.label + ' — ' + iv.name]; });
    fillOptions(els.ivlA, ivls);
    fillOptions(els.ivlB, ivls);

    var chords = D.QUALITY_KEYS.map(function (k) { return [k, D.CHORDS[k].label + ' — ' + D.CHORDS[k].name]; });
    fillOptions(els.chordA, chords);
    fillOptions(els.chordB, chords);

    D.NOTES.forEach(function (n, pc) {
      els.noteBtns.appendChild(chip(n, { 'data-pc': pc }, 'ans-btn'));
      els.roots.appendChild(chip(n, { 'data-root': pc }, 'ans-btn'));
    });
  }

  /* ---------- start ---------- */

  /* Call once. `options`:
   *   onPractice(patch)  start a match; `patch` changes the settings for it
   *   onModeChange()     the sub-mode changed, so the heading may need updating */
  function init(options) {
    callbacks.practice = options.onPractice;
    callbacks.modeChange = options.onModeChange;
    els = {
      view: $('learnView'), modeSeg: $('learnModeSeg'),
      dispName: $('dispName'), dispSpell: $('dispSpell'),
      notesView: $('learnNotes'), intervalsView: $('learnIntervals'), chordsView: $('learnChords'),
      anchorToggle: $('anchorToggle'), anchorSel: $('anchorSel'), octSeg: $('learnOctSeg'), noteBtns: $('learnNoteBtns'),
      ivlA: $('ivlA'), ivlB: $('ivlB'), ivlPlayA: $('ivlPlayA'), ivlFlip: $('ivlFlip'), ivlPlayB: $('ivlPlayB'),
      ivlTime: $('ivlTime'), ivlDir: $('ivlDir'),
      roots: $('learnRoots'), chordA: $('chordA'), chordB: $('chordB'),
      chordPlayA: $('chordPlayA'), chordFlip: $('chordFlip'), chordPlayB: $('chordPlayB'), chordPlay: $('chordPlay'),
      piano: $('learnPiano'), practiceBtn: $('practiceThis'), practiceNote: $('practiceNote')
    };
    build();
    els.view.addEventListener('click', onClick);
    els.view.addEventListener('change', onChange);
    els.piano.addEventListener('click', onKey);
  }

  // The tab is shown: re-read the saved settings and start from the prompt.
  function show() {
    renderBoard();
    sync();
    setDisplay('—', PROMPTS[mode()]);
  }

  // The tab is left: nothing may keep sounding.
  function hide() {
    PianoAudio.silenceAll();
    if (els) Keyboard.clearMarks(els.piano);
  }

  return {
    init: init,
    show: show,
    hide: hide,
    anchorText: anchorText,
    intervalDisplay: intervalDisplay,
    chordDisplay: chordDisplay
  };
})();
