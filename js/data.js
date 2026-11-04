/* Music data and pitch helpers.
 *
 * Everything is MIDI numbers (C4 = 60) and pitch classes (0-11, C = 0).
 * Sharps only. Loaded as a plain script: it defines one global, MusicData,
 * so later files can destructure what they need.
 *
 * Depends on: Instruments (js/instruments.js), for the playable range.
 */
var MusicData = (function () {
  'use strict';

  var NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  var NATURALS = NOTES.filter(function (n) { return n.indexOf('#') === -1; });

  var NOTE_PRESETS = {
    all: NOTES.slice(),
    naturals: NATURALS.slice()
  };

  // Nine qualities as semitone offsets from the root. Keys are stored in
  // history entries ({ k: 'qual', t: 'maj7' }) so they must never change.
  var CHORDS = {
    maj:   { key: 'maj',   label: 'maj',   name: 'major',             intervals: [0, 4, 7] },
    min:   { key: 'min',   label: 'min',   name: 'minor',             intervals: [0, 3, 7] },
    aug:   { key: 'aug',   label: 'aug',   name: 'augmented',         intervals: [0, 4, 8] },
    dim:   { key: 'dim',   label: 'dim',   name: 'diminished',        intervals: [0, 3, 6] },
    maj7:  { key: 'maj7',  label: 'maj7',  name: 'major 7th',         intervals: [0, 4, 7, 11] },
    min7:  { key: 'min7',  label: 'min7',  name: 'minor 7th',         intervals: [0, 3, 7, 10] },
    dom7:  { key: 'dom7',  label: 'dom7',  name: 'dominant 7th',      intervals: [0, 4, 7, 10] },
    hdim7: { key: 'hdim7', label: 'hdim7', name: 'half-diminished 7', intervals: [0, 3, 6, 10] },
    dim7:  { key: 'dim7',  label: 'dim7',  name: 'diminished 7th',    intervals: [0, 3, 6, 9] }
  };
  var QUALITY_KEYS = Object.keys(CHORDS);

  var QUALITY_PRESETS = {
    basic:    ['maj', 'min'],
    triads:   ['maj', 'min', 'aug', 'dim'],
    sevenths: ['maj7', 'min7', 'dom7', 'hdim7', 'dim7'],
    all:      QUALITY_KEYS.slice()
  };
  var DEFAULT_QUALITIES = QUALITY_PRESETS.basic.slice();

  // Widest chord shape above its root (maj7).
  var CHORD_REACH = QUALITY_KEYS.reduce(function (max, k) {
    var iv = CHORDS[k].intervals;
    return Math.max(max, iv[iv.length - 1]);
  }, 0);

  // Intervals 1-12 semitones, each with an ascending song reference for Learn.
  var INTERVALS = [
    { semi: 1,  label: 'm2', name: 'minor 2nd',   song: 'Jaws theme' },
    { semi: 2,  label: 'M2', name: 'major 2nd',   song: 'Happy Birthday (first two notes)' },
    { semi: 3,  label: 'm3', name: 'minor 3rd',   song: 'Smoke on the Water' },
    { semi: 4,  label: 'M3', name: 'major 3rd',   song: 'When the Saints Go Marching In' },
    { semi: 5,  label: 'P4', name: 'perfect 4th', song: 'Here Comes the Bride' },
    { semi: 6,  label: 'A4', name: 'tritone',     song: 'The Simpsons theme' },
    { semi: 7,  label: 'P5', name: 'perfect 5th', song: 'Star Wars main theme' },
    { semi: 8,  label: 'm6', name: 'minor 6th',   song: 'The Entertainer' },
    { semi: 9,  label: 'M6', name: 'major 6th',   song: 'My Bonnie Lies Over the Ocean' },
    { semi: 10, label: 'm7', name: 'minor 7th',   song: 'Star Trek theme' },
    { semi: 11, label: 'M7', name: 'major 7th',   song: 'Take On Me (chorus leap)' },
    { semi: 12, label: 'P8', name: 'octave',      song: 'Somewhere Over the Rainbow' }
  ];

  // Widest interval (the octave): how far above a root an interval reaches.
  var INTERVAL_REACH = INTERVALS[INTERVALS.length - 1].semi;

  var INTERVAL_PRESETS = {
    wide:   [4, 5, 7, 12],
    thirds: [3, 4],
    all:    INTERVALS.map(function (iv) { return iv.semi; })
  };
  var DEFAULT_INTERVALS = INTERVAL_PRESETS.wide.slice();

  function intervalBySemi(semi) {
    for (var i = 0; i < INTERVALS.length; i++) {
      if (INTERVALS[i].semi === semi) return INTERVALS[i];
    }
    return null;
  }

  // One-octave registers cut from an instrument's playable range: for the
  // piano C3-B3, C4-B4, C5-B5; for the guitar E2-D#3, E3-D#4, E4-D#5. Settings
  // and history store registers as a [bool, bool, bool] selection, so every
  // instrument has exactly 3 (see "Instrument assumptions" in CLAUDE.md).
  // REGISTER_LOW and REGISTERS are the default instrument's (the piano's): the
  // piano boards and Learn use them. Practice uses registersOf(instrumentId).
  function buildRegisters(low) {
    var out = [];
    for (var r = 0; r < REGISTER_COUNT; r++) {
      out.push({
        index: r,
        low: low + r * 12,
        high: low + r * 12 + 11,
        label: midiToName(low + r * 12) + '–' + midiToName(low + r * 12 + 11)
      });
    }
    return out;
  }
  var RANGE = Instruments.get(Instruments.DEFAULT).range;
  var REGISTER_LOW = RANGE.low;                                  // C3
  var REGISTER_COUNT = Math.floor((RANGE.high - RANGE.low + 1) / 12);   // 3
  var REGISTERS = buildRegisters(REGISTER_LOW);

  // The lowest note of an instrument's first register, and its registers.
  function registerLowOf(instrumentId) { return Instruments.get(instrumentId).range.low; }
  function registersOf(instrumentId) { return buildRegisters(registerLowOf(instrumentId)); }
  var DEFAULT_REGISTERS = [true, false, false];

  /* ---------- helpers ---------- */

  // Pitch class of a MIDI number, safe for negatives.
  function pc(midi) { return ((midi % 12) + 12) % 12; }

  // Scientific octave: MIDI 60 -> 4.
  function octaveOf(midi) { return Math.floor(midi / 12) - 1; }

  function midiToName(midi) { return NOTES[pc(midi)] + octaveOf(midi); }

  function midiToFreq(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

  function pcToName(p) { return NOTES[pc(p)]; }

  function nameToPc(name) { return NOTES.indexOf(name); }

  // 'C#4' -> 61. Returns null for anything it cannot parse.
  function nameToMidi(name) {
    var m = /^([A-G]#?)(-?\d+)$/.exec(String(name));
    if (!m) return null;
    var p = NOTES.indexOf(m[1]);
    if (p < 0) return null;
    return (parseInt(m[2], 10) + 1) * 12 + p;
  }

  function midiFrom(pitchClass, octave) { return (octave + 1) * 12 + pc(pitchClass); }

  function isBlack(midi) { return NOTES[pc(midi)].indexOf('#') !== -1; }

  // Shortest way round the pitch-class circle: 0..6.
  function pcDistance(a, b) {
    var d = Math.abs(pc(a) - pc(b));
    return Math.min(d, 12 - d);
  }

  // Which register (0-based) a MIDI number falls in, or -1 if outside all.
  // `low` is the first register's lowest note (default: the piano's C3).
  function registerOf(midi, low) {
    var i = Math.floor((midi - (low === undefined ? REGISTER_LOW : low)) / 12);
    return i >= 0 && i < REGISTER_COUNT ? i : -1;
  }

  // Indices of the enabled registers in a [bool, bool, bool] selection.
  function enabledRegisters(sel) {
    var out = [];
    for (var i = 0; i < REGISTER_COUNT; i++) if (sel && sel[i]) out.push(i);
    return out;
  }

  // MIDI of a pitch class within a register. `low` is the first register's
  // lowest note (default: the piano's C3); registers need not start on a C.
  function midiInRegister(pitchClass, regIndex, low) {
    if (low === undefined) low = REGISTER_LOW;
    return low + regIndex * 12 + pc(pitchClass - low);
  }

  function chordPitches(rootMidi, qualityKey) {
    return CHORDS[qualityKey].intervals.map(function (i) { return rootMidi + i; });
  }

  function chordName(rootPc, qualityKey) {
    return pcToName(rootPc) + ' ' + CHORDS[qualityKey].name;
  }

  return {
    NOTES: NOTES,
    NATURALS: NATURALS,
    NOTE_PRESETS: NOTE_PRESETS,
    CHORDS: CHORDS,
    QUALITY_KEYS: QUALITY_KEYS,
    QUALITY_PRESETS: QUALITY_PRESETS,
    DEFAULT_QUALITIES: DEFAULT_QUALITIES,
    CHORD_REACH: CHORD_REACH,
    INTERVALS: INTERVALS,
    INTERVAL_REACH: INTERVAL_REACH,
    INTERVAL_PRESETS: INTERVAL_PRESETS,
    DEFAULT_INTERVALS: DEFAULT_INTERVALS,
    REGISTER_LOW: REGISTER_LOW,
    REGISTER_COUNT: REGISTER_COUNT,
    REGISTERS: REGISTERS,
    DEFAULT_REGISTERS: DEFAULT_REGISTERS,
    registerLowOf: registerLowOf,
    registersOf: registersOf,

    intervalBySemi: intervalBySemi,
    pc: pc,
    octaveOf: octaveOf,
    midiToName: midiToName,
    midiToFreq: midiToFreq,
    pcToName: pcToName,
    nameToPc: nameToPc,
    nameToMidi: nameToMidi,
    midiFrom: midiFrom,
    isBlack: isBlack,
    pcDistance: pcDistance,
    registerOf: registerOf,
    enabledRegisters: enabledRegisters,
    midiInRegister: midiInRegister,
    chordPitches: chordPitches,
    chordName: chordName
  };
})();
