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
- Tone.js **14.8.49** comes from cdnjs. The piano samples come from `https://tonejs.github.io/audio/salamander/`. The app needs internet on first load. There is no offline mode yet.
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
| `index.html` | | Markup and script tags | Step 1: sound-check page only |
| `css/styles.css` | | Theme tokens and all styles | Step 1 |
| Tone.js (cdnjs) | `Tone` | Audio library | |
| `js/data.js` | `MusicData` | Notes, chord qualities, intervals and song references, presets, registers, MIDI and pitch-class helpers | Step 1 |
| `js/audio.js` | `PianoAudio` | Sample loading, fallback synth, `playPitches`, `silenceAll` | Step 1 |
| `js/soundcheck.js` | | Temporary step-1 test buttons. Delete once the real UI exists | Step 1 |
| `js/storage.js` | `Store` | Settings and history load/save, validation, migration, export/import | Planned |
| `js/keyboard.js` | `Keyboard` | Shared `renderKeyboard` for the practice board and Learn | Planned |
| `js/game.js` | `Game` | Round generation, scoring, health, timer, match flow | Planned |
| `js/learn.js` | `Learn` | Learn tab | Planned |
| `js/stats.js` | `Stats` | Stats tab | Planned |
| `js/app.js` | | Tabs, navigation, wiring all listeners once | Planned |

## Module notes

**`MusicData`** (`js/data.js`): `NOTES`, `NATURALS`, `CHORDS` (keyed by quality, each `{ key, label, name, intervals }`), `QUALITY_KEYS`, `INTERVALS` (each `{ semi, label, name, song }`), the presets for each, `REGISTERS` (three octaves from C3 = MIDI 48), and helpers: `pc`, `octaveOf`, `midiToName`, `midiToFreq`, `nameToMidi`, `midiFrom`, `isBlack`, `pcDistance`, `registerOf`, `enabledRegisters`, `midiInRegister`, `chordPitches`, `chordName`, `intervalBySemi`, `randomItem`.

**`PianoAudio`** (`js/audio.js`): call `init()` once, and use `onReady(cb)` to enable the play button. `playPitches(pitches, gap, blockAfter)` is the only way to make sound. `silenceAll()` stops everything, including notes scheduled for later. Call it when switching tabs or leaving a match.

- Samples are loaded with `Tone.ToneAudioBuffers` and played as `Tone.ToneBufferSource` voices tracked in our own list. This replaces `Tone.Sampler`, whose `triggerAttackRelease` stops tracking a note as soon as it is scheduled, so `releaseAll()` could never stop it. Sound settings are unchanged: 20 samples (C, D#, F#, A, octaves 3–7), nearest-sample pitch shifting, 0.06s release, −8 dB.
- The sample and synth paths share the mute → stop voices → wait → unmute sequence.

## Working rules

- Work on a feature branch per step. Never commit to or merge into `main` unless asked.
- There are no automated tests. After each change, open `index.html` from disk and check by ear. Once the full app exists: all three exercises with both input methods, plus Learn and Stats.
- Fix the "Known issues" from DESIGN.md as each area is rebuilt. Do not reproduce them: no listeners added inside render/sync functions; accept `intervals` when loading `mode` and `learnMode`; log a quality miss for unrecognised piano chord shapes; include intervals in per-mode replay stats; cap `plays` on import.
- Keep the two known quirks only if they are harmless: there is no "random" chord playback (only `block` and `arp`). The match counter label should name the mode, not always say "Note".
