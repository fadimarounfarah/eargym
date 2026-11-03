/* Audio engine.
 *
 * Plays the selected instrument's samples through Tone.js. The instrument (its
 * samples, range, release, volume and fallback synth) comes from
 * js/instruments.js; only "piano", the Salamander Grand Piano, exists so far.
 * If Tone.js is missing, a sample fails, or loading takes longer than 15 s, it
 * switches to the instrument's built-in additive synth instead.
 *
 * The whole app makes sound through one call: PianoAudio.playPitches().
 *
 * Why voices are tracked here and not left to Tone.Sampler: in Tone 14.8,
 * Sampler.triggerAttackRelease() stops tracking a note as soon as it is
 * scheduled, so releaseAll() cannot stop it. Notes still ringing or waiting to
 * start would carry on into the next play. Keeping our own voice list lets a
 * new play stop all of them.
 *
 * The global keeps the name PianoAudio so no caller had to change.
 *
 * Depends on: Instruments (js/instruments.js), MusicData (js/data.js), and
 * Tone (vendor/tone/Tone.js) when it loaded.
 */
var PianoAudio = (function () {
  'use strict';

  var D = MusicData;

  /* ---------- constants ---------- */

  // An instrument's samples ship with the app (instrument.samples.local), so
  // they work offline once the service worker has cached them. Browsers refuse
  // to fetch local files from a page opened from disk (file://), so there the
  // same files are fetched from instrument.samples.remote instead, which needs
  // internet. If both fail, the 15 s timeout or the load error switches to the
  // instrument's synth.
  var FROM_DISK = window.location.protocol === 'file:';
  var LOAD_TIMEOUT_MS = 15000;

  // Click-free playback, shared by every instrument. These numbers fix a real
  // pop: do not change them. (Each instrument sets its own voice release.)
  var TIMING = {
    muteRamp: 0.015,     // s, output gain down to 0 before a new play
    settleMs: 95,        // ms, stay muted so released notes finish fading
    unmuteRamp: 0.008,   // s, output gain back up to 1
    noteDur: 2.6,        // s, a struck note (block chord, single note)
    rolledDur: 1.9,      // s, a rolled note that is followed by a block strike
    silenceRamp: 0.025   // s, fade used by silenceAll()
  };

  /* ---------- state ---------- */

  var inst = Instruments.get(Instruments.DEFAULT);   // the selected instrument
  var sampleMidis = [];   // inst's sample notes, ascending
  var engine = null;      // null while loading, then 'samples' or 'synth'
  var sourceLabel = inst.loadingLabel;
  var readyCallbacks = [];   // one-shot, see onReady()
  var statusListeners = [];  // every change, see onStatus()
  var started = false;
  var loadToken = 0;      // bumped by every load(); a stale load is ignored
  var playToken = 0;
  var voices = [];        // { stop(time) } for every sounding or scheduled note

  // Samples path
  var buffers = null;     // Tone.ToneAudioBuffers of inst, keyed by midi
  var loaded = {};        // instrument id -> its loaded ToneAudioBuffers
  var sampleVolume = null;
  var sampleOut = null;   // Tone.Gain used to mute/unmute

  // Synth path
  var ctx = null;         // native AudioContext
  var synthIn = null;     // shared low-pass that every synth voice feeds
  var synthOut = null;    // GainNode used to mute/unmute

  /* ---------- loading ---------- */

  // Call once at startup with the saved instrument id (unknown ids get the
  // default). Later changes go through load().
  function init(instrumentId) {
    if (started) return;
    load(instrumentId);
  }

  /* Switch to an instrument and load its samples (only its own: each set is
   * fetched the first time it is chosen, then kept). Everything sounding or
   * scheduled is stopped first, and audio is not ready again until the new
   * samples (or the synth fallback) are. Loading the instrument that is
   * already selected does nothing. */
  function load(instrumentId) {
    var next = Instruments.get(instrumentId);
    if (started && next === inst) return;
    started = true;
    silenceAll();
    inst = next;
    engine = null;
    sourceLabel = inst.loadingLabel;
    sampleMidis = Object.keys(inst.samples.files).map(Number).sort(function (a, b) { return a - b; });
    var token = ++loadToken;
    notify();
    if (typeof Tone === 'undefined') { useSynth('Tone.js unavailable'); return; }
    if (loaded[inst.id]) { buffers = loaded[inst.id]; useSamples(); return; }

    var id = inst.id;
    var settled = false;
    var timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      if (token === loadToken) useSynth('samples timed out');
    }, LOAD_TIMEOUT_MS);

    function fail() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (token === loadToken) useSynth('samples failed to load');
    }

    try {
      var set = new Tone.ToneAudioBuffers({
        urls: inst.samples.files,
        baseUrl: FROM_DISK ? inst.samples.remote : inst.samples.local,
        onload: function () {
          // Kept even if the player has moved on, so going back is instant.
          loaded[id] = set;
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (token !== loadToken) return;
          buffers = set;
          useSamples();
        },
        onerror: fail
      });
    } catch (e) {
      fail();
    }
  }

  function useSamples() {
    if (!sampleOut) {
      sampleVolume = new Tone.Volume(inst.volumeDb);
      sampleOut = new Tone.Gain(1);
      sampleVolume.connect(sampleOut);
      sampleOut.toDestination();
    }
    sampleVolume.volume.value = inst.volumeDb;
    setReady('samples', inst.sourceLabel);
  }

  function useSynth(reason) {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      sourceLabel = 'no audio available (' + reason + ')';
      return;
    }
    if (!ctx) {
      ctx = new AC();
      // One shared low-pass replaces a per-voice filter: same sound, fewer nodes.
      synthIn = ctx.createBiquadFilter();
      synthIn.type = 'lowpass';
      synthOut = ctx.createGain();
      synthOut.gain.value = 1;
      synthIn.connect(synthOut);
      synthOut.connect(ctx.destination);
    }
    synthIn.frequency.value = inst.synth.lowpass;
    setReady('synth', inst.synth.label + ' (' + reason + ')');
  }

  function setReady(kind, label) {
    engine = kind;
    sourceLabel = label;
    var cbs = readyCallbacks;
    readyCallbacks = [];
    cbs.forEach(function (cb) { try { cb(label, kind); } catch (e) { console.error(e); } });
    notify();
  }

  function notify() {
    statusListeners.forEach(function (cb) {
      try { cb(sourceLabel, engine, inst); } catch (e) { console.error(e); }
    });
  }

  // Calls cb(label, kind, instrument) on every change: when an instrument
  // starts loading (kind null, label its loading text) and when it is ready
  // (kind 'samples' or 'synth').
  function onStatus(cb) { statusListeners.push(cb); }

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
    var best = sampleMidis[0];
    for (var i = 1; i < sampleMidis.length; i++) {
      if (Math.abs(sampleMidis[i] - midi) < Math.abs(best - midi)) best = sampleMidis[i];
    }
    return best;
  }

  function sampleVoice(midi, when, dur) {
    var base = nearestSample(midi);
    var src = new Tone.ToneBufferSource({
      url: buffers.get(base),
      playbackRate: Math.pow(2, (midi - base) / 12),
      fadeIn: 0,
      fadeOut: inst.release,
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
    var sy = inst.synth;
    var freq = D.midiToFreq(midi);
    var end = when + dur;

    var master = ctx.createGain();
    master.gain.setValueAtTime(level, when);
    master.gain.setValueAtTime(level, end);
    master.gain.linearRampToValueAtTime(0, end + sy.stopRamp);
    master.connect(synthIn);

    var nodes = [];
    sy.partials.forEach(function (p, i) {
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      osc.type = 'sine';
      // Slight inharmonic stretch, like a real string, plus tiny random detune.
      osc.frequency.value = freq * p.mult * (1 + sy.stretch * p.mult * p.mult);
      osc.detune.value = (Math.random() - 0.5) * sy.detune;
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(p.gain, when + 0.004 + i * 0.001);
      g.gain.exponentialRampToValueAtTime(0.0001, when + p.decay);
      osc.connect(g);
      g.connect(master);
      osc.start(when);
      osc.stop(Math.min(when + p.decay + 0.1, end + sy.stopRamp + 0.01));
      nodes.push(osc);
    });

    // Attack noise (the piano's hammer): a short burst of decaying noise,
    // band-passed around one harmonic.
    var len = Math.floor(ctx.sampleRate * sy.noise.dur);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    var noise = ctx.createBufferSource();
    var nf = ctx.createBiquadFilter();
    var ng = ctx.createGain();
    nf.type = 'bandpass';
    nf.frequency.value = freq * sy.noise.harmonic;
    ng.gain.value = sy.noise.gain;
    noise.buffer = buf;
    noise.connect(nf);
    nf.connect(ng);
    ng.connect(master);
    noise.start(when);
    nodes.push(noise);

    var voice = {
      stop: function (t) {
        rampFromCurrent(master.gain, t, 0, sy.stopRamp);
        nodes.forEach(function (n) { try { n.stop(t + sy.stopRamp + 0.01); } catch (e) { /* ok */ } });
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
   *   strum > 0      a strike "together" is strummed instead: each note starts
   *                  `strum` seconds after the one below it (guitar chords).
   * A newer call (or silenceAll) cancels anything this one has not played yet.
   * Resolves true if it played, false if it was cancelled or audio is not ready.
   */
  function playPitches(pitches, gap, blockAfter, strum) {
    if (!engine || !pitches || !pitches.length) return Promise.resolve(false);
    var token = ++playToken;
    var step = gap > 0 ? gap : 0;
    var spread = strum > 0 ? strum : 0;
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

        var rollLevel = inst.synth.level / Math.sqrt(step ? 1 : n);
        var blockLevel = inst.synth.level / Math.sqrt(n);
        pitches.forEach(function (m, i) { startVoice(m, start + i * (step || spread), rollDur, rollLevel); });
        if (blockAt !== null) {
          pitches.forEach(function (m, i) { startVoice(m, start + blockAt + i * spread, TIMING.noteDur, blockLevel); });
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
    load: load,
    onReady: onReady,
    onStatus: onStatus,
    isReady: function () { return engine !== null; },
    engine: function () { return engine; },
    sourceLabel: function () { return sourceLabel; },
    instrument: function () { return inst; },
    loadingLabel: function () { return inst.loadingLabel; },
    playPitches: playPitches,
    silenceAll: silenceAll
  };
})();
