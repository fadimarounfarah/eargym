/* Temporary developer tools: three buttons that play a random note, chord and
 * interval, so audio can be checked by ear. Lives in the collapsed "Dev"
 * section of the page. Delete once the real UI exists.
 *
 * Does not start the audio engine; js/app.js does that once.
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
    $('devReadout').innerHTML = '';
    var strong = document.createElement('strong');
    strong.textContent = title;
    var span = document.createElement('div');
    span.className = 'detail';
    span.textContent = detail;
    $('devReadout').appendChild(strong);
    $('devReadout').appendChild(span);
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
    var arp = $('devArp').checked;
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

  $('devNote').addEventListener('click', playNote);
  $('devChord').addEventListener('click', playChord);
  $('devInterval').addEventListener('click', playInterval);
  $('devStop').addEventListener('click', function () { PianoAudio.silenceAll(); });

  PianoAudio.onReady(function () {
    ['devNote', 'devChord', 'devInterval', 'devStop'].forEach(function (id) { $(id).disabled = false; });
  });
})();
