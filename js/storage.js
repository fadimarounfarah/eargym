/* Settings and practice history in localStorage.
 *
 * Two keys, both kept exactly as the old app wrote them so existing data and
 * exported backups still work:
 *   pitchTrainer.settings.v1   one settings object
 *   pitchTrainer.history.v1    { answers: [], matches: [], plays: [] }
 *
 * Every storage access is inside try/catch, so the app still runs (without
 * saving) when storage is blocked, full or corrupt.
 *
 * Settings are validated field by field with fallbacks. The whole settings
 * schema lives here, even fields a screen does not use yet, so saving from one
 * screen never drops what another screen stored.
 *
 * Depends on: MusicData (js/data.js).
 */
var Store = (function () {
  'use strict';

  var D = MusicData;

  var SETTINGS_KEY = 'pitchTrainer.settings.v1';
  var HISTORY_KEY = 'pitchTrainer.history.v1';

  var MAX_ANSWERS = 4000;
  var MAX_MATCHES = 500;
  var MAX_PLAYS = 4000;

  var MODES = ['notes', 'chords', 'intervals'];
  var METHODS = ['buttons', 'piano'];
  var DIFFICULTIES = ['easy', 'medium', 'hard'];
  var TIME_LIMITS = [0, 5, 10, 20];
  var IVL_DIRS = ['asc', 'desc', 'mixed'];
  var IVL_METHODS = ['names', 'semitones'];
  var GUESS_TARGETS = ['both', 'root', 'type'];
  var CHORD_PLAYS = ['block', 'arp'];   // 'random' was never built

  var storageOK = true;
  var settingsLoaded = false;
  var historyLoaded = false;
  var history = emptyHistory();

  /* ---------- small validators ---------- */

  function oneOf(v, list, fallback) { return list.indexOf(v) !== -1 ? v : fallback; }

  function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  function isInt(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }

  function countOn(a) { return a.filter(Boolean).length; }

  // A [bool, ...] array of an exact length with at least `minOn` entries on.
  function boolArray(v, len, minOn, fallback) {
    if (Array.isArray(v) && v.length === len) {
      var a = v.map(Boolean);
      if (countOn(a) >= minOn) return a;
    }
    return fallback.slice();
  }

  // 'random' or a pitch class 0-11.
  function rootOrRandom(v, fallback) {
    return v === 'random' || (isInt(v) && v >= 0 && v < 12) ? v : fallback;
  }

  function oneHot(len, on) {
    var a = [];
    for (var i = 0; i < len; i++) a.push(on.indexOf(i) !== -1);
    return a;
  }

  /* ---------- settings ---------- */

  function defaultSettings() {
    return {
      mode: 'notes',
      method: 'piano',
      difficulty: 'easy',

      noteSel: D.NOTES.map(function () { return true; }),
      timeLimit: 0,            // seconds per question, 0 = untimed
      refPitch: 0,             // MIDI of the reference note played first, 0 = none
      focusWeak: false,

      ivlSel: D.INTERVALS.map(function (iv) { return D.DEFAULT_INTERVALS.indexOf(iv.semi) !== -1; }),
      ivlDir: 'asc',
      ivlRoot: 'random',
      ivlMethod: 'names',

      qualSel: D.QUALITY_KEYS.map(function (k) { return D.DEFAULT_QUALITIES.indexOf(k) !== -1; }),
      chordRoot: 'random',
      guessTarget: 'both',
      chordPlay: 'block',

      registers: D.DEFAULT_REGISTERS.slice(),
      chordRegisters: D.DEFAULT_REGISTERS.slice(),

      learnMode: 'notes',
      anchorOn: true,
      anchorMidi: 60,
      cmpA: 'maj',
      cmpB: 'min',
      arpeggio: false
    };
  }

  // Turn anything (usually parsed JSON) into a complete, valid settings object.
  // `saved` fields that are missing or invalid fall back to the defaults.
  function normalizeSettings(saved) {
    var s = defaultSettings();
    if (!isObject(saved)) return s;

    s.mode = oneOf(saved.mode, MODES, s.mode);
    s.method = oneOf(saved.method, METHODS, s.method);
    s.difficulty = oneOf(saved.difficulty, DIFFICULTIES, s.difficulty);

    s.noteSel = boolArray(saved.noteSel, D.NOTES.length, 2, s.noteSel);
    s.timeLimit = oneOf(saved.timeLimit, TIME_LIMITS, s.timeLimit);
    if (saved.refPitch === 0 || (isInt(saved.refPitch) && saved.refPitch >= 21 && saved.refPitch <= 108)) {
      s.refPitch = saved.refPitch;
    }
    s.focusWeak = !!saved.focusWeak;

    s.ivlSel = boolArray(saved.ivlSel, D.INTERVALS.length, 2, s.ivlSel);
    s.ivlDir = oneOf(saved.ivlDir, IVL_DIRS, s.ivlDir);
    s.ivlRoot = rootOrRandom(saved.ivlRoot, s.ivlRoot);
    s.ivlMethod = oneOf(saved.ivlMethod, IVL_METHODS, s.ivlMethod);

    s.qualSel = boolArray(saved.qualSel, D.QUALITY_KEYS.length, 1, s.qualSel);
    s.chordRoot = rootOrRandom(saved.chordRoot, s.chordRoot);
    s.guessTarget = oneOf(saved.guessTarget, GUESS_TARGETS, s.guessTarget);
    s.chordPlay = oneOf(saved.chordPlay, CHORD_PLAYS, s.chordPlay);

    // The first version stored an octave count ('1', '2' or '3') in `range`.
    // Registers replaced it: migrate that to the same stacked selection.
    if (Array.isArray(saved.registers) && saved.registers.length === D.REGISTER_COUNT && countOn(saved.registers.map(Boolean)) >= 1) {
      s.registers = saved.registers.map(Boolean);
    } else if (saved.range === '1' || saved.range === '2' || saved.range === '3') {
      var n = +saved.range;
      s.registers = oneHot(D.REGISTER_COUNT, [0, 1, 2].filter(function (i) { return i < n; }));
    }
    s.chordRegisters = boolArray(saved.chordRegisters, D.REGISTER_COUNT, 1, s.chordRegisters);

    s.learnMode = oneOf(saved.learnMode, MODES, s.learnMode);
    s.anchorOn = saved.anchorOn !== false;
    if (isInt(saved.anchorMidi) && saved.anchorMidi >= 60 && saved.anchorMidi < 72) s.anchorMidi = saved.anchorMidi;
    s.cmpA = oneOf(saved.cmpA, D.QUALITY_KEYS, s.cmpA);
    s.cmpB = oneOf(saved.cmpB, D.QUALITY_KEYS, s.cmpB);
    s.arpeggio = !!saved.arpeggio;

    return s;
  }

  // Always returns a usable settings object, defaults if nothing is stored.
  function loadSettings() {
    var saved = null;
    try {
      var raw = window.localStorage.getItem(SETTINGS_KEY);
      if (raw) saved = JSON.parse(raw);
    } catch (e) {
      if (!(e instanceof SyntaxError)) storageOK = false;
    }
    settingsLoaded = true;
    return normalizeSettings(saved);
  }

  // Does nothing before loadSettings(), so defaults can never overwrite what
  // is stored. Returns the normalized settings that were written.
  function saveSettings(settings) {
    var clean = normalizeSettings(settings);
    if (!storageOK || !settingsLoaded) return clean;
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(clean));
    } catch (e) {
      storageOK = false;
    }
    return clean;
  }

  /* ---------- history ---------- */

  function emptyHistory() { return { answers: [], matches: [], plays: [] }; }

  function loadHistory() {
    history = emptyHistory();
    try {
      var raw = window.localStorage.getItem(HISTORY_KEY);
      if (raw) {
        var h = JSON.parse(raw);
        // Same acceptance rule as the old app: answers and matches must be arrays.
        if (isObject(h) && Array.isArray(h.answers) && Array.isArray(h.matches)) {
          history.answers = h.answers.filter(isObject);
          history.matches = h.matches.filter(isObject);
          // Older saves have no plays log.
          history.plays = Array.isArray(h.plays) ? h.plays.filter(isObject) : [];
        }
      }
    } catch (e) {
      if (!(e instanceof SyntaxError)) storageOK = false;
    }
    historyLoaded = true;
    return history;
  }

  function getHistory() { return history; }

  function cap(list, max) {
    if (list.length > max) list.splice(0, list.length - max);
  }

  // One entry per graded answer. `kind` is note | root | qual | ivl. Target and
  // guess are always stored as strings: a pitch class "0"-"11", a quality key,
  // or a semitone count.
  function pushAnswer(kind, target, guess) {
    var entry = { k: kind, t: String(target), g: String(guess), ts: Date.now() };
    history.answers.push(entry);
    cap(history.answers, MAX_ANSWERS);
    return entry;
  }

  // One entry per question: how many listens it took and whether it landed.
  function pushPlay(correct, plays, mode) {
    var entry = { ts: Date.now(), correct: !!correct, plays: Math.max(1, plays | 0), mode: mode };
    history.plays.push(entry);
    cap(history.plays, MAX_PLAYS);
    return entry;
  }

  // `match` is { ts, points, hits, answered, acc, mode, method, difficulty,
  // quals, guess, playAs, notes, registers, ko }, built by the game.
  function pushMatch(match) {
    history.matches.push(match);
    cap(history.matches, MAX_MATCHES);
    return match;
  }

  // Call once after a batch of pushes. Does nothing before loadHistory().
  function saveHistory() {
    if (!storageOK || !historyLoaded) return;
    try {
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch (e) {
      storageOK = false;
    }
  }

  return {
    SETTINGS_KEY: SETTINGS_KEY,
    HISTORY_KEY: HISTORY_KEY,
    MAX_ANSWERS: MAX_ANSWERS,
    MAX_MATCHES: MAX_MATCHES,
    MAX_PLAYS: MAX_PLAYS,

    available: function () { return storageOK; },
    defaultSettings: defaultSettings,
    normalizeSettings: normalizeSettings,
    loadSettings: loadSettings,
    saveSettings: saveSettings,

    loadHistory: loadHistory,
    history: getHistory,
    pushAnswer: pushAnswer,
    pushPlay: pushPlay,
    pushMatch: pushMatch,
    saveHistory: saveHistory
  };
})();
