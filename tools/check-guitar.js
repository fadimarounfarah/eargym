/* Checks for the guitar instrument. Not part of the app and not loaded by it.
 *
 *   node tools/check-guitar.js
 *
 * Loads the app's own scripts into a sandbox (no browser needed) and checks:
 *   1. every root x quality voicing: its pitch classes equal the chord's, it is
 *      playable (frets 0-12, at most a 4-fret window: highest fretted minus
 *      lowest fretted <= 3), the root is the lowest note, and open shapes win
 *      where they exist;
 *   2. the guitar's registers, and that every note a guitar question can sound
 *      stays at or below F5 (77), 3 semitones above the top sample (D5);
 *   3. the Intervals F5 cap and its fallback, and that piano is unaffected;
 *   4. history tagging: new entries get `i`, untagged ones count as piano, and
 *      an old export (no `i`) still merges.
 * Exits with status 1 if anything fails.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var root = path.join(__dirname, '..');
var store = {};
var sandbox = {
  console: console,
  window: {
    location: { protocol: 'http:' },
    localStorage: {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem: function (k, v) { store[k] = String(v); },
      removeItem: function (k) { delete store[k]; }
    }
  }
};
vm.createContext(sandbox);
['js/instruments.js', 'js/data.js', 'js/guitar.js', 'js/storage.js', 'js/game.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8') + '\n;this.Instruments = typeof Instruments !== "undefined" ? Instruments : this.Instruments;' +
    'this.MusicData = typeof MusicData !== "undefined" ? MusicData : this.MusicData;' +
    'this.Guitar = typeof Guitar !== "undefined" ? Guitar : this.Guitar;' +
    'this.Store = typeof Store !== "undefined" ? Store : this.Store;' +
    'this.Game = typeof Game !== "undefined" ? Game : this.Game;', sandbox, { filename: f });
});
var I = sandbox.Instruments, D = sandbox.MusicData, G = sandbox.Guitar, Store = sandbox.Store, Game = sandbox.Game;

var failures = 0;
function check(ok, msg) {
  if (!ok) { failures++; console.log('  FAIL ' + msg); }
}
function sameSet(a, b) {
  var x = a.slice().sort(function (p, q) { return p - q; }).join(',');
  var y = b.slice().sort(function (p, q) { return p - q; }).join(',');
  return x === y;
}
function uniq(a) { return a.filter(function (v, i) { return a.indexOf(v) === i; }); }

/* 1. voicings */
console.log('1. Voicings, 12 roots x 9 qualities');
var shapes = {}, top = 0, close = [];
D.QUALITY_KEYS.forEach(function (q) {
  var row = [];
  for (var r = 0; r < 12; r++) {
    var v = G.voicing(r, q);
    var name = D.chordName(r, q);
    if (v.shape === 'close') { close.push(name); continue; }
    var chordPcs = D.CHORDS[q].intervals.map(function (i) { return (r + i) % 12; });
    var pcs = uniq(v.pitches.map(D.pc));
    check(sameSet(pcs, chordPcs), name + ': pitch classes ' + pcs + ' != ' + chordPcs);
    var fretted = v.frets.filter(function (f) { return f !== null; });
    check(fretted.every(function (f) { return f >= 0 && f <= 12; }), name + ': fret outside 0-12 ' + JSON.stringify(v.frets));
    var pressed = fretted.filter(function (f) { return f > 0; });
    var span = pressed.length ? Math.max.apply(null, pressed) - Math.min.apply(null, pressed) : 0;
    check(span <= 3, name + ': span ' + span + ' frets ' + JSON.stringify(v.frets));
    check(D.pc(v.pitches[0]) === r, name + ': lowest note is not the root');
    check(v.pitches.length >= 3, name + ': fewer than 3 strings');
    var hasOpen = G.OPEN.some(function (o) { return o.root === r && o.q === q; });
    if (hasOpen) check(v.shape === 'open', name + ': an open shape exists but ' + v.shape + ' was chosen');
    top = Math.max(top, v.pitches[v.pitches.length - 1]);
    shapes[v.shape] = (shapes[v.shape] || 0) + 1;
    row.push(D.pcToName(r) + ':' + v.frets.map(function (f) { return f === null ? 'x' : f; }).join(''));
  }
  console.log('  ' + (q + '      ').slice(0, 6) + row.join(' '));
});
console.log('  shapes used: ' + JSON.stringify(shapes) + '; close-position fallbacks: ' + (close.length ? close.join(', ') : 'none'));
console.log('  highest voiced note: ' + D.midiToName(top) + ' (' + top + ')');
check(top <= 77, 'a voicing goes above F5');

