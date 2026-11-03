# CLAUDE.md

Guidance for working on this repo. `DESIGN.md` is the full behavior spec. This file is the short version, plus the rules and layout for the rebuild.

## What this is

Pitch Trainer is a no-build ear-training web app. It drills three skills: naming single notes, naming chords (root and quality), and naming intervals. It is being rebuilt from scratch in small steps.

- `pitch-trainer-original.html` is the old single-file app. **Use it only to check behavior and exact numbers when DESIGN.md is unclear.** Do not copy its code, and do not restructure it into the new version. Write fresh code.
- `DESIGN.md` describes what the app should do. When it is unclear or silent on a number or edge case, check the old file. Where the old file has a bug that DESIGN.md lists under "Known issues", fix it in the new code.

## Hard constraints

- **No framework, no bundler, no build step.** Plain HTML, CSS and JS.
- **Must open by double-clicking `index.html`** (a `file://` URL). That means **no ES modules** (`type="module"` fails on `file://`), no `fetch()` of local files, and no `import`/`export`. Use plain `<script>` tags in dependency order.
- Each JS file is wrapped in an IIFE and defines **at most one global** (for example `MusicData`, `PianoAudio`). Later files read earlier globals. No other globals leak.
- Tone.js **14.8.49**, the 20 Salamander piano samples and the 18 Iowa acoustic guitar samples are vendored in `vendor/` and loaded by relative path. No CDN. The app works offline once installed (see "Hosting and offline").
- **All paths relative** (no leading `/`), so the app works from disk and from a GitHub Pages subfolder (`/eargym/`).
- Built for phones: `touch-action: manipulation` on controls, tap highlight off, works at 360px wide.
- `localStorage` only. Wrap every access in try/catch so the app still runs if storage is blocked.

## Theme

Dark amber. Use these CSS variables (defined in `css/styles.css`), never raw hex in components:

| Token | Value |
| --- | --- |
| `--bg` | `#14110f` |
| `--panel` | `#1c1815` |
| `--amber` | `#e8a13a` |
| `--amber-dim` | `#6b4d1f` |
| `--text` | `#eee4d3` |
| `--text-dim` | `#8c8378` |
| `--good` | `#7bc47f` |
| `--bad` | `#d16b5c` |
| `--line` | `#2c2620` |

One card, 420px wide, widening to 760px when a piano board or the Learn tab is showing.

## Preserve exactly

These are load-bearing. Changing any of them breaks existing users or brings back a fixed bug.

- **Storage keys** `pitchTrainer.settings.v1` and `pitchTrainer.history.v1`. Changing either orphans existing practice history.
- **History shape** `{ answers: [], matches: [], plays: [] }`, so old exports still import:
  - Since step 11 every new answer, match and play also carries `i`, the instrument id (`piano`, `guitar`). It is optional: an entry without it counts as piano, and import keeps an `i` that looks like an id (lowercase, up to 32 characters) and drops a malformed one without dropping the entry. Dedupe keys do not include it.
  - `answers` (cap 4,000): `{ k, t, g, ts }`. `k` is `note | root | qual | ivl`. `t` (target) and `g` (guess) are always **strings**: a pitch class `"0"`–`"11"` for `note` and `root`, a quality key for `qual`, a semitone count `"1"`–`"12"` for `ivl`. A chord answer logs both a `root` and a `qual` entry.
  - `matches` (cap 500): `{ ts, points, hits, answered, acc, mode, method, difficulty, quals, guess, playAs, notes, registers, ko }`. `acc` is 0–1. `quals` is quality keys joined with `+`. `quals`, `guess` and `playAs` are `null` outside chords mode. `notes` is the size of the note pool. `registers` is the `[bool, bool, bool]` selection. `ko` means knocked out.
  - `plays` (cap 4,000): `{ ts, correct, plays, mode }`. `plays` is at least 1.
  - On load, an object without `answers` and `matches` arrays is rejected, and a missing `plays` becomes `[]` (older saves).
  - Counting tables are derived from the raw log on render, never stored.
