# Pitch Trainer — Design Doc

Nov 3, 2026 · @fadi

## Overview

Pitch Trainer is a single-file, no-build ear-training web app that drills three skills: naming single notes, naming chords (root and quality), and naming intervals. The whole app is one HTML file of about 3,300 lines (CSS, markup, then one inline script) with no framework and no bundler.

- **Audio:** Tone.js 14.8.49 from cdnjs, playing the Salamander Grand Piano samples from tonejs.github.io. If either fails to load (15-second timeout), it falls back to a built-in additive piano synth.
- **Storage:** `localStorage` only. Two keys hold settings and practice history; nothing leaves the device.
- **UI:** one dark, amber-accented card, 420px wide, widening to 760px when a piano board is shown. Built for phones: tap highlight off, `touch-action: manipulation` on all controls.
- **Network:** needs internet for Tone.js and the samples on first load. It is not yet a PWA and has no offline mode.
- **Tabs:** Practice (the scored game), Learn (unscored exploration), Stats (progress and confusion analysis).

The core loop is a 24-question match. The app plays something, the player answers by buttons or on an on-screen piano, and the app scores the answer, logs it, and moves on.

## Screens and navigation

The app has three top-level tabs, switched by a segmented control: **Practice**, **Learn** and **Stats**. Practice has three internal views.

1. **Menu** (title "Ear Trainer"): three exercise cards, Pitch Trainer, Chord Recognition and Interval Trainer. Each card has a progress bar showing average accuracy over the last 5 matches of that exercise, plus the best score, or "Not played yet".
2. **Setup** ("Set up your match"): per-exercise options, described below, with a "Practice now" button and a "Refresher" link into Learn for that exercise.
3. **Game**: the play button, the answer area, the score strip, and a "Settings" back link. A match summary replaces the answer area when the match ends.

Setup options by exercise:

| Option | Pitch | Chords | Intervals |
| --- | --- | --- | --- |
| Which items are in play | 12 note chips (presets: all, naturals), minimum 2 | 9 quality chips (presets: basic, triads, sevenths, all), minimum 1 | 12 interval chips (presets: wide, thirds, all), minimum 2 |
| Registers | Any combination of 3 octaves starting at C3 | Same, for chord roots | Same, for the lower note |
| Root | n/a | Random or a pinned root | Random or a pinned root |
| What to guess | n/a | Both, root only, or type only | n/a |
| Chord playback | n/a | Block or arpeggio | n/a |
| Direction | n/a | n/a | Ascending, descending or mixed |
| Weak-note focus | Toggle | n/a | n/a |
| Reference pitch | Optional note played first | n/a | n/a |
| Time per question | Off, 5, 10 or 20 seconds | Same | Same |
| Difficulty | Easy, Medium or Hard | Same | Same |

The input method (Buttons or Piano; for intervals, Names or Semitones) can also be switched mid-match from the game view without restarting. The card widens only when a piano board or the Learn tab is showing.

**Learn** and **Stats** are described in their own sections below. Learn has a "Practice this" button that carries whatever you were exploring straight into a new match.

## Music data

Everything is expressed in MIDI numbers and pitch classes (0 to 11, C = 0). Sharps only, no flats. Notes are named `C, C#, D, ... B`.

**Chord qualities** (nine, defined as semitone offsets from the root):

| Key | Name | Intervals |
| --- | --- | --- |
| maj | major | 0, 4, 7 |
| min | minor | 0, 3, 7 |
| aug | augmented | 0, 4, 8 |
| dim | diminished | 0, 3, 6 |
| maj7 | major 7th | 0, 4, 7, 11 |
| min7 | minor 7th | 0, 3, 7, 10 |
| dom7 | dominant 7th | 0, 4, 7, 10 |
| hdim7 | half-diminished 7 | 0, 3, 6, 10 |
| dim7 | diminished 7th | 0, 3, 6, 9 |

**Intervals** are 1 to 12 semitones: m2, M2, m3, M3, P4, A4 (tritone), P5, m6, M6, m7, M7, P8. Each has a song reference for its ascending form, used in Learn (for example 5 semitones is "Here Comes the Bride", 7 is the Star Wars main theme, 12 is "Somewhere Over the Rainbow"). The default interval selection is the four widest-sounding gaps: M3, P4, P5, P8.

