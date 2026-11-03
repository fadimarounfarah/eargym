/* The Stats tab ("Your Ear"): progress and confusion analysis, plus export,
 * import and reset of the history.
 *
 * It only reads Store.history(). Every counting table (per-note accuracy, the
 * confusion matrix, per-interval and per-chord-type bars, replay figures) is
 * derived from the raw answers and plays log each time the tab is drawn, never
 * stored, which is what lets "Recent" forget old answers.
 *
 * The derivations (buildTables, rowStats, confusions, replayStats,
 * matrixCells, sparkPoints) are pure and exported so they can be checked on
 * their own. Everything drawn is built with textContent and SVG elements.
 * Every listener is attached once, in init(), by delegation on the view.
 *
 * Depends on: MusicData, Store.
 */
var Stats = (function () {
  'use strict';

  var D = MusicData;
  var $ = function (id) { return document.getElementById(id); };
  function each(list, fn) { Array.prototype.forEach.call(list, fn); }

  var RECENT_WINDOW = 100;     // "Recent" is the last 100 answers of each kind
  var MIN_SAMPLE = 4;          // below this many attempts an accuracy is noise
  var WEAK_BELOW = 0.5;        // accuracy under this, with enough attempts, is weak
  var TREND_MATCHES = 30;      // matches in a sparkline
  var LIST_MATCHES = 8;        // matches in the recent list
  var CONFUSION_LIMIT = 6;
  var MAX_IMPORT_BYTES = 10 * 1000 * 1000;

  var KINDS = ['note', 'root', 'qual', 'ivl'];
  var MODE_ORDER = ['notes', 'chords', 'intervals'];
  var MODE_LABEL = { notes: 'Pitch', chords: 'Chords', intervals: 'Intervals' };

  var SPARK = { w: 300, h: 54, pad: 4 };
  var SVG_NS = 'http://www.w3.org/2000/svg';

  /* ---------- pure derivations ---------- */

  function has(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }

  // Targets and guesses are stored as strings; anything out of range is ignored.
  function validValue(kind, v) {
    if (v === undefined || v === null) return false;
    v = String(v);
    if (kind === 'note' || kind === 'root') return /^([0-9]|1[01])$/.test(v);
    if (kind === 'ivl') return /^([1-9]|1[0-2])$/.test(v);
    if (kind === 'qual') return has(D.CHORDS, v);
    return false;
  }

  /* { note, root, qual, ivl }, each { target: { guess: count } }.
   * scope 'recent' keeps only the last 100 answers of each kind. */
  function buildTables(answers, scope) {
    var tables = { note: {}, root: {}, qual: {}, ivl: {} };
    KINDS.forEach(function (kind) {
      var rows = [];
      (answers || []).forEach(function (a) {
        if (a && a.k === kind && validValue(kind, a.t) && validValue(kind, a.g)) rows.push(a);
      });
      if (scope === 'recent') rows = rows.slice(-RECENT_WINDOW);
      rows.forEach(function (a) {
        var t = String(a.t), g = String(a.g);
        if (!tables[kind][t]) tables[kind][t] = {};
        tables[kind][t][g] = (tables[kind][t][g] || 0) + 1;
      });
    });
    return tables;
  }

  function tableTotals(table) {
    var attempts = 0, correct = 0;
    Object.keys(table).forEach(function (t) {
      Object.keys(table[t]).forEach(function (g) {
        attempts += table[t][g];
        if (t === g) correct += table[t][g];
      });
    });
    return { attempts: attempts, correct: correct };
  }

  function rowStats(table, target) {
    var row = table[String(target)] || {};
    var attempts = 0;
    Object.keys(row).forEach(function (g) { attempts += row[g]; });
    var correct = row[String(target)] || 0;
    return { attempts: attempts, correct: correct, pct: attempts ? correct / attempts : 0 };
  }

  // Every wrong pair across note and chord-root answers, biggest first. Chord
  // roots are tagged "(root)". Ties keep the order they were first seen in.
  function confusions(tables) {
    var out = [];
    ['note', 'root'].forEach(function (kind) {
      var table = tables[kind];
      Object.keys(table).forEach(function (from) {
        Object.keys(table[from]).forEach(function (to) {
          if (from === to) return;
          out.push({
            from: D.NOTES[+from], to: D.NOTES[+to],
            tag: kind === 'root' ? ' (root)' : '', n: table[from][to]
          });
        });
      });
    });
    return out.sort(function (x, y) { return y.n - x.n; });
  }

  function validPlay(p) {
    return !!p && typeof p.plays === 'number' && p.plays >= 1 && MODE_ORDER.indexOf(p.mode) !== -1;
  }

  // The plays log in scope. Recent is the last 100 questions.
  function playsInScope(plays, scope) {
    var rows = (plays || []).filter(validPlay);
    return scope === 'recent' ? rows.slice(-RECENT_WINDOW) : rows;
  }

  // Replays per correct answer, and how many were right on the first listen.
  // Only correct answers count, so a wrong guess after six listens does not
  // flatter the number. Null if nothing was answered correctly.
  function replayStats(rows) {
    var hit = rows.filter(function (r) { return r.correct; });
    if (!hit.length) return null;
    var replays = hit.reduce(function (sum, r) { return sum + (r.plays - 1); }, 0);
    var firstTry = hit.filter(function (r) { return r.plays === 1; }).length;
    return { avg: replays / hit.length, firstTryPct: Math.round(firstTry / hit.length * 100), n: hit.length };
  }

  function validMatch(m) {
    return !!m && typeof m.ts === 'number' && typeof m.points === 'number' &&
      typeof m.acc === 'number' && MODE_ORDER.indexOf(m.mode) !== -1;
  }

  function matchesOf(matches, mode) {
    return (matches || []).filter(function (m) { return validMatch(m) && m.mode === mode; });
  }

  // Exercises that have at least one finished match, in menu order.
  function playedModes(matches) {
    return MODE_ORDER.filter(function (mode) { return matchesOf(matches, mode).length > 0; });
  }

  // "x,y x,y ..." for a polyline inside the sparkline box. A flat series is
  // drawn through the middle.
  function sparkPoints(values) {
    var lo = Math.min.apply(null, values), hi = Math.max.apply(null, values);
    var span = hi - lo;
    return values.map(function (v, i) {
      var x = SPARK.pad + i * (SPARK.w - SPARK.pad * 2) / (values.length - 1);
      var y = span === 0 ? SPARK.h / 2 : SPARK.h - SPARK.pad - ((v - lo) / span) * (SPARK.h - SPARK.pad * 2);
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
  }

  // 12 x 12 counts [heard][answered] for the note table, and the biggest
  // off-diagonal count (at least 1) for shading the errors.
  function matrixCells(noteTable) {
    var counts = [], peak = 1;
    for (var r = 0; r < 12; r++) {
      var row = [];
      for (var c = 0; c < 12; c++) {
        var v = (noteTable[r] && noteTable[r][c]) || 0;
        if (r !== c && v > peak) peak = v;
        row.push(v);
      }
      counts.push(row);
    }
    return { counts: counts, peak: peak };
  }

  /* ---------- drawing helpers ---------- */

  var els = null;
  var scope = 'recent';          // recent | all
  var trendMode = 'notes';       // which exercise the trend shows

  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function svg(tag, attrs) {
    var node = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    return node;
  }

  function note(text) { return make('div', 'mini-note', text); }

  function row(left, right) {
    var r = make('div', 'conf-row');
    r.appendChild(left);
    r.appendChild(document.createTextNode(' '));      // keeps the two halves apart for screen readers
    r.appendChild(make('span', 'cnt', right));
    return r;
  }

  function setActive(container, attr, value) {
    each(container.querySelectorAll('[' + attr + ']'), function (b) {
      var on = b.getAttribute(attr) === String(value);
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function sparkline(values, kind, fmt, label) {
    var box = make('div', 'spark');
    var chart = svg('svg', {
      viewBox: '0 0 ' + SPARK.w + ' ' + SPARK.h, preserveAspectRatio: 'none',
      role: 'img', 'aria-label': label
    });
    chart.appendChild(svg('polyline', { points: sparkPoints(values), 'class': 'spark-line ' + kind }));
    box.appendChild(chart);
    var legend = make('div', 'spark-legend');
    legend.appendChild(make('span', '', fmt(Math.min.apply(null, values)) + ' – ' + fmt(Math.max.apply(null, values))));
    var now = make('span', '', 'now ');
    now.appendChild(make('b', '', fmt(values[values.length - 1])));
    legend.appendChild(now);
    box.appendChild(legend);
    return box;
  }

  // One accuracy bar. Fewer than 4 attempts is faded; 4 or more under 50% is weak.
  function barRow(name, s) {
    var thin = s.attempts > 0 && s.attempts < MIN_SAMPLE;
    var weak = s.attempts >= MIN_SAMPLE && s.pct < WEAK_BELOW;
    var pct = Math.round(s.pct * 100);
    var r = make('div', 'bar-row' + (weak ? ' weak' : '') + (thin ? ' thin' : ''));
    r.appendChild(make('span', 'bar-name', name));
    var track = make('span', 'bar-track');
    var fill = make('span', 'bar-fill ' + (s.attempts === 0 ? 'none' : s.pct >= 0.8 ? 'high' : s.pct >= WEAK_BELOW ? 'mid' : 'low'));
    fill.style.width = (s.attempts ? pct : 0) + '%';
    track.appendChild(fill);
    r.appendChild(track);
    r.appendChild(make('span', 'bar-num', s.attempts ? pct + '% · ' + s.attempts : '—'));
    return r;
  }

  /* ---------- sections ---------- */

  // Points are not comparable across exercises (chords pay 150 a question, the
  // others 100), so the trend shows one exercise at a time.
  function renderTrend(matches) {
    var played = playedModes(matches);
    els.trendSeg.textContent = '';
    els.trend.textContent = '';
    if (!played.length) {
      els.trend.appendChild(note('Finish a match to see a trend.'));
      return;
    }
    if (played.indexOf(trendMode) === -1) trendMode = played[played.length - 1];
    played.forEach(function (mode) {
      var b = make('button', mode === trendMode ? 'active' : '', MODE_LABEL[mode]);
      b.type = 'button';
      b.setAttribute('data-trend', mode);
      b.setAttribute('aria-pressed', mode === trendMode ? 'true' : 'false');
      els.trendSeg.appendChild(b);
    });

    var ms = matchesOf(matches, trendMode);
    if (ms.length < 2) {
      els.trend.appendChild(note('Two matches needed for a trend, you have ' + ms.length + '.'));
      return;
    }
    var recent = ms.slice(-TREND_MATCHES);
    var best = ms.reduce(function (max, m) { return Math.max(max, m.points); }, 0);
    var title = make('div', 'trend-title', 'Points ');
    title.appendChild(make('span', 'mini', '· best ' + best));
    els.trend.appendChild(title);
    els.trend.appendChild(sparkline(recent.map(function (m) { return m.points; }), 'points',
      function (v) { return String(Math.round(v)); }, 'Points over your last ' + recent.length + ' ' + MODE_LABEL[trendMode] + ' matches'));
    els.trend.appendChild(make('div', 'trend-title', 'Accuracy'));
    els.trend.appendChild(sparkline(recent.map(function (m) { return m.acc * 100; }), 'accuracy',
      function (v) { return Math.round(v) + '%'; }, 'Accuracy over your last ' + recent.length + ' ' + MODE_LABEL[trendMode] + ' matches'));
  }

  function renderReplays(plays) {
    var rows = playsInScope(plays, scope);
    var all = replayStats(rows);
    els.replayBox.textContent = '';
    if (!all) {
      els.replayBox.appendChild(note('No correct answers yet.'));
      return;
    }
    var main = make('span', 'pair');
    main.appendChild(make('b', '', all.avg.toFixed(1)));
    main.appendChild(document.createTextNode(' replays per correct answer'));
    els.replayBox.appendChild(row(main, all.firstTryPct + '% got it first listen'));
    MODE_ORDER.forEach(function (mode) {
      var r = replayStats(rows.filter(function (x) { return x.mode === mode; }));
      if (!r) return;
      els.replayBox.appendChild(row(make('span', 'pair', MODE_LABEL[mode]),
        r.avg.toFixed(1) + ' replays · ' + r.firstTryPct + '% first listen'));
    });
  }

  function whenText(ts) {
    var d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
      d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function renderMatches(matches) {
    var list = (matches || []).filter(validMatch).slice(-LIST_MATCHES).reverse();
    els.matchList.textContent = '';
    if (!list.length) {
      els.matchList.appendChild(note('No matches yet.'));
      return;
    }
    list.forEach(function (m) {
      var left = make('span', 'pair');
      left.appendChild(make('b', '', String(m.points)));
      left.appendChild(document.createTextNode(' pts '));
      left.appendChild(make('span', 'cnt', Math.round(m.acc * 100) + '% · ' + MODE_LABEL[m.mode] +
        (m.difficulty ? ' · ' + m.difficulty : '') + (m.ko ? ' · KO' : '')));
      els.matchList.appendChild(row(left, whenText(m.ts)));
    });
  }

  function renderNoteBars(tables) {
    els.noteBars.textContent = '';
    if (!tableTotals(tables.note).attempts) {
      els.noteBars.appendChild(note('No single-note answers yet.'));
      return;
    }
    D.NOTES.forEach(function (name, pc) { els.noteBars.appendChild(barRow(name, rowStats(tables.note, pc))); });
  }

  function renderConfusions(tables) {
    var list = confusions(tables).slice(0, CONFUSION_LIMIT);
    els.confusionList.textContent = '';
    if (!list.length) {
      els.confusionList.appendChild(note('No mistakes recorded yet.'));
      return;
    }
    list.forEach(function (c) {
      var pair = make('span', 'pair');
      pair.appendChild(make('b', '', c.from));
      pair.appendChild(document.createTextNode(' heard as '));
      pair.appendChild(make('b', '', c.to));
      if (c.tag) pair.appendChild(document.createTextNode(c.tag));
      els.confusionList.appendChild(row(pair, c.n + '×'));
    });
  }

  function sharp(name) { return name.replace('#', '♯'); }

  // Rows are what was heard, columns what was answered. Correct answers sit on
  // the diagonal in green; mistakes are shaded red by how often they happen.
  function renderMatrix(tables) {
    els.matrix.textContent = '';
    if (!tableTotals(tables.note).attempts) {
      els.matrixWrap.classList.add('hidden');
      return;
    }
    els.matrixWrap.classList.remove('hidden');
    var model = matrixCells(tables.note);
    els.matrix.appendChild(make('div', 'mcell hdr'));
    D.NOTES.forEach(function (n) { els.matrix.appendChild(make('div', 'mcell hdr', sharp(n))); });
    D.NOTES.forEach(function (heard, r) {
      els.matrix.appendChild(make('div', 'mcell hdr', sharp(heard)));
      D.NOTES.forEach(function (answered, c) {
        var v = model.counts[r][c];
        var cell = make('div', 'mcell', v ? String(v) : '');
        if (v && r === c) {
          cell.classList.add('diag');
        } else if (v) {
          cell.classList.add('err');
          // 25% at one slip up to 100% at the most frequent.
          var strength = Math.round((0.25 + 0.75 * (v / model.peak)) * 100);
          cell.style.background = 'color-mix(in srgb, var(--bad) ' + strength + '%, var(--bg))';
        }
        if (v) cell.title = sharp(heard) + ' heard as ' + sharp(answered) + ': ' + v;
        els.matrix.appendChild(cell);
      });
    });
  }

  // Per-interval and per-chord-type bars, each only once there is data.
  function renderKindBars(section, box, table, items) {
    var hasData = tableTotals(table).attempts > 0;
    section.classList.toggle('hidden', !hasData);
    box.textContent = '';
    if (!hasData) return;
    items.forEach(function (it) { box.appendChild(barRow(it.name, rowStats(table, it.key))); });
  }

  function render() {
    var h = Store.history();
    var empty = h.answers.length === 0;
    els.paused.classList.toggle('hidden', !Store.historyPaused());
    els.empty.classList.toggle('hidden', !empty);
    els.body.classList.toggle('hidden', empty);
    if (empty) return;

    setActive(els.scopeSeg, 'data-scope', scope);
    var tables = buildTables(h.answers, scope);
    renderTrend(h.matches);
    renderReplays(h.plays);
    renderMatches(h.matches);
    renderNoteBars(tables);
    renderConfusions(tables);
    renderMatrix(tables);
    renderKindBars(els.ivlSection, els.ivlBars, tables.ivl,
      D.INTERVALS.map(function (iv) { return { key: iv.semi, name: iv.label }; }));
    renderKindBars(els.qualSection, els.qualBars, tables.qual,
      D.QUALITY_KEYS.map(function (k) { return { key: k, name: D.CHORDS[k].label }; }));
  }

  /* ---------- export, import, reset ---------- */

  function setMessage(text, kind) {
    els.ioMsg.textContent = text;
    els.ioMsg.className = 'io-msg' + (kind ? ' ' + kind : '');
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // YYYY-MM-DD in local time.
  function dateStamp(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function exportHistory() {
    var blob = new Blob([Store.exportJson()], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'pitch-trainer-history-' + dateStamp(new Date()) + '.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    var h = Store.history();
    setMessage('Exported ' + h.answers.length + ' answers and ' + h.matches.length + ' matches.', 'good');
  }

  function importHistory(file) {
    if (file.size > MAX_IMPORT_BYTES) {
      setMessage('That file is too large to be a history export.', 'bad');
      return;
    }
    var reader = new FileReader();
    reader.onerror = function () { setMessage('Could not read that file.', 'bad'); };
    reader.onload = function () {
      var data;
      try {
        data = JSON.parse(reader.result);
      } catch (e) {
        setMessage('That file is not valid JSON.', 'bad');
        return;
      }
      var result = Store.mergeHistory(data);
      if (!result.ok && result.error === 'paused') {
        setMessage('Saving is paused because the stored history could not be read, so nothing was imported.', 'bad');
        return;
      }
      if (!result.ok) {
        setMessage('That file does not look like a Pitch Trainer history export (it needs an answers list and a matches list). Nothing was changed.', 'bad');
        return;
      }
      render();
      setMessage('Imported — ' + result.matches + ' matches total.' +
        (result.skipped ? ' ' + result.skipped + ' malformed ' + (result.skipped === 1 ? 'entry was' : 'entries were') + ' skipped.' : ''), 'good');
    };
    reader.readAsText(file);
  }

  function showResetConfirm(on) {
    els.resetConfirm.classList.toggle('hidden', !on);
    els.resetBtn.classList.toggle('hidden', on);
  }

  function resetHistory() {
    var done = Store.resetHistory();
    showResetConfirm(false);
    render();
    if (done) setMessage('History reset.', 'good');
    else setMessage('Saving is paused because the stored history could not be read, so nothing was reset.', 'bad');
  }

  /* ---------- events ---------- */

  function onClick(e) {
    var b = e.target.closest ? e.target.closest('button') : null;
    if (!b || b.disabled) return;
    if (b.hasAttribute('data-scope')) {
      scope = b.getAttribute('data-scope');
      render();
    } else if (b.hasAttribute('data-trend')) {
      trendMode = b.getAttribute('data-trend');
      render();
    } else if (b === els.exportBtn) {
      exportHistory();
    } else if (b === els.importBtn) {
      els.importFile.click();
    } else if (b === els.resetBtn) {
      showResetConfirm(true);
    } else if (b === els.resetNo) {
      showResetConfirm(false);
    } else if (b === els.resetYes) {
      resetHistory();
    }
  }

  function onFile(e) {
    var file = e.target.files && e.target.files[0];
    if (file) importHistory(file);
    e.target.value = '';           // so the same file can be chosen again
  }

  /* ---------- start ---------- */

  // Call once: finds the elements and attaches every listener.
  function init() {
    els = {
      view: $('statsView'), paused: $('statsPaused'), empty: $('statsEmpty'), body: $('statsBody'), scopeSeg: $('scopeSeg'),
      trendSeg: $('trendSeg'), trend: $('trend'), replayBox: $('replayBox'), matchList: $('matchList'),
      noteBars: $('noteBars'), confusionList: $('confusionList'),
      matrixWrap: $('matrixWrap'), matrix: $('matrix'),
      ivlSection: $('ivlSection'), ivlBars: $('ivlBars'), qualSection: $('qualSection'), qualBars: $('qualBars'),
      exportBtn: $('exportBtn'), importBtn: $('importBtn'), importFile: $('importFile'), ioMsg: $('ioMsg'),
      resetBtn: $('resetBtn'), resetConfirm: $('resetConfirm'), resetYes: $('resetYes'), resetNo: $('resetNo')
    };
    els.view.addEventListener('click', onClick);
    els.importFile.addEventListener('change', onFile);
  }

  // The tab is shown: draw from the history as it stands now.
  function show() {
    showResetConfirm(false);
    render();
  }

  // The tab is left: drop a half-answered reset prompt and the last message.
  function hide() {
    if (!els) return;
    showResetConfirm(false);
    setMessage('', '');
  }

  return {
    init: init,
    show: show,
    hide: hide,
    RECENT_WINDOW: RECENT_WINDOW,
    MIN_SAMPLE: MIN_SAMPLE,
    buildTables: buildTables,
    tableTotals: tableTotals,
    rowStats: rowStats,
    confusions: confusions,
    playsInScope: playsInScope,
    replayStats: replayStats,
    playedModes: playedModes,
    matchesOf: matchesOf,
    sparkPoints: sparkPoints,
    matrixCells: matrixCells,
    dateStamp: dateStamp
  };
})();
