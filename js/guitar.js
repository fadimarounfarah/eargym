/* Guitar chord voicings.
 *
 * Turns a chord (root pitch class + quality key) into the notes a guitarist
 * would actually play in standard tuning: a common open shape where one
 * exists, otherwise a movable barre shape with the root on string 6 (E-shape)
 * or string 5 (A-shape). An open shape always wins when there is one; else, of
 * the barre shapes that fit within frets 0 to 12, the one with the lowest
 * highest fret wins.
 *
 * Every shape keeps the root as its lowest note, so the voicing only depends on
 * the root's pitch class, not on a register.
 *
 * A shape is six entries, string 6 (low E) first: a fret number, or null for a
 * string that is not played. Movable shapes are written as offsets from the
 * barre fret b.
 *
 * No DOM and no audio. Depends on: MusicData (js/data.js).
 */
var Guitar = (function () {
  'use strict';

  var D = MusicData;

  // Open-string MIDI notes, string 6 to string 1: E2 A2 D3 G3 B3 E4.
  var TUNING = [40, 45, 50, 55, 59, 64];
  var MAX_FRET = 12;
  var x = null;

  // Common open shapes: root pitch class, quality, frets (string 6 first).
  // Each one has every note of its chord. C7 is not here: its usual open
  // shape (x32310) has no 5th, so the A-shape barre at fret 3 is used.
  var OPEN = [
    { root: 0,  q: 'maj',  frets: [x, 3, 2, 0, 1, 0] },   // C
    { root: 9,  q: 'maj',  frets: [x, 0, 2, 2, 2, 0] },   // A
    { root: 7,  q: 'maj',  frets: [3, 2, 0, 0, 0, 3] },   // G
    { root: 4,  q: 'maj',  frets: [0, 2, 2, 1, 0, 0] },   // E
    { root: 2,  q: 'maj',  frets: [x, x, 0, 2, 3, 2] },   // D
    { root: 9,  q: 'min',  frets: [x, 0, 2, 2, 1, 0] },   // Am
    { root: 4,  q: 'min',  frets: [0, 2, 2, 0, 0, 0] },   // Em
    { root: 2,  q: 'min',  frets: [x, x, 0, 2, 3, 1] },   // Dm
    { root: 9,  q: 'dom7', frets: [x, 0, 2, 0, 2, 0] },   // A7
    { root: 7,  q: 'dom7', frets: [3, 2, 0, 0, 0, 1] },   // G7
    { root: 4,  q: 'dom7', frets: [0, 2, 0, 1, 0, 0] },   // E7
    { root: 2,  q: 'dom7', frets: [x, x, 0, 2, 1, 2] },   // D7
    { root: 11, q: 'dom7', frets: [x, 2, 1, 2, 0, 2] },   // B7
    { root: 9,  q: 'min7', frets: [x, 0, 2, 0, 1, 0] },   // Am7
    { root: 4,  q: 'min7', frets: [0, 2, 0, 0, 0, 0] },   // Em7
    { root: 2,  q: 'min7', frets: [x, x, 0, 2, 1, 1] },   // Dm7
    { root: 0,  q: 'maj7', frets: [x, 3, 2, 0, 0, 0] },   // Cmaj7
    { root: 5,  q: 'maj7', frets: [x, x, 3, 2, 1, 0] },   // Fmaj7
    { root: 9,  q: 'maj7', frets: [x, 0, 2, 1, 2, 0] },   // Amaj7
    { root: 2,  q: 'maj7', frets: [x, x, 0, 2, 2, 2] },   // Dmaj7
    { root: 4,  q: 'maj7', frets: [0, 2, 1, 1, 0, 0] }    // Emaj7
  ];

  // Movable shapes as offsets from the barre fret b. E-shapes put the root on
  // string 6 at fret b, A-shapes on string 5 at fret b.
  var MOVABLE = {
    E: {
      rootString: 0,
      maj:   [0, 2, 2, 1, 0, 0],
      min:   [0, 2, 2, 0, 0, 0],
      aug:   [0, x, 2, 1, 1, x],
      dim:   [0, 1, 2, 0, x, x],
      maj7:  [0, x, 1, 1, 0, x],
      min7:  [0, 2, 0, 0, 0, 0],
      dom7:  [0, 2, 0, 1, 0, 0],
      hdim7: [0, x, 0, 0, -1, x],
      dim7:  [0, x, -1, 0, -1, x]
    },
    A: {
      rootString: 1,
      maj:   [x, 0, 2, 2, 2, 0],
      min:   [x, 0, 2, 2, 1, 0],
      aug:   [x, 0, 3, 2, 2, x],
      dim:   [x, 0, 1, 2, 1, x],
      maj7:  [x, 0, 2, 1, 2, 0],
      min7:  [x, 0, 2, 0, 1, 0],
      dom7:  [x, 0, 2, 0, 2, 0],
      hdim7: [x, 0, 1, 0, 1, x],
      dim7:  [x, 0, 1, -1, 1, x]
    }
  };

  function pitchesOf(frets) {
    var out = [];
    frets.forEach(function (f, s) { if (f !== null) out.push(TUNING[s] + f); });
    return out.sort(function (a, b) { return a - b; });
  }

  function highestFret(frets) {
    return frets.reduce(function (m, f) { return f === null ? m : Math.max(m, f); }, 0);
  }

  function fits(frets) {
    return frets.every(function (f) { return f === null || (f >= 0 && f <= MAX_FRET); });
  }

  // Every shape that plays this chord within frets 0 to 12.
  function candidates(rootPc, q) {
    var out = [];
    OPEN.forEach(function (o) {
      if (o.root === rootPc && o.q === q) out.push({ frets: o.frets.slice(), shape: 'open' });
    });
    Object.keys(MOVABLE).forEach(function (name) {
      var m = MOVABLE[name];
      var offsets = m[q];
      if (!offsets) return;
      // The barre fret that puts the root on the root string, and the octave up.
      var b0 = D.pc(rootPc - TUNING[m.rootString]);
      [b0, b0 + 12].forEach(function (b) {
        var frets = offsets.map(function (o) { return o === null ? null : b + o; });
        if (fits(frets)) out.push({ frets: frets, shape: name + '-shape', barre: b });
      });
    });
    return out;
  }

  // The voicing for a chord: { frets, pitches (MIDI, low to high), shape }.
  // Falls back to close position from E2 if no shape fits, which no root and
  // quality in the app needs today.
  function voicing(rootPc, q) {
    var list = candidates(D.pc(rootPc), q);
    if (!list.length) {
      var low = TUNING[0] + D.pc(rootPc - TUNING[0]);
      return { frets: null, pitches: D.chordPitches(low, q), shape: 'close' };
    }
    list.sort(function (a, b) {
      var open = (a.shape === 'open' ? 0 : 1) - (b.shape === 'open' ? 0 : 1);
      return open || highestFret(a.frets) - highestFret(b.frets);
    });
    var best = list[0];
    return { frets: best.frets, pitches: pitchesOf(best.frets), shape: best.shape };
  }

  return {
    TUNING: TUNING,
    MAX_FRET: MAX_FRET,
    OPEN: OPEN,
    MOVABLE: MOVABLE,
    candidates: candidates,
    voicing: voicing,
    pitchesOf: pitchesOf
  };
})();
