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
 * History can be exported, merged from an export (never replaced) and reset.
 *
 * The live settings object is held here: read it with settings(), change it
 * with change(fn). Every change is re-validated and saved.
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
    // The reference is any note across the three registers, or 0 for none.
    if (saved.refPitch === 0 || (isInt(saved.refPitch) && saved.refPitch >= D.REGISTER_LOW &&
        saved.refPitch < D.REGISTER_LOW + 12 * D.REGISTER_COUNT)) {
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
    // A pinned root is already known, so only the type can be asked.
    if (s.chordRoot !== 'random') s.guessTarget = 'type';

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

  var current = null;   // the live settings object

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
    current = normalizeSettings(saved);
    return current;
  }

  // The live settings. Treat it as read-only; change it with change().
  function getSettings() {
    if (!current) current = defaultSettings();
    return current;
  }

  // Run fn on a copy of the settings, then validate, keep and save the result.
  // Returns the new live settings.
  function change(fn) {
    var next = JSON.parse(JSON.stringify(getSettings()));
    fn(next);
    current = saveSettings(next);
    return current;
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

  /* ---------- export, import, reset ---------- */

  var ANSWER_KINDS = ['note', 'root', 'qual', 'ivl'];
  var MODE_NAMES = ['notes', 'chords', 'intervals'];

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function byTime(a, b) { return (Number(a.ts) || 0) - (Number(b.ts) || 0); }

  // The history as pretty-printed JSON, exactly what is stored. Settings are
  // not part of it.
  function exportJson() {
    return JSON.stringify(history, null, 2);
  }

  // Imported entries are checked before they are kept, so a bad file can never
  // put something into the history that would break the Stats tab.
  function cleanAnswer(a) {
    if (!isObject(a) || ANSWER_KINDS.indexOf(a.k) === -1 || !isNum(a.ts)) return null;
    if (a.t === undefined || a.t === null || a.g === undefined || a.g === null) return null;
    return { k: a.k, t: String(a.t), g: String(a.g), ts: a.ts };
  }

  function cleanMatch(m) {
    if (!isObject(m) || !isNum(m.ts) || !isNum(m.points) || !isNum(m.acc)) return null;
    if (MODE_NAMES.indexOf(m.mode) === -1) return null;
    return m;
  }

  function cleanPlay(p) {
    if (!isObject(p) || !isNum(p.ts) || !isNum(p.plays) || p.plays < 1 || MODE_NAMES.indexOf(p.mode) === -1) return null;
    return { ts: p.ts, correct: !!p.correct, plays: Math.floor(p.plays), mode: p.mode };
  }

  function answerKey(a) { return a.ts + '|' + a.k + '|' + a.t + '|' + a.g; }

  // Fold parsed export data into the history. Never replaces: what is already
  // on the device stays. Answers are de-duplicated on ts|k|t|g, matches and
  // plays on ts. Then everything is sorted by time and every cap is applied
  // again, oldest first.
  //
  // Returns { ok: false, error: 'shape' } if `data` is not a history export
  // (it needs answers and matches lists), else
  // { ok: true, matches, answers, plays, skipped } with the totals now held and
  // how many incoming entries were dropped as malformed.
  function mergeHistory(data) {
    if (!isObject(data) || !Array.isArray(data.answers) || !Array.isArray(data.matches)) {
      return { ok: false, error: 'shape' };
    }
    var skipped = 0;

    function fold(into, incoming, clean, keyOf) {
      var seen = {};
      into.forEach(function (e) { seen[keyOf(e)] = true; });
      incoming.forEach(function (raw) {
        var e = clean(raw);
        if (!e) { skipped++; return; }
        var key = keyOf(e);
        if (!seen[key]) { seen[key] = true; into.push(e); }
      });
      into.sort(byTime);
    }
    function byTs(e) { return String(e.ts); }

    fold(history.answers, data.answers, cleanAnswer, answerKey);
    fold(history.matches, data.matches, cleanMatch, byTs);
    fold(history.plays, Array.isArray(data.plays) ? data.plays : [], cleanPlay, byTs);

    cap(history.answers, MAX_ANSWERS);
    cap(history.matches, MAX_MATCHES);
    cap(history.plays, MAX_PLAYS);
    saveHistory();
    return {
      ok: true,
      matches: history.matches.length,
      answers: history.answers.length,
      plays: history.plays.length,
      skipped: skipped
    };
  }

  // Empty the history. The arrays are emptied in place, so anything holding the
  // object from history() still sees the live, empty history.
  function resetHistory() {
    history.answers.length = 0;
    history.matches.length = 0;
    history.plays.length = 0;
    saveHistory();
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
    settings: getSettings,
    change: change,

    loadHistory: loadHistory,
    history: getHistory,
    pushAnswer: pushAnswer,
    pushPlay: pushPlay,
    pushMatch: pushMatch,
    saveHistory: saveHistory,
    exportJson: exportJson,
    mergeHistory: mergeHistory,
    resetHistory: resetHistory
  };
})();
