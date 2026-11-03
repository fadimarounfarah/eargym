/* Instrument registry.
 *
 * An instrument is a plain object describing everything the audio layer needs
 * to make its sound: where its samples live, the notes it can play, how its
 * voices release, how loud it is, and the synth to fall back on when the
 * samples cannot load. The click-free fade timings in PianoAudio.playPitches
 * are not part of an instrument: they are shared by all of them.
 *
 * Two are registered: "piano", exactly the Salamander setup the app has always
 * used, and "guitar", the University of Iowa steel-string acoustic.
 *
 * Fields:
 *   id            key stored in settings.instrument
 *   label         short name ("Piano")
 *   range         { low, high } MIDI of the playable notes: questions are drawn
 *                 from here and the registers are cut from it, one octave each.
 *                 Must start on a C and span whole octaves
 *   samples       { local, remote, files }
 *                   local   vendored folder, used when served over http(s)
 *                   remote  same files online, used when opened from disk
 *                   files   { midi: filename } for every sample; other notes are
 *                           pitch-shifted from the nearest one
 *   release       s, fade-out of a sample voice when it stops
 *   volumeDb      sample output level
 *   sourceLabel   footer text while the samples are in use
 *   loadingLabel  hint text while the samples load
 *   maxSounding   MIDI of the highest note worth playing, or null for no limit.
 *                 Interval questions whose top note is higher are left out
 *                 (see Game.intervalCandidates)
 *   keyboardInput true if the on-screen piano can be used to answer
 *   chordVoicing  'close' (stack the chord shape on the root) or 'guitar'
 *                 (a real guitar voicing from js/guitar.js, strummed)
 *   synth         fallback additive synth used when the samples fail:
 *                   label     footer text, followed by " (reason)"
 *                   partials  { mult, gain, decay } per sine partial
 *                   stretch   inharmonic stretch per partial (x mult²)
 *                   detune    random detune span, cents
 *                   level     peak gain of one voice
 *                   stopRamp  s, fade when a voice stops
 *                   lowpass   Hz, shared output filter
 *                   noise     attack noise { dur, harmonic, gain }: band-passed
 *                             around that harmonic, decaying over dur seconds
 *
 * No dependencies, and no window or document access, so the service worker
 * can load this file too (sw.js uses it to precache every sample).
 */
var Instruments = (function () {
  'use strict';

  var DEFAULT = 'piano';

  function midi(pc, octave) { return (octave + 1) * 12 + pc; }

  // Salamander has C, D#, F# and A in octaves 3 to 7: 20 files.
  function salamanderFiles() {
    var files = {};
    var names = { 0: 'C', 3: 'Ds', 6: 'Fs', 9: 'A' };
    for (var oct = 3; oct <= 7; oct++) {
      Object.keys(names).forEach(function (p) {
        files[midi(Number(p), oct)] = names[p] + oct + '.mp3';
      });
    }
    return files;
  }

  // The Iowa acoustic guitar set is recorded on every semitone from D2 to D5.
  // We ship every other one from E2 (the low string) up to D5, the top
  // recording: 18 files, so no note is shifted by more than a semitone.
  function guitarFiles() {
    var names = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B'];
    var files = {};
    for (var m = 40; m <= 74; m += 2) files[m] = names[m % 12] + (Math.floor(m / 12) - 1) + '.mp3';
    return files;
  }

  var LIST = [
    {
      id: 'piano',
      label: 'Piano',
      range: { low: 48, high: 83 },   // C3 to B5: three registers
      samples: {
        local: 'vendor/salamander/',
        remote: 'https://tonejs.github.io/audio/salamander/',
        files: salamanderFiles()
      },
      release: 0.06,
      volumeDb: -8,
      sourceLabel: 'Salamander Grand Piano samples',
      loadingLabel: 'loading piano samples…',
      maxSounding: null,
      keyboardInput: true,
      chordVoicing: 'close',
      synth: {
        label: 'built-in piano synth',
        partials: [
          { mult: 1, gain: 1.00, decay: 3.2 },
          { mult: 2, gain: 0.52, decay: 2.4 },
          { mult: 3, gain: 0.30, decay: 1.8 },
          { mult: 4, gain: 0.18, decay: 1.4 },
          { mult: 5, gain: 0.10, decay: 1.0 },
          { mult: 6, gain: 0.06, decay: 0.8 },
          { mult: 8, gain: 0.03, decay: 0.6 }
        ],
        stretch: 0.0004,
        detune: 4,
        level: 0.22,
        stopRamp: 0.025,
        lowpass: 6000,
        noise: { dur: 0.03, harmonic: 3, gain: 0.12 }   // the hammer
      }
    },
    {
      id: 'guitar',
      label: 'Guitar',
      range: { low: 40, high: 75 },   // E2 to D#5: three registers from the low E string
      samples: {
        local: 'vendor/guitar/',
        remote: 'https://raw.githubusercontent.com/nbrosowsky/tonejs-instruments/master/samples/guitar-acoustic/',
        files: guitarFiles()
      },
      release: 0.06,
      volumeDb: -14,                  // the recordings are about 6 dB hotter than the piano's
      sourceLabel: 'acoustic guitar samples',
      loadingLabel: 'loading guitar samples…',
      // The top recording is D5 (74). Shifting it up more than 3 semitones
      // sounds thin and short, so nothing above F5 (77) is asked.
      maxSounding: 77,
      keyboardInput: false,           // buttons only until the fretboard arrives
      chordVoicing: 'guitar',
      synth: {
        label: 'built-in guitar synth',
        partials: [
          { mult: 1, gain: 1.00, decay: 2.2 },
          { mult: 2, gain: 0.60, decay: 1.5 },
          { mult: 3, gain: 0.38, decay: 1.0 },
          { mult: 4, gain: 0.22, decay: 0.7 },
          { mult: 5, gain: 0.14, decay: 0.5 },
          { mult: 6, gain: 0.08, decay: 0.35 },
          { mult: 8, gain: 0.04, decay: 0.25 }
        ],
        stretch: 0.0002,
        detune: 4,
        level: 0.22,
        stopRamp: 0.025,
        lowpass: 4500,
        noise: { dur: 0.012, harmonic: 5, gain: 0.08 }  // the pick
      }
    }
  ];

  var BY_ID = {};
  LIST.forEach(function (inst) { BY_ID[inst.id] = inst; });

  function has(id) { return Object.prototype.hasOwnProperty.call(BY_ID, id); }

  // The instrument with this id, or the default one if there is none.
  function get(id) { return has(id) ? BY_ID[id] : BY_ID[DEFAULT]; }

  // Every sample path relative to the app folder, for the service worker.
  function localSamplePaths() {
    var out = [];
    LIST.forEach(function (inst) {
      Object.keys(inst.samples.files).forEach(function (m) {
        out.push(inst.samples.local + inst.samples.files[m]);
      });
    });
    return out;
  }

  return {
    DEFAULT: DEFAULT,
    ids: function () { return LIST.map(function (i) { return i.id; }); },
    has: has,
    get: get,
    localSamplePaths: localSamplePaths
  };
})();