- **Identifiers stored in history**: pitch classes `0`–`11` (C = 0, never note names), chord quality keys `maj min aug dim maj7 min7 dom7 hdim7 dim7`, interval semitones `1`–`12`, mode names `notes chords intervals`.
- **Scoring**: 24-question match. Base 100 points, 150 when naming both chord root and type. +10 per streak step, capped at 10 steps. Multiply by the rarity correction in weak-note focus mode, then round.
- **Health**: Medium 800, Hard 500, Easy none. Replay costs 8. Miss penalty `0` if exact, else `25 + 25 × d` (d = pitch-class or interval distance, max 6). Wrong chord quality adds a flat 75. Piano chord: 45 per missed or stray key. Timeout: flat 100. Capped at 200 per question.
- **Audio timings in `playPitches`**: 15ms fade-out, 95ms muted wait, 8ms fade-in. They fix a real pop. Also: rolled notes 1.9s when a block strike follows, otherwise 2.6s; arpeggio 0.42s apart then 0.95s pause before the block; interval notes 0.6s apart; reference pitch 0.7s before the target.
- **15-second fallback**: if Tone.js is missing, a sample fails, or loading takes over 15s, switch to the built-in additive synth.
- **Piano chord answers are octave-agnostic but voicing-sensitive**: the lowest key names the root, and the gaps above it must exactly match the chord shape. C-E-G anywhere is right. E-G-C reads as an E chord.
- **Import merges, never replaces**: answers dedupe on `ts|k|t|g`, matches and plays on `ts`. Then sort by `ts` and re-apply all caps (including `plays`).

## File layout

Scripts load in this order. Each one may use the globals defined above it.