**Registers.** There are three one-octave registers starting at C3 (MIDI 48): C3 to B3, C4 to B4, C5 to B5. Notes, intervals and chord roots can each enable any combination, with at least one always on. Only the first register is on by default. Chord roots use the same registers, and a chord's upper notes can extend past the root register (a maj7 reaches 11 semitones above its root).

**Practice piano board.** In Notes mode the board spans exactly the enabled registers. In Chords mode it is always a fixed 2-octave (24-key) board from C3, plus 11 drawn-but-unplayable "ghost" keys on top so a chord rooted high still has somewhere to show its upper notes. Keys outside the active note pool or register are drawn as dead and ignore taps.

## Exercise modes and round generation

There are three modes: `notes`, `chords` and `intervals`. Each round picks one question uniformly from the candidate set, except in Notes mode with weak-note focus on. A question is never the same as the one just before it (tracked in `lastKey`), unless only one candidate exists.

**Notes.** Candidates are every selected note in every enabled register. With focus on, each note's draw weight is `1 + 3 × (1 − accuracy)`, using recent accuracy from history, and only once that note has 3 or more attempts. A note you miss half the time comes up about 2.5 times as often as one you always get. With no history, every weight is 1. To keep matches comparable, points for a focused draw are multiplied by a rarity correction: a note drawn twice as often pays half.

**Chords.** Candidates are every chord root in the pool, in every enabled register, crossed with every selected quality. The root pool is all 12 notes, or one pinned root. Playback is block (all notes together) or arpeggio (notes roll out at 0.42s spacing, then the whole chord strikes after a 0.95s pause). The "random" playback option appears in a code comment but is not implemented; only block and arp are accepted when loading settings.

**Intervals.** Candidates are every enabled register, crossed with every root (or the pinned one), crossed with every selected interval. Direction is ascending, descending, or a coin flip per question for mixed. The two notes play 0.6s apart.

**Optional reference pitch (Notes only).** A chosen reference note plays first, then the target 0.7s later, so the player can hear the target relative to a known pitch.

**Timer.** A per-question countdown (5, 10 or 20 seconds) starts only when the first listen is triggered, so the player is never timed before the sound begins. Replays do not restart it. On timeout the round is a miss with a flat 100-point health penalty, and no confusion pair is recorded.

## Answer methods

**Buttons.**

- Notes: one button per selected note. A tap answers immediately.
- Intervals: one button per selected interval, labelled by name (m3, P5) or by semitone count, depending on the Names / Semitones toggle.
- Chords: a Root grid (12 notes) and a Type grid (selected qualities). The answer submits automatically once both halves are chosen. Halves that are not being asked (root-only or type-only mode) count as given. If only one quality is in play, the type is filled in for you.

**Piano.** Available for Notes and Chords, not Intervals. In Notes mode, tapping a key answers by pitch class, in any octave. In Chords mode:

- Root-only: one key tap is the whole answer, any octave.
- Both: toggle keys, then press Submit. The answer is **octave-agnostic but voicing-sensitive**. The lowest key played names the root, and the gaps above it must exactly match the chord's interval shape. C-E-G played anywhere is right; E-G-C reads as an E chord and is wrong.
- Type-only: piano is not allowed, because a keyboard answer always implies a root. The input toggle is hidden and the app forces Buttons.

**Setup rule interactions.** Pinning a chord root forces type-only guessing (the root is already known) and therefore buttons. Unpinning restores the earlier guess target. Guessing the type with fewer than 2 qualities selected disables Start.

**Feedback.** After each answer the correct and incorrect buttons or keys are coloured, and a message names the answer. Misses name the size of the error ("off by a semitone", "off by a minor 3rd"). Chord misses say whether the root or the type was right.

## Scoring, health and match flow

A match is **24 questions**. Correct answers earn points and build a streak. Wrong answers reset the streak and, on Medium and Hard, drain health. The match ends after 24 questions or when health reaches zero.

**Difficulty.**

| Level | Health | Behavior |
| --- | --- | --- |
| Easy | none | Always plays all 24. Mistakes cost streak, not progress. Replays are free. |
| Medium | 800 | Misses drain health. Each replay costs 8. |
| Hard | 500 | Same rules, less room. |

Changing difficulty mid-match starts a fresh match, so a score always belongs to one rule set.

**Points for a correct answer.** Base of 100, or 150 when naming both root and type of a chord. Add 10 per streak step, capped at 10 steps (so +100 max). Multiply by the rarity correction in focus mode (otherwise 1), and round.