/* 2. registers and the highest note any guitar question sounds */
console.log('2. Guitar registers and reach');
var regs = D.registersOf('guitar').map(function (r) { return r.label; });
console.log('  registers: ' + regs.join(', '));
check(regs.join(',') === 'E2–D#3,E3–D#4,E4–D#5', 'guitar registers');
check(D.registersOf('piano').map(function (r) { return r.label; }).join(',') === 'C3–B3,C4–B4,C5–B5', 'piano registers');
check(D.REGISTER_COUNT === 3, 'three registers');
var gi = I.get('guitar');
var sampleTop = Math.max.apply(null, Object.keys(gi.samples.files).map(Number));
check(sampleTop === 74 && gi.maxSounding === 77, 'top sample D5 and cap F5');
var all3 = [true, true, true];
var allNotes = D.NOTES.map(function () { return true; });
var noteTop = Math.max.apply(null, Game.noteCandidates(allNotes, all3, D.registerLowOf('guitar')));
var noteLow = Math.min.apply(null, Game.noteCandidates(allNotes, all3, D.registerLowOf('guitar')));
console.log('  Notes on guitar: ' + D.midiToName(noteLow) + ' to ' + D.midiToName(noteTop));
check(noteLow === 40 && noteTop === 75, 'guitar notes span E2-D#5');

/* 3. Intervals cap */
console.log('3. Intervals F5 cap');
function settings(patch) {
  var s = Store.defaultSettings();
  Object.keys(patch).forEach(function (k) { s[k] = patch[k]; });
  return Store.normalizeSettings(s);
}
function ivlSel(semis) { return D.INTERVALS.map(function (iv) { return semis.indexOf(iv.semi) !== -1; }); }
function decode(keys) {
  return keys.map(function (k) { var p = k.split('|'); return { low: +p[0], semi: +p[1] }; });
}
var allSemis = D.INTERVALS.map(function (iv) { return iv.semi; });
var worstTop = 0, emptyPools = 0, under2 = 0, combos = 0;
// Every register selection x every root setting x a spread of interval sets.
var sets = [[1, 2], [11, 12], [7, 12], [4, 5, 7, 12], allSemis, [3, 4], [6, 12], [10, 11, 12]];
for (var mask = 1; mask < 8; mask++) {
  var reg = [!!(mask & 1), !!(mask & 2), !!(mask & 4)];
  ['random'].concat([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]).forEach(function (rootSetting) {
    sets.forEach(function (semis) {
      combos++;
      var s = settings({ mode: 'intervals', instrument: 'guitar', registers: reg, ivlRoot: rootSetting, ivlSel: ivlSel(semis) });
      var c = decode(Game.intervalCandidates(s));
      if (!c.length) { emptyPools++; return; }
      var sizes = uniq(c.map(function (x) { return x.semi; }));
      if (sizes.length < 2) under2++;
      var capped = c.filter(function (x) { return x.low + x.semi <= 77; });
      if (capped.length === c.length) c.forEach(function (x) { worstTop = Math.max(worstTop, x.low + x.semi); });
    });
  });
}
console.log('  ' + combos + ' setups: empty pools ' + emptyPools + ', pools with < 2 sizes ' + under2 + ', highest note when the cap holds ' + D.midiToName(worstTop));
check(emptyPools === 0, 'an interval pool was empty');
check(under2 === 0, 'an interval pool had fewer than 2 sizes');
check(worstTop <= 77, 'a capped pool went above F5');

// The fallback: E4-D#5 only, root D#, P5 and P8: both go above F5, so the two
// smallest sizes are kept uncapped.
var fb = decode(Game.intervalCandidates(settings({ mode: 'intervals', instrument: 'guitar', registers: [false, false, true], ivlRoot: 3, ivlSel: ivlSel([7, 12]) })));
console.log('  fallback example (E4–D#5, root D#, P5+P8): ' + fb.map(function (x) { return D.midiToName(x.low) + '+' + x.semi; }).join(', '));
check(fb.length === 2 && sameSet(fb.map(function (x) { return x.semi; }), [7, 12]), 'fallback keeps P5 and P8');
// Three sizes, only the smallest fits: m2 is kept capped, M3 uncapped, P8 dropped.
var fb2 = decode(Game.intervalCandidates(settings({ mode: 'intervals', instrument: 'guitar', registers: [false, false, true], ivlRoot: 3, ivlSel: ivlSel([1, 4, 12]) })));
console.log('  fallback example (E4–D#5, root D#, m2+M3+P8): ' + fb2.map(function (x) { return D.midiToName(x.low) + '+' + x.semi; }).join(', '));
check(sameSet(uniq(fb2.map(function (x) { return x.semi; })), [1, 4]), 'fallback drops the highest size first');