| File | Global | Purpose | Status |
| --- | --- | --- | --- |
| `index.html` | | Markup and script tags: tab bar, Practice menu, setup screen, match view, Learn view, and Stats view | Steps 4–6 |
| `css/styles.css` | | Theme tokens and all styles | Steps 1–6 |
| `vendor/tone/Tone.js` | `Tone` | Audio library, Tone.js 14.8.49 from the npm `tone` package (`build/Tone.js`), unmodified | Step 9 |
| `js/instruments.js` | `Instruments` | Instrument registry: each instrument's samples, playable range, release, volume, labels and fallback synth. Only `piano` so far. No dependencies and no DOM, so `sw.js` loads it too | Step 10 |
| `js/data.js` | `MusicData` | Notes, chord qualities, intervals and song references, presets, registers (per instrument), MIDI and pitch-class helpers | Steps 1, 11 |
| `js/guitar.js` | `Guitar` | Guitar chord voicings: open shapes, E- and A-shape barres, lowest within frets 0–12. No DOM, no audio | Step 11 |
| `js/audio.js` | `PianoAudio` | Sample loading (lazy, per instrument) and fallback synth for the selected instrument, instrument switching, `playPitches` (with strum), `silenceAll` | Steps 1, 10, 11 |
| `js/storage.js` | `Store` | Settings and history load/save, validation, migration, caps, instrument tags, history export / merge-import / reset | Steps 2–6, 11 |
| `js/keyboard.js` | `Keyboard` | Shared keyboard renderer for the practice board and Learn | Steps 3–5 |
| `js/game.js` | `Game` | Match logic for all three modes: round generation (incl. weak-note focus, reference pitch, the guitar's interval cap and chord voicings), grading for buttons and piano, timeout grading, scoring, health, replay cost, history logging, summary. No DOM, no audio, no clock | Steps 3–4, 11 |
| `js/setup.js` | `Setup` | The "Set up your match" screen: instrument picker, chips, presets, registers, focus, reference pitch, time, difficulty. Draws once, listens once | Steps 4, 11 |
| `js/learn.js` | `Learn` | The Learn tab: Notes (anchor trainer), Intervals and Chords comparators, "Practice this". Unscored, never writes history | Step 5 |
| `js/stats.js` | `Stats` | The Stats tab ("Your Ear"): Piano / Guitar / All filter, trend, listens, matches, per-note bars, confusions, matrix, interval and chord-type bars, and the export / import / reset controls. Read-only on the history except through `Store` | Steps 6, 11 |
| `js/app.js` | | Navigation (Practice, Learn and Stats tabs; menu, setup, game), the menu progress cards, the match and answer area (buttons or piano), the input toggle and the question timer; wires every listener once | Steps 3–6 |
| `js/sw-register.js` | | Registers `sw.js` over https or on localhost only; a failure is ignored. Defines no global | Step 9 |

Not loaded by a script tag:

| File | Purpose | Status |
| --- | --- | --- |
| `sw.js` | Service worker: precaches every app file under a versioned cache, serves cache-first, deletes old caches. Imports `js/instruments.js` for the sample list | Steps 9–11 |
| `manifest.webmanifest` | Install metadata: name "Ear Gym", standalone, start_url and scope `./`, theme colours, icons | Step 9 |
| `icons/` | `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (glyph inside the 80% safe zone), `apple-touch-icon.png` (180) | Step 9 |
| `vendor/salamander/` | The 20 samples `C`, `Ds`, `Fs`, `A` × octaves 3–7 (`C3.mp3` … `A7.mp3`), from the Tone.js audio repo | Step 9 |
| `vendor/guitar/` | 18 Iowa steel-string acoustic samples, every other semitone `E2`, `Fs2`, … `C5`, `D5`, from nbrosowsky/tonejs-instruments (CC BY 3.0, see `vendor/README.md`) | Step 11 |
| `tools/check-guitar.js` | Node check, not part of the app: `node tools/check-guitar.js` checks every guitar voicing, the guitar registers, the Intervals F5 cap and the history tags | Step 11 |

## Hosting and offline

- Hosted on GitHub Pages from a subfolder: `https://<user>.github.io/eargym/`. Everything uses relative paths, and the manifest's `start_url` and `scope` are `./`, so the folder name does not matter.
- `sw.js` precaches every file the app needs (the HTML, CSS, every script, Tone.js, every instrument's samples, the icons and the manifest) under the cache name in `CACHE_VERSION`, serves same-origin GETs cache-first, deletes every other cache on activate, and calls `skipWaiting()` and `clients.claim()`.
- The samples are not listed by hand: `sw.js` runs `importScripts('js/instruments.js?v=' + CACHE_VERSION)` and appends `Instruments.localSamplePaths()`, which is every registered instrument's `samples.local` + each file in `samples.files`. **To add an instrument's samples: put the files in their own `vendor/<name>/` folder, register the instrument in `js/instruments.js`, and bump `CACHE_VERSION`.** Nothing else in `sw.js` changes. Every other file is still listed by hand in `PRECACHE`. Both instruments' samples are precached, although the page itself only loads the selected one.
- The `?v=` on that import matters: without it a new worker could get the previous `instruments.js` from the HTTP cache and precache the old sample list (seen in testing when upgrading from step 10's `eargym-v3`). `sw-register.js` also registers with `updateViaCache: 'none'`.
- **Bump `CACHE_VERSION` in `sw.js` (`eargym-v1` → `eargym-v2` …) whenever any precached file changes, and keep its `PRECACHE` list in step with the files `index.html` loads.** Otherwise installed phones keep serving the old files forever.
- `js/sw-register.js` registers the worker only over https or on localhost. On `file://` there is no service worker.
- Opened from disk (`file://`), browsers refuse to fetch local files, so `audio.js` loads the instrument's `samples.remote` there instead (for the piano, `https://tonejs.github.io/audio/salamander/`; needs internet). Served over http(s) it always uses `samples.local` (`vendor/salamander/`). Either way the 15-second fallback to the synth still applies.
- localStorage keys and every behavior are unchanged by the PWA layer.
- To test locally: `python3 -m http.server` in the folder above the repo, then open `http://localhost:8000/eargym/`.

## Module notes

**`MusicData`** (`js/data.js`): `NOTES`, `NATURALS`, `CHORDS` (keyed by quality, each `{ key, label, name, intervals }`), `QUALITY_KEYS`, `INTERVALS` (each `{ semi, label, name, song }`), the presets for each, `REGISTERS` (the piano's three octaves from C3 = MIDI 48), `registersOf(instrumentId)` and `registerLowOf(instrumentId)` for any instrument, and helpers: `pc`, `octaveOf`, `midiToName`, `midiToFreq`, `nameToMidi`, `midiFrom`, `isBlack`, `pcDistance`, `registerOf`, `enabledRegisters`, `midiInRegister`, `chordPitches`, `chordName`, `intervalBySemi`.

**`Instruments`** (`js/instruments.js`): an instrument is a plain object `{ id, label, range: { low, high }, samples: { local, remote, files: { midi: filename } }, release, volumeDb, sourceLabel, loadingLabel, maxSounding, keyboardInput, chordVoicing, synth: { label, partials, stretch, detune, level, stopRamp, lowpass, noise } }`. `get(id)` returns it (the default, `piano`, for an unknown id), `has(id)`, `ids()`, `DEFAULT`, and `localSamplePaths()` for the service worker.

- `piano` holds exactly the Salamander setup the app has always had: the 20 samples, C3–B5 range, 0.06 s release, −8 dB, no `maxSounding`, `keyboardInput: true`, `chordVoicing: 'close'`, and the additive synth (7 partials, 0.22 level, 25 ms stop ramp, 6 kHz low-pass, 30 ms hammer noise at the 3rd harmonic).
- `guitar`: the Iowa acoustic, range E2–D#5 (40–75), 18 samples E2…D5 every other semitone, 0.06 s release, −14 dB (the recordings measure about 6 dB hotter than the piano over the same notes), `maxSounding: 77` (F5), `keyboardInput: false`, `chordVoicing: 'guitar'`, and a plucked variant of the synth (faster decays, 4.5 kHz low-pass, 12 ms pick noise). Remote URL for `file://`: `https://raw.githubusercontent.com/nbrosowsky/tonejs-instruments/master/samples/guitar-acoustic/`.

**`Guitar`** (`js/guitar.js`): `voicing(rootPc, quality)` returns `{ frets, pitches, shape }` in standard tuning (E2 A2 D3 G3 B3 E4), frets string 6 first, `null` = not played. An open shape wins when one exists (C, A, G, E, D, Am, Em, Dm, A7, G7, E7, D7, B7, Am7, Em7, Dm7, Cmaj7, Fmaj7, Amaj7, Dmaj7, Emaj7); otherwise the E-shape (root on string 6) or A-shape (root on string 5) barre with the lowest highest fret within 0–12. Every voicing has the root as its lowest note and every chord tone, inside a 4-fret window. C7 has no open shape here because the usual x32310 has no 5th. All 9 qualities have barre shapes, so the close-position fallback is never used. The highest voiced note is A#4.

**`PianoAudio`** (`js/audio.js`): plays the selected instrument; the global keeps its old name. Its samples come from `samples.local`, or `samples.remote` when the page is opened from `file://`. Call `init(instrumentId)` once (`app.js` passes `Store.settings().instrument`). `load(id)` switches instrument: it silences everything, marks audio not ready, and loads that instrument's samples only (each set is fetched the first time it is chosen and then kept, so switching back is instant). A load that finishes after the player has switched again is ignored, and each load has its own 15-second fallback to that instrument's synth. `onStatus(cb)` is called with `(label, kind, instrument)` whenever an instrument starts loading (`kind` null) or becomes ready; `app.js` uses it for the footer, the hint and enabling buttons. `onReady(cb)` is one-shot. `instrument()` returns the selected instrument and `loadingLabel()` its loading hint. `playPitches(pitches, gap, blockAfter, strum)` is the only way to make sound; `strum > 0` spreads every "together" strike low to high, `strum` seconds apart (guitar chords: 35 ms), and is 0 for the piano. `silenceAll()` stops everything, including notes scheduled for later. Call it when switching tabs or leaving a match.

- Samples are loaded with `Tone.ToneAudioBuffers` and played as `Tone.ToneBufferSource` voices tracked in our own list. This replaces `Tone.Sampler`, whose `triggerAttackRelease` stops tracking a note as soon as it is scheduled, so `releaseAll()` could never stop it. Each note uses the instrument's nearest sample, pitch-shifted, with the instrument's release and volume.
- The sample and synth paths share the mute → stop voices → wait → unmute sequence. Those fade timings (`TIMING`) and the note lengths are shared by every instrument; only the voice release, volume and synth belong to an instrument.

**`Store`** (`js/storage.js`): `loadSettings()` returns a complete, validated settings object (defaults for anything missing or invalid, old `range` migrated to `registers`, `intervals` accepted for `mode` and `learnMode`). `settings()` returns the live object (read-only) and `change(fn)` is the only way screens modify it: it runs `fn` on a copy, re-validates, saves and returns the result. A pinned chord root forces `guessTarget: 'type'` on load, and `refPitch` must be 0 or a note in C3–B5. `instrument` (default `piano`) must be a registered instrument id, otherwise it falls back to the default; the setup screen's picker sets it. `refPitch` is accepted across any instrument's registers (E2–B5). `pushAnswer`, `pushPlay` take the instrument id as a last argument and store it as `i`; `instrumentOf(entry)` reads it back (piano when missing). `saveSettings(s)` re-validates and writes a given object. The whole settings schema lives here, even fields no screen uses yet, so saving from one screen never drops another screen's values. `loadHistory()`, `history()`, `pushAnswer(kind, target, guess)`, `pushPlay(correct, plays, mode)`, `pushMatch(m)` and `saveHistory()` handle the log. The `push*` calls apply the caps; call `saveHistory()` once after a batch. `exportJson()` returns the history as pretty-printed JSON (settings are never included). `mergeHistory(data)` folds parsed export data in without ever replacing: it rejects anything without `answers` and `matches` arrays (`{ ok: false, error: 'shape' }`), drops malformed entries (counted in `skipped`), de-duplicates answers on `ts|k|t|g` and matches and plays on `ts`, sorts by `ts`, re-applies all three caps (4,000 answers, 500 matches, 4,000 plays, oldest first) and saves. `resetHistory()` empties the arrays in place, so the object from `history()` stays live for every reader. Saves do nothing until the matching load has run, so defaults can never overwrite stored data.

**`Game`** (`js/game.js`): `createMatch(settings, rng?)` takes a full settings object (normalized through `Store.normalizeSettings`, copied once: changing a setting means a new match). It returns `{ state, nextQuestion, listen, answerNote, answerInterval, answerChord, answerChordRoot, answerChordKeys, chordNeeds, summary, settings, qualities, intervals }`. Each mode only supplies its candidates (`candidatesFor`), its question (pitches, gap, blockAfter, text) and a grade; one shared `settle()` does scoring, streak, health, history logging and the end of the match, so new modes never duplicate it. `listen()` counts a play and charges the replay cost. The question counter shows `answered + 1`, as the old app did.

- Rules exported for checking on their own: `notePenalty`, `correctPoints(streak, mult, base)`, `missSuffix`, `intervalDistance`, `shapeToQuality`, `pickQuestion`, `setupProblem`, `pianoAllowed`, `effectiveMethod`, `boardFor`.
- Points base: 100, or 150 when naming both root and type of a chord (buttons or piano).
- Weak-note focus (Notes only): each draw re-reads history, so weights follow the match. A note's weight is `1 + 3 x (1 - accuracy)` from its last 100 note answers, and only once it has 3 attempts. Points for that draw are multiplied by `(totalWeight / poolSize) / weight`, so a note drawn twice as often pays half. `focusInfo()` counts the notes the setup label says it is "leaning on" (weight above 1.2).
- Reference pitch (Notes only): `refPitch` plays first and the target follows 0.7 s later, by prepending it to `pitches` with `gap` 0.7.
- `timeout(viaPiano)`: a miss with a flat 100 health penalty (Medium and Hard). It logs to `history.plays` but writes no `history.answers` entry, so no confusion pair. It returns the right answer to show. The clock itself lives in `app.js`.
- Chord buttons: halves not asked count as given; with one quality in play the type is filled in. Wrong root = note-distance penalty, wrong quality = flat 75.
- Piano: Notes answer by pitch class in any octave. Chord root-only is one key. Chord root-and-type is the set of held keys, graded octave-agnostic but voicing-sensitive, 45 per missed or stray key. A played shape that is no known chord logs the root entry only (decided in step 3; DESIGN.md left it open).
- Intervals use the Notes `registers` for the lower note (the settings schema has no separate field, as in the old app) and have no piano answers.
- Instruments (step 11): registers come from `D.registersOf(s.instrument)`; `pianoAllowed` is false without `keyboardInput`, so the guitar answers with buttons only; the match record gets `i`. `intervalCandidates(s)` drops every question whose top note is above the instrument's `maxSounding` (guitar: F5). If that leaves fewer than 2 interval sizes, it keeps the 2 smallest selected sizes instead (dropping the highest first), each with its questions under the cap if it has any, else all of them; the pool is never empty. Guitar chords have one candidate per root and quality (registers do not apply), played as `Guitar.voicing` with `strum` 0.035 (arpeggio: the usual roll, then the strike strummed). `referenceFor(s)` moves a reference pitch saved for another instrument by octaves into range.
- Setup rules: pinning a chord root forces type-only (app remembers the earlier target and restores it on unpin); type-only forces buttons through `effectiveMethod`, without overwriting the saved `method`; type-only with fewer than 2 qualities cannot start.

**`Setup`** (`js/setup.js`): `init({ onStart, onBack })` builds the chips and attaches every listener once; the Piano / Guitar picker at the top saves `instrument`, moves `refPitch` by octaves into the new range, and calls `PianoAudio.load`. Register chips are relabelled for the instrument and the reference menu is rebuilt only when the instrument changes. With the guitar, the Register row is hidden in Chords and a note in Intervals says high notes are limited; `sync()` re-reads `Store.settings()` and only updates what is shown. Which exercise it shows is `Store.settings().mode`, set when a menu card is tapped. Every change goes through `Store.change()`. Minimums: 2 notes, 2 intervals, 1 chord type, 1 register. Time per question and difficulty are one saved value shared by all exercises, as in the old app. Registers are shared between Pitch and Intervals, and separate for chord roots. The pinned-root rule keeps the earlier guess target in memory for this visit only.

**`Learn`** (`js/learn.js`): `init({ onPractice, onModeChange })` builds the controls and attaches every listener once (delegation on the Learn view and on the board); `show()` redraws the board for the saved sub-mode and re-reads the settings; `hide()` silences all sound. Sub-modes come from `Store.settings().learnMode`; `learnMode`, `anchorOn`, `anchorMidi`, `cmpA`, `cmpB` and `arpeggio` are the only settings Learn saves, all through `Store.change()`. Interval A / B, direction, melodic or harmonic, the shared root (Intervals and Chords) and the note-button register are session-only. It never calls any `Store.push*`, so nothing Learn does reaches the history. All sound goes through `PianoAudio.playPitches`; the board is C3–B5 with 12 (Intervals) or 11 (Chords) ghost keys above it. The pure text builders `anchorText`, `intervalDisplay` and `chordDisplay` are exported for checking.

- Anchor trainer: the interval is the real distance from the anchor, named above or below, so a note an octave up reads "octave above C4" and a lower one "minor 3rd below C4". The anchor itself, or anchor off, plays alone ("played on its own").
- "Above the keyboard" counts chord notes higher than B5, the last playable key (the old app compared against the top of the ghost keys, so it could never show).
- "Practice this": Notes only switches to Pitch and keeps the Pitch settings. Intervals makes the two compared intervals the pool (not offered when A and B are the same, since a match needs 2) and takes the direction. Chords makes the two compared types the pool. If the resulting settings cannot start a match (for example type-only with one type) the setup screen opens with the reason.
- The Refresher link on the setup screen sets `learnMode` to the exercise's mode and opens Learn.

**`Stats`** (`js/stats.js`): `init()` attaches every listener once (delegation on the view, one `change` on the file input); `show()` redraws from `Store.history()` as it stands; `hide()` drops a half-answered reset prompt and the last message. Every table is derived from the raw log on each draw, never stored. The derivations (`buildTables`, `rowStats`, `confusions`, `replayStats`, `playsInScope`, `matrixCells`, `sparkPoints`) are pure and exported.

- Instrument filter (step 11): Piano / Guitar / All, session-only, All by default. It narrows answers, matches and plays before anything is derived; untagged entries are piano. The empty state still looks at all answers.
- Scope: Recent keeps the last 100 answers of each kind (`note`, `root`, `qual`, `ivl`) and the last 100 entries of the plays log. All time keeps everything. The trend (last 30 matches, best score over all of that exercise) and the last-8 match list ignore the toggle. The scope and the trend exercise are session-only.
- Entries whose target or guess is out of range (a note outside 0–11, an unknown chord type, an interval outside 1–12) are ignored, so a damaged history cannot break the tab.
- Per-note bars use `note` answers only. Under 4 attempts is drawn faded; 4 or more attempts under 50% is flagged weak (exactly 50% is not). Confusions and the matrix: the six biggest across `note` and `root` answers, roots tagged "(root)", and the matrix covers `note` answers only. Interval and chord-type bars appear only once they have data.
- Replays count correct answers only. The per-mode list includes Intervals.
- The empty state replaces the analysis when there are no answers, but Export, Import and Reset stay visible so a backup can be restored onto an empty history (the old app hid them).
- Reset asks for confirmation inline (no `window.confirm`), and the prompt is dropped when the tab is left. Export is named `pitch-trainer-history-YYYY-MM-DD.json` using the local date.
- Anything that reads the history (weak-note focus, the menu progress bars) reads `Store.history()` when it needs it, so it sees an import or reset at once. The match summary comes from the match's own in-memory record.

**`Keyboard`** (`js/keyboard.js`): `render(container, { low, octaves, extra, labels, isDead, minKeyPx })` draws white and black keys; `extra` semitones above the playable range are drawn as unplayable ghost keys. It attaches no listeners: callers add one click listener and use `keyFromEvent(e)`, which returns null for ghost and dead keys. `mark`, `toggle` and `clearMarks` handle the `sel`, `ok`, `no` and `missed` classes. The chord board is fixed at C3 plus two octaves plus 11 ghost keys (`Game.CHORD_BOARD`); the Notes board spans the enabled registers.

## Instrument assumptions

Two instruments exist: the Salamander piano and the Iowa acoustic guitar. **Instrument-owned** places read the instrument object; the rest were left as they are on purpose.

Instrument-owned, read from `Instruments`:

- **Sample source** (`audio.js`): file map, vendored folder and remote URL are `instrument.samples`; release and volume are `instrument.release` and `instrument.volumeDb`. Only the selected instrument's samples are loaded.
- **Fallback synth** (`audio.js`): partials, level, stop ramp, low-pass and attack noise are `instrument.synth`.
- **Footer source label and loading hint** (`audio.js` → `#source`, `app.js`, `learn.js`): `instrument.sourceLabel`, `instrument.synth.label` + ` (reason)`, and `instrument.loadingLabel` while loading. The static first text in `index.html` (`#hint` "loading piano samples…", `#source` "loading…") is still hard-coded markup, shown only until the script runs.
- **Practice registers** (`data.js` `registersOf(id)`, `registerLowOf(id)`; used by `game.js`, `setup.js`): one octave each from `range.low`. Piano C3–B3, C4–B4, C5–B5; guitar E2–D#3, E3–D#4, E4–D#5. Registers need not start on a C (`midiInRegister` and `registerOf` take the first register's low note).
- **Reference pitch** (`setup.js` menu, `storage.js` validation, `game.js` `referenceFor`): the selected instrument's three registers; validation accepts any instrument's.
- **Answer input** (`game.js` `pianoAllowed`): only instruments with `keyboardInput` offer the piano board. The guitar is buttons only until the fretboard (DESIGN.md, Planned work).
- **Chord voicing** (`game.js`, `guitar.js`): `chordVoicing` `'close'` stacks the shape on a root in the chord registers; `'guitar'` plays `Guitar.voicing` by root pitch class and strums it, and the Chords Register row is hidden.
- **The F5 cap on guitar intervals** (`instrument.maxSounding`, `game.js` `intervalCandidates`): the top guitar sample is D5 (74). Shifting a sample up more than 3 semitones sounds thin and short, so on guitar no interval question goes above F5 (77). The cap drops questions, not registers: the register toggles and the stored `[bool, bool, bool]` are unchanged, the setup screen says high notes are limited, and if the cap leaves fewer than 2 interval sizes the highest sizes are dropped instead (see `Game`). Notes need no cap (they top out at D#5, a semitone above D5), nor do guitar chords (the highest voiced note is A#4). The piano has no cap.
- **Service worker precache** (`sw.js`): the sample paths come from `Instruments.localSamplePaths()`, for every instrument.

Left alone (fixed on purpose):

- **The register count is 3.** Settings (`registers`, `chordRegisters`) and every history match (`registers`) store a `[bool, bool, bool]` selection. Every instrument's `range` must be exactly three octaves. `MusicData.REGISTER_LOW`, `REGISTER_COUNT` and `REGISTERS` are still the piano's.
- **The piano boards** (`game.js` `CHORD_BOARD`, the Notes board in `boardFor`): fixed to the piano's C3 registers; they only appear with the piano.
- **Sound above the range on piano**: chord tones reach 11 semitones above B5 and interval upper notes 12 (up to B6). The piano's samples run to A7, so they are covered. A new instrument's samples must cover `range.high + 12`, or it needs a `maxSounding` cap like the guitar.
- **Learn** (`learn.js`) is unchanged: a C3–B5 keyboard with close-position chords and the C4–B4 anchor, played with whichever instrument is selected. On guitar its notes above F5 are pitch-shifted well past the top sample, and its chords are not guitar voicings. A guitar Learn view belongs with the fretboard step.
- **Learn anchor C4–B4** (`learn.js` `ANCHOR_LOW = 60`, `storage.js` `anchorMidi` 60–71) and the **note-button octaves C3 / C4 / C5** (`index.html` `data-oct` buttons) are hard-coded.
- **The "Piano" input method** (`method: 'piano'` in settings and history matches, the Piano / Buttons toggle, `#piano` and `#learnPiano`): this is the on-screen keyboard, not the sound, and the stored value must not change. With the guitar selected the saved `method` is kept and only overridden through `effectiveMethod`.
- **The `PianoAudio` global name**, kept so no caller changed.
- **The menu progress cards** count matches on every instrument together.

## Working rules

- Work on a feature branch per step. Never commit to or merge into `main` unless asked.
- There are no automated tests apart from `node tools/check-guitar.js` (voicings, guitar registers, the F5 cap, history tags). After each change, open `index.html` from disk and check by ear. Once the full app exists: all three exercises with both input methods, plus Learn and Stats.
- Fix the "Known issues" from DESIGN.md as each area is rebuilt (unrecognised piano chord shapes log the root only, by decision in step 3). Do not reproduce them: no listeners added inside render/sync functions; accept `intervals` when loading `mode` and `learnMode`; include intervals in per-mode replay stats; cap `plays` on import.
- Switching tabs silences all sound, and leaving a match for another tab abandons it (nothing is logged for an unfinished match).
- Keep the two known quirks only if they are harmless: there is no "random" chord playback (only `block` and `arp`). The match counter label should name the mode, not always say "Note".