**Health penalty for a miss.** Capped at 200 per question so one bad chord cannot end a match.

| Case | Penalty |
| --- | --- |
| Note or chord root, pitch-class distance d (wraps; max 6) | 0 if exact, else 25 + 25 × d (50 at a semitone, 175 at a tritone) |
| Interval, distance d = min(abs(guess − answer), 6) | same formula |
| Chord, wrong quality | flat 75, added to the root penalty |
| Chord on piano | 45 per missed or stray key |
| Timeout | flat 100 |

**After each answer** the app waits about 1.1 to 1.9 seconds (longer for piano chords), then queues the next question; the player taps Play to hear it. When the match ends, a summary shows points, correct/total, accuracy, average replays per correct answer, health left (or difficulty on Easy), and the five most frequent confusions from that match ("C heard as D"), or "Clean sheet". A New match button starts again.

The score strip shows points, a delta flash (+gain or −cost), question number out of 24, a health bar (Medium and Hard only), streak and hits.

## Audio engine

**Samples.** A `Tone.Sampler` loads 20 Salamander Grand Piano samples (C, D#, F# and A in each octave from 3 to 7) from `https://tonejs.github.io/audio/salamander/`, with a release of 0.06s and volume of −8 dB. Tone pitch-shifts between the sampled notes. The sampler routes through a `Tone.Gain` node that the app uses to mute and unmute cleanly. The play button stays disabled and the hint reads "loading piano samples…" until the samples load.

**Fallback synth.** If Tone.js is missing, the samples error, or loading takes longer than 15 seconds, the app builds a Web Audio additive piano: 7 sine partials with individual gains and decay times, slight inharmonic stretch, tiny random detune, a 30ms filtered noise burst for the hammer, and a 6 kHz low-pass. The footer line shows which source is active ("Salamander Grand Piano samples" or "built-in piano synth (reason)").

**Click-free playback.** `playPitches(pitches, gap, blockAfter)` is the single entry point for sound. It ramps the output gain to zero over 15ms, releases all voices, then waits 95ms so old notes finish releasing before restoring gain with an 8ms ramp. Restoring gain while an old note was still ringing caused an audible pop, which is why the wait exists. A play token cancels stale scheduled playback if a new play starts.

- `gap > 0` rolls the notes out one by one instead of striking them together.
- `blockAfter > 0` then re-strikes them together after the roll, so an arpeggio ends on the full chord. Rolled notes are cut shorter (1.9s instead of 2.6s) so they have begun to fade before the strike.

Switching tabs or leaving a match silences everything.

## Learn tab

Learn is unscored exploration with three sub-modes (Notes, Intervals, Chords). It shares one 3-octave keyboard (C3 to B5) with the practice board, via a shared `renderKeyboard` function. Pressed notes light up.

- **Notes (anchor trainer).** Tap any key or note button to hear it. With anchor on (default, selectable from C4 to B4), the anchor plays first, then the tapped note, and the display names the interval between them ("major 3rd above C4"). With anchor off, the note plays alone. A separate octave selector sets which register the note buttons use.
- **Intervals.** Pick interval A and B from dropdowns (default m3 vs M3), play either, or flip between them. Choose melodic or harmonic (together), and ascending or descending. The display shows the note names, semitone count and the song reference. Tapping a key sets the root, so you can hear the same pair from any note.
- **Chords.** Pick a root (12 buttons or a key tap, which keeps the octave you tapped), pick chord A and B (default maj vs min), play either or flip, in block or arpeggio form. The display shows the chord name, its note names, and its semitone offsets, and warns if upper notes run past the board.

**Practice this.** Each sub-mode has a button that jumps to Practice with matching settings: the two compared intervals (and direction) or the two compared chord types become the match's item pool, or Notes mode with current settings. A match starts immediately.

## Stats and persistence

**Storage keys** (both in `localStorage`, every access wrapped in try/catch so the app still runs if storage is blocked):

| Key | Contents |
| --- | --- |
| `pitchTrainer.settings.v1` | Mode, input method, difficulty, note/quality/interval selections, directions, roots, registers, timer, reference pitch, focus toggle, Learn state |
| `pitchTrainer.history.v1` | `{ answers: [], matches: [], plays: [] }` |

Loaded settings are validated field by field with fallbacks, and an old single-octave setting is migrated to the register selection.

**History shape.** Counting tables are derived from the raw log on render, not stored, which is what lets the Recent / All-time toggle "forget".

- `answers` (capped at 4,000): `{ k: note | root | qual | ivl, t: target, g: guess, ts }`, one per graded answer. A chord answer logs both a root entry and a quality entry.
- `matches` (capped at 500): timestamp, points, hits, answered, accuracy, mode, method, difficulty, qualities, guess target, playback style, note count, registers, knocked-out flag.
- `plays` (capped at 4,000): per question, `{ ts, correct, plays, mode }`, where `plays` is how many listens it took.

**Stats tab.** A Recent (last 100 answers per kind) or All-time toggle drives:

1. A points and accuracy sparkline trend, one exercise at a time because points are not comparable across exercises (last 30 matches, with a best score).
2. Replays per correct answer, and percentage right on the first listen, overall and per mode.
3. The last 8 matches.
4. Per-note accuracy bars in chromatic order. Bars with fewer than 4 attempts are shown faded, and under 50% (with 4 or more attempts) are flagged weak.
5. The six biggest confusions across notes and chord roots.
6. A 12×12 note confusion matrix, with correct on the diagonal in green and errors shaded red by frequency.
7. Per-interval and per-chord-quality accuracy bars, shown only once there is data.

**Export and import.** Export downloads the history as dated JSON. Import merges instead of replacing, deduplicating by timestamp, so restoring a backup cannot wipe data already on the device. A Reset all history button clears it. Settings are not part of the export.

## Known issues in the current code

Found while reading the file. None break the app today, but they are worth fixing in the first Claude Code pass, and the first one gets worse the longer a session runs.

| Issue | Where | Effect | Fix |
| --- | --- | --- | --- |
| Click listeners stack up | `syncSetup()`, the `#playAsRow` wiring sits inside the `if (isChords)` block | Every time the Chords setup screen refreshes, each playback button gains another click handler, and each handler calls `syncSetup()` again, so the count grows with use | Move that wiring to the one-time wiring section, next to the other setup listeners |
| Intervals mode not restored | `loadSettings()` | Only `notes` and `chords` are accepted for `mode` and `learnMode`, so a saved `intervals` value is discarded on reload | Add `intervals` to both allowed lists |
| Piano chord misses can skip the quality log | `submitPianoChord()` | The quality confusion is only logged if the played shape matches a known chord, so a nonsense shape records a root entry but no quality entry | Decide whether to log an "unknown shape" miss against the true quality |
| Interval replays missing from per-mode stats | `renderReplays()` | The per-mode list covers only Pitch and Chords; intervals count in the overall figure only | Add `intervals` to the list |
| `plays` not capped on import | `importHistory()` | Answers are re-capped after a merge, but the plays log is not | Apply the same 4,000 cap |
| Leftover code | `renderStats()`, `buildRefOptions()` area | A `void any;` with unused totals, and a comment about pinned roots that belongs above `normalizeChordSetup()` | Delete and move |

Two smaller quirks, left as they are: a code comment lists a "random" chord playback style that was never built, and the match counter label says "Note" in every mode.

## Notes for Claude Code

The working app is `pitch-trainer_1.html`. Treat it as the source of truth and edit it rather than rewriting from this document. This doc describes behavior; the file holds the exact numbers and edge cases.

**Preserve exactly:**

- The storage keys `pitchTrainer.settings.v1` and `pitchTrainer.history.v1`, and the history shape. Changing either orphans existing practice history.
- The scoring and penalty formulas, the 24-question match length, the health values (800 / 500) and the 8-point replay cost.
- The audio timings in `playPitches` (15ms fade-out, 95ms wait, 8ms fade-in). They fix a real pop.
- The octave-agnostic, voicing-sensitive chord rule for piano answers.
- The import merge-and-dedupe behavior, and the 15-second fallback to the synth.

**If the file gets split**, keep it build-free: `index.html`, `styles.css`, and plain scripts for music data, audio, game logic, learn, stats and storage. Keep Tone.js from the CDN unless offline use is wanted, in which case vendor it and the samples.

**Suggested first pass:**

1. Initialize git, add `.gitignore`, and write `CLAUDE.md` from this doc.
2. Fix the issues in the table above.
3. Manually check all three exercises with both input methods, plus Learn and Stats, before and after each change. There are no automated tests.

**Not in the app yet, if wanted later:** offline mode (a service worker and bundled samples), a Capacitor Android wrapper like Lift Log, flats as an alternative note spelling, and settings in the export file.
