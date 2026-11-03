/* Shared piano keyboard renderer, used by the practice board now and the
 * Learn tab later.
 *
 * render() only draws. It attaches no listeners, so redrawing can never stack
 * handlers. Callers add one click listener to the container, once, and use
 * keyFromEvent() to find the tapped key; it returns null for ghost and dead
 * keys, so those ignore taps.
 *
 * Depends on: MusicData (js/data.js).
 */
var Keyboard = (function () {
  'use strict';

  var D = MusicData;
  var MIN_WHITE_PX = 28;   // below this keys get too small to tap; the board scrolls instead

  var MARKS = ['sel', 'ok', 'no', 'missed', 'lit'];

  /* options:
   *   low      lowest MIDI note (a C)
   *   octaves  playable octaves
   *   extra    semitones drawn above the playable range as unplayable "ghost"
   *            keys, so a high chord still has somewhere to show its top notes
   *   labels   'letters' (every white key), 'octaves' (C keys as C4) or 'none'
   *   isDead   function (midi) -> true for keys that can never be the answer */
  function render(container, options) {
    var low = options.low;
    var playableTop = low + options.octaves * 12 - 1;
    var top = playableTop + (options.extra || 0);
    var isDead = options.isDead || function () { return false; };
    var labels = options.labels || 'none';

    var whites = [];
    var blacks = [];
    for (var m = low; m <= top; m++) {
      if (D.isBlack(m)) blacks.push({ midi: m, after: whites.length - 1 });
      else whites.push(m);
    }
    var whitePct = 100 / whites.length;

    var inner = document.createElement('div');
    inner.className = 'kb-inner';
    inner.style.minWidth = whites.length * MIN_WHITE_PX + 'px';

    function makeKey(midi, isWhite) {
      var ghost = midi > playableTop;
      var key;
      if (ghost) {
        key = document.createElement('div');
        key.setAttribute('aria-hidden', 'true');
      } else {
        key = document.createElement('button');
        key.type = 'button';
        key.setAttribute('aria-label', D.midiToName(midi));
        if (isDead(midi)) { key.disabled = true; key.classList.add('dead'); }
      }
      key.classList.add(isWhite ? 'wkey' : 'bkey');
      if (ghost) key.classList.add('ghost');
      key.dataset.midi = midi;
      return key;
    }

    whites.forEach(function (midi) {
      var key = makeKey(midi, true);
      var name = D.NOTES[D.pc(midi)];
      var text = labels === 'letters' ? name
        : labels === 'octaves' && name === 'C' ? D.midiToName(midi)
        : null;
      if (text) {
        var label = document.createElement('span');
        label.className = 'key-label';
        label.textContent = text;
        key.appendChild(label);
      }
      inner.appendChild(key);
    });

    blacks.forEach(function (b) {
      var key = makeKey(b.midi, false);
      key.style.width = whitePct * 0.62 + '%';
      key.style.left = (b.after + 1) * whitePct - whitePct * 0.31 + '%';
      inner.appendChild(key);
    });

    container.textContent = '';
    container.classList.add('kb');
    container.appendChild(inner);
  }

  // The MIDI number of a tapped playable key, or null.
  function keyFromEvent(e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-midi]') : null;
    if (!el || el.tagName !== 'BUTTON' || el.disabled) return null;
    return +el.dataset.midi;
  }

  function keyEl(container, midi) {
    return container.querySelector('[data-midi="' + midi + '"]');
  }

  // Add a mark class ('sel', 'ok', 'no', 'missed', 'lit') to each MIDI key.
  function mark(container, midis, cls) {
    midis.forEach(function (m) {
      var k = keyEl(container, m);
      if (k) k.classList.add(cls);
    });
  }

  function toggle(container, midi, cls, on) {
    var k = keyEl(container, midi);
    if (k) k.classList.toggle(cls, on);
  }

  function clearMarks(container) {
    Array.prototype.forEach.call(container.querySelectorAll('[data-midi]'), function (k) {
      MARKS.forEach(function (c) { k.classList.remove(c); });
    });
  }

  return {
    render: render,
    keyFromEvent: keyFromEvent,
    keyEl: keyEl,
    mark: mark,
    toggle: toggle,
    clearMarks: clearMarks
  };
})();
