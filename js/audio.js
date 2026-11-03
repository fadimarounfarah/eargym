/* Audio engine.
 *
 * Plays Salamander Grand Piano samples through Tone.js. If Tone.js is missing,
 * a sample fails, or loading takes longer than 15 s, it switches to a built-in
 * additive piano synth instead.
 *
 * The whole app makes sound through one call: PianoAudio.playPitches().
 *
 * Why voices are tracked here and not left to Tone.Sampler: in Tone 14.8,
 * Sampler.triggerAttackRelease() stops tracking a note as soon as it is
 * scheduled, so releaseAll() cannot stop it. Notes still ringing or waiting to
 * start would carry on into the next play. Keeping our own voice list lets a
 * new play stop all of them.
 *
 * Depends on: MusicData (js/data.js), and Tone (CDN) when it loaded.
 */
var PianoAudio = (function () {
  'use strict';

  var D = MusicData;

  /* ---------- constants ---------- */

  var SAMPLE_BASE_URL = 'https://tonejs.github.io/audio/salamander/';
  var LOAD_TIMEOUT_MS = 15000;
  var SAMPLE_VOLUME_DB = -8;

  // Click-free playback. These numbers fix a real pop: do not change them.
  var TIMING = {
    muteRamp: 0.015,     // s, output gain down to 0 before a new play
    settleMs: 95,        // ms, stay muted so released notes finish fading
    unmuteRamp: 0.008,   // s, output gain back up to 1
    release: 0.06,       // s, sample voice release
    noteDur: 2.6,        // s, a struck note (block chord, single note)
    rolledDur: 1.9,      // s, a rolled note that is followed by a block strike
    silenceRamp: 0.025   // s, fade used by silenceAll()
  };

  // Salamander has C, D#, F# and A in octaves 3 to 7: 20 files.
  var SAMPLE_FILES = {}; // midi -> filename
  (function () {
    var names = { 0: 'C', 3: 'Ds', 6: 'Fs', 9: 'A' };
    for (var oct = 3; oct <= 7; oct++) {
      Object.keys(names).forEach(function (p) {
        SAMPLE_FILES[D.midiFrom(+p, oct)] = names[p] + oct + '.mp3';
      });
    }
  })();
  var SAMPLE_MIDIS = Object.keys(SAMPLE_FILES).map(Number).sort(function (a, b) { return a - b; });

  // Additive synth partials: harmonic multiple, gain, decay time (s).
  var PARTIALS = [
    { mult: 1, gain: 1.00, decay: 3.2 },
    { mult: 2, gain: 0.52, decay: 2.4 },
    { mult: 3, gain: 0.30, decay: 1.8 },
    { mult: 4, gain: 0.18, decay: 1.4 },
    { mult: 5, gain: 0.10, decay: 1.0 },
    { mult: 6, gain: 0.06, decay: 0.8 },
    { mult: 8, gain: 0.03, decay: 0.6 }
  ];
  var SYNTH_LEVEL = 0.22;
  var SYNTH_STOP_RAMP = 0.025;

  /* ---------- state ---------- */

  var engine = null;      // null while loading, then 'samples' or 'synth'
  var sourceLabel = 'loading piano samples…';
  var readyCallbacks = [];
  var playToken = 0;
  var voices = [];        // { stop(time) } for every sounding or scheduled note

  // Samples path
  var buffers = null;     // Tone.ToneAudioBuffers keyed by midi
  var sampleVolume = null;
  var sampleOut = null;   // Tone.Gain used to mute/unmute

  // Synth path
  var ctx = null;         // native AudioContext
  var synthIn = null;     // shared low-pass that every synth voice feeds
  var synthOut = null;    // GainNode used to mute/unmute

  /* ---------- loading ---------- */

  function init() {
    if (engine || buffers) return;
    if (typeof Tone === 'undefined') { useSynth('Tone.js unavailable'); return; }

    var settled = false;
    var timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      useSynth('samples timed out');
    }, LOAD_TIMEOUT_MS);

    function fail() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      useSynth('samples failed to load');
    }

    try {
      buffers = new Tone.ToneAudioBuffers({
        urls: SAMPLE_FILES,
        baseUrl: SAMPLE_BASE_URL,
        onload: function () {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          useSamples();
        },
        onerror: fail
      });
    } catch (e) {
      fail();
    }
  }

  function useSamples() {
    sampleVolume = new Tone.Volume(SAMPLE_VOLUME_DB);
    sampleOut = new Tone.Gain(1);
    sampleVolume.connect(sampleOut);
    sampleOut.toDestination();
    setReady('samples', 'Salamander Grand Piano samples');
  }

  function useSynth(reason) {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      sourceLabel = 'no audio available (' + reason + ')';
      return;
    }
    ctx = new AC();
    // One shared low-pass replaces a per-voice filter: same sound, fewer nodes.
    synthIn = ctx.createBiquadFilter();
    synthIn.type = 'lowpass';
    synthIn.frequency.value = 6000;
    synthOut = ctx.createGain();
    synthOut.gain.value = 1;
    synthIn.connect(synthOut);
    synthOut.connect(ctx.destination);
    setReady('synth', 'built-in piano synth (' + reason + ')');
  }

  function setReady(kind, label) {
    engine = kind;
    sourceLabel = label;
    var cbs = readyCallbacks;
    readyCallbacks = [];
    cbs.forEach(function (cb) { try { cb(label, kind); } catch (e) { console.error(e); } });
  }

  // Calls cb(label, kind) once audio is ready, immediately if it already is.
  function onReady(cb) {
    if (engine) cb(sourceLabel, engine);
    else readyCallbacks.push(cb);
  }

  /* ---------- engine-neutral pieces ---------- */

  function now() {
    return engine === 'samples' ? Tone.now() : ctx.currentTime;
  }

  function outGain() {
    return engine === 'samples' ? sampleOut.gain : synthOut.gain;
  }

  // Must run inside the user's tap: browsers only start audio from a gesture.
  function wake() {
    if (engine === 'samples') {
      return Tone.context.state === 'running' ? Promise.resolve() : Tone.start();
    }
    return ctx.state === 'suspended' ? ctx.resume() : Promise.resolve();
  }

  // Ramp a gain param from wherever it is now to `target` over `dur` seconds.
  function rampFromCurrent(param, t, target, dur) {
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.linearRampToValueAtTime(target, t + dur);
  }

  function stopAllVoices(t) {
    var old = voices;
    voices = [];
    old.forEach(function (v) { try { v.stop(t); } catch (e) { /* already gone */ } });
  }

  function forget(voice) {
    var i = voices.indexOf(voice);
    if (i !== -1) voices.splice(i, 1);
  }

  function startVoice(midi, when, dur, level) {
    var v = engine === 'samples' ? sampleVoice(midi, when, dur) : synthVoice(midi, when, dur, level);
    if (v) voices.push(v);
  }

  /* ---------- sample voices ---------- */

  function nearestSample(midi) {
    var best = SAMPLE_MIDIS[0];
    for (var i = 1; i < SAMPLE_MIDIS.length; i++) {
      if (Math.abs(SAMPLE_MIDIS[i] - midi) < Math.abs(best - midi)) best = SAMPLE_MIDIS[i];
    }
    return best;
  }

  function sampleVoice(midi, when, dur) {
    var base = nearestSample(midi);
    var src = new Tone.ToneBufferSource({
      url: buffers.get(base),
      playbackRate: Math.pow(2, (midi - base) / 12),
      fadeIn: 0,
      fadeOut: TIMING.release,
      curve: 'exponential'
    }).connect(sampleVolume);
    var voice = { stop: function (t) { src.stop(t); } };
    src.onended = function () { forget(voice); };
    src.start(when);
    src.stop(when + dur);
    return voice;
  }

  /* ---------- synth voices ---------- */

  function synthVoice(midi, when, dur, level) {
    var freq = D.midiToFreq(midi);
    var end = when + dur;

    var master = ctx.createGain();
    master.gain.setValueAtTime(level, when);
    master.gain.setValueAtTime(level, end);
    master.gain.linearRampToValueAtTime(0, end + SYNTH_STOP_RAMP);
    master.connect(synthIn);

    var nodes = [];
    PARTIALS.forEach(function (p, i) {
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      osc.type = 'sine';
      // Slight inharmonic stretch, like a real string, plus tiny random detune.
      osc.frequency.value = freq * p.mult * (1 + 0.0004 * p.mult * p.mult);
      osc.detune.value = (Math.random() - 0.5) * 4;
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(p.gain, when + 0.004 + i * 0.001);
      g.gain.exponentialRampToValueAtTime(0.0001, when + p.decay);
      osc.connect(g);
      g.connect(master);
      osc.start(when);
      osc.stop(Math.min(when + p.decay + 0.1, end + SYNTH_STOP_RAMP + 0.01));
      nodes.push(osc);
    });

    // Hammer: 30 ms of decaying noise, band-passed around the 3rd harmonic.
    var len = Math.floor(ctx.sampleRate * 0.03);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    var noise = ctx.createBufferSource();
    var nf = ctx.createBiquadFilter();
    var ng = ctx.createGain();
    nf.type = 'bandpass';
    nf.frequency.value = freq * 3;
    ng.gain.value = 0.12;
    noise.buffer = buf;
    noise.connect(nf);
    nf.connect(ng);
    ng.connect(master);
    noise.start(when);
    nodes.push(noise);

    var voice = {
      stop: function (t) {
        rampFromCurrent(master.gain, t, 0, SYNTH_STOP_RAMP);
        nodes.forEach(function (n) { try { n.stop(t + SYNTH_STOP_RAMP + 0.01); } catch (e) { /* ok */ } });
      }
    };
    nodes[0].onended = function () { forget(voice); master.disconnect(); };
    return voice;
  }

  /* ---------- public playback ---------- */

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* Play MIDI pitches.
   *   gap > 0        roll the notes out `gap` seconds apart instead of together.
   *   blockAfter > 0 after the roll, wait this long and strike them all together.
   * A newer call (or silenceAll) cancels anything this one has not played yet.
   * Resolves true if it played, false if it was cancelled or audio is not ready.
   */
  function playPitches(pitches, gap, blockAfter) {
    if (!engine || !pitches || !pitches.length) return Promise.resolve(false);
    var token = ++playToken;
    var step = gap > 0 ? gap : 0;
    var pause = blockAfter > 0 ? blockAfter : 0;
    // Rolled notes are cut shorter so they have begun to fade before the
    // strike, which keeps the block from being buried under them.
    var rollDur = pause ? TIMING.rolledDur : TIMING.noteDur;
    var blockAt = pause ? (pitches.length - 1) * step + pause : null;
    var n = pitches.length;

    // wake() is called before any await so it still counts as the user's tap.
    return wake().then(function () {
      if (token !== playToken) return false;
      var t = now();
      rampFromCurrent(outGain(), t, 0, TIMING.muteRamp);
      stopAllVoices(t);
      // Stay muted until the old notes have finished releasing, then ease the
      // gain back. Restoring it while an old note still rang made a pop.
      return wait(TIMING.settleMs).then(function () {
        if (token !== playToken) return false;
        var start = now();
        var g = outGain();
        g.cancelScheduledValues(start);
        g.setValueAtTime(0, start);
        g.linearRampToValueAtTime(1, start + TIMING.unmuteRamp);

        var rollLevel = SYNTH_LEVEL / Math.sqrt(step ? 1 : n);
        var blockLevel = SYNTH_LEVEL / Math.sqrt(n);
        pitches.forEach(function (m, i) { startVoice(m, start + i * step, rollDur, rollLevel); });
        if (blockAt !== null) {
          pitches.forEach(function (m) { startVoice(m, start + blockAt, TIMING.noteDur, blockLevel); });
        }
        return true;
      });
    }).catch(function (e) {
      console.error('playPitches failed', e);
      return false;
    });
  }

  // Stop everything now, including notes scheduled for later.
  function silenceAll() {
    playToken++;
    if (!engine) return;
    var t = now();
    rampFromCurrent(outGain(), t, 0, TIMING.silenceRamp);
    stopAllVoices(t);
  }

  return {
    TIMING: TIMING,
    LOAD_TIMEOUT_MS: LOAD_TIMEOUT_MS,
    init: init,
    onReady: onReady,
    isReady: function () { return engine !== null; },
    engine: function () { return engine; },
    sourceLabel: function () { return sourceLabel; },
    playPitches: playPitches,
    silenceAll: silenceAll
  };
})();