// Piano: no cap, same candidates as before (every register x root x interval).
var pianoS = settings({ mode: 'intervals', instrument: 'piano', registers: all3, ivlSel: ivlSel(allSemis) });
var pianoKeys = Game.intervalCandidates(pianoS);
check(pianoKeys.length === 3 * 12 * 12, 'piano interval pool is uncapped');
check(pianoKeys[0] === '48|1' && pianoKeys[pianoKeys.length - 1] === '83|12', 'piano interval keys unchanged');
var guitarDefault = decode(Game.intervalCandidates(settings({ mode: 'intervals', instrument: 'guitar' })));
console.log('  default Intervals setup on guitar (E2–D#3, M3 P4 P5 P8): ' + guitarDefault.length + ' questions, none dropped');

// Chords on guitar: one candidate per root x quality, voiced; piano unchanged.
var gc = Game.candidatesFor(settings({ mode: 'chords', instrument: 'guitar', chordRegisters: all3 }));
check(gc.length === 12 * 2, 'guitar chord candidates ignore registers');
var pc = Game.candidatesFor(settings({ mode: 'chords', instrument: 'piano', chordRegisters: all3 }));
check(pc.length === 3 * 12 * 2 && pc[0] === '48|maj', 'piano chord candidates unchanged');
check(!Game.pianoAllowed(settings({ mode: 'notes', instrument: 'guitar' })) && Game.pianoAllowed(settings({ mode: 'notes', instrument: 'piano' })), 'piano input only for piano');

/* 4. history tagging */
console.log('4. History tagging');
Store.loadHistory();
var e1 = Store.pushAnswer('note', 3, 3, 'guitar');
var e2 = Store.pushPlay(true, 1, 'notes', 'piano');
check(e1.i === 'guitar' && e2.i === 'piano', 'new entries are tagged');
check(Store.instrumentOf({ k: 'note', t: '1', g: '1', ts: 1 }) === 'piano', 'untagged entry counts as piano');
var old = { answers: [{ k: 'note', t: '0', g: '0', ts: 10 }], matches: [{ ts: 11, points: 100, hits: 1, answered: 1, acc: 1, mode: 'notes' }] };
var res = Store.mergeHistory(JSON.parse(JSON.stringify(old)));
check(res.ok && res.skipped === 0 && res.answers === 2, 'an old export without i merges');
var again = Store.mergeHistory(JSON.parse(JSON.stringify(old)));
check(again.answers === 2 && again.matches === 1, 'merging it again dedupes');
var tagged = Store.mergeHistory({ answers: [{ k: 'ivl', t: '7', g: '7', ts: 12, i: 'guitar' }], matches: [], plays: [{ ts: 13, correct: true, plays: 2, mode: 'intervals', i: 'guitar' }] });
var h = Store.history();
check(tagged.ok && h.answers.some(function (a) { return a.ts === 12 && a.i === 'guitar'; }) && h.plays.some(function (p) { return p.ts === 13 && p.i === 'guitar'; }), 'imported i is kept');
var bad = Store.mergeHistory({ answers: [{ k: 'note', t: '1', g: '1', ts: 14, i: { x: 1 } }], matches: [] });
check(bad.ok && h.answers.some(function (a) { return a.ts === 14 && a.i === undefined; }), 'a malformed i is dropped, the answer kept');
check(Object.keys(JSON.parse(Store.exportJson())).join(',') === 'answers,matches,plays', 'export shape unchanged');
check(Store.normalizeSettings({ instrument: 'banjo' }).instrument === 'piano' && Store.normalizeSettings({ instrument: 'guitar' }).instrument === 'guitar', 'instrument setting validated');
check(Store.normalizeSettings({ refPitch: 40 }).refPitch === 40 && Store.normalizeSettings({ refPitch: 84 }).refPitch === 0, 'refPitch accepts E2-B5');

console.log(failures ? '\n' + failures + ' check(s) FAILED' : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
