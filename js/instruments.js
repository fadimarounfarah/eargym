/* Instrument registry.
 *
 * An instrument is a plain object describing everything the audio layer needs
 * to make its sound: where its samples live, the notes it can play, how its
 * voices release, how loud it is, and the synth to fall back on when the
 * samples cannot load. The click-free fade timings in PianoAudio.playPitches
 * are not part of an instrument: they are shared by all of them.
 *
 * Only "piano" is registered for now. It holds exactly the Salamander setup the
 * app has always used.
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

  // Salamander has C, D#, F# and A in octaves 3 to 7: 20 files.
  function salamanderFiles() {
    var files = {};
    var names = { 0: 'C', 3: 'Ds', 6: 'Fs', 9: 'A' };
    for (var oct = 3; oct <= 7; oct++) {
      Object.keys(names).forEach(function (p) {
        files[(oct + 1) * 12 + Number(p)] = names[p] + oct + '.mp3';
      });
    }
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
