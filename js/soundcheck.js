/* Temporary step-1 page logic: three buttons that prove data.js and audio.js
 * work together. Replaced by the real app in later steps.
 */
(function () {
  'use strict';

  var D = MusicData;
  var $ = function (id) { return document.getElementById(id); };

  // Same spacings the practice game uses.
  var INTERVAL_GAP = 0.6;
  var ARP_GAP = 0.42;
  var ARP_BLOCK_PAUSE = 0.95;

  // Any note in any of the three registers (C3 to B5).
  function randomMidi() {
    var reg = D.randomItem(D.REGISTERS);
    return reg.low + Math.floor(Math.random() * 12);
  }

  function names(pitches) { return pitches.map(D.midiToName).join(' – '); }

  function show(title, detail) {
    $('readout').innerHTML = '';
    var strong = document.createElement('strong');
    strong.textContent = title;
    var span = document.createElement('div');
    span.className = 'detail';
    span.textContent = detail;
    $('readout').appendChild(strong);
    $('readout').appendChild(span);
  }

  function playNote() {
    var m = randomMidi();
    PianoAudio.playPitches([m]);
    show(D.midiToName(m), 'MIDI ' + m + ', ' + D.midiToFreq(m).toFixed(1) + ' Hz');
  }

  function playChord() {
    var root = randomMidi();
    var q = D.randomItem(D.QUALITY_KEYS);
    var pitches = D.chordPitches(root, q);
    var arp = $('arpToggle').checked;
    PianoAudio.playPitches(pitches, arp ? ARP_GAP : 0, arp ? ARP_BLOCK_PAUSE : 0);
    show(D.chordName(D.pc(root), q) + (arp ? ' (rolled)' : ''),
      names(pitches) + '  ·  offsets ' + D.CHORDS[q].intervals.join(', '));
  }

  function playInterval() {
    var low = randomMidi();
    var iv = D.randomItem(D.INTERVALS);
    var descending = Math.random() < 0.5;
    var pair = [low, low + iv.semi];
    if (descending) pair.reverse();
    PianoAudio.playPitches(pair, INTERVAL_GAP);
    show(iv.name + ' (' + iv.label + ', ' + iv.semi + ' semitones) ' + (descending ? 'descending' : 'ascending'),
      names(pair) + '  ·  ' + iv.song);
  }

  $('noteBtn').addEventListener('click', playNote);
  $('chordBtn').addEventListener('click', playChord);
  $('intervalBtn').addEventListener('click', playInterval);
  $('stopBtn').addEventListener('click', function () { PianoAudio.silenceAll(); });

  PianoAudio.onReady(function (label, kind) {
    ['noteBtn', 'chordBtn', 'intervalBtn', 'stopBtn'].forEach(function (id) { $(id).disabled = false; });
    $('hint').textContent = 'tap to listen';
    var src = $('source');
    src.textContent = label;
    src.className = kind === 'samples' ? 'samples' : 'synth';
  });
  PianoAudio.init();
})();
