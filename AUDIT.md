# Step 7 audit: rebuild vs. original

Audited on 2026-11-03 against `main` at `f44edd0` (after step 6, Stats). No app code was changed.

**Sources compared**

- **Original:** `pitch-trainer-original.html` (quoted as `orig:LINE`).
- **Rebuild:** `js/*.js` and `index.html` on `main` (quoted as `file:LINE`).
- **Spec:** `DESIGN.md`, plus `CLAUDE.md` for decisions made during the rebuild.

**Method.** I read both code bases side by side. I also ran a small Node harness that loads `data.js`, `storage.js` and `game.js` against a stubbed `localStorage`. It checked the scoring and penalty numbers, health, replay cost, match length, piano chord grading, timeout logging, the no-repeat rule, focus weights, settings round-trips and the import merge and caps. The harness was not committed. Every number marked "verified" below came from running the rebuild, not only from reading it. I did not do a listening test.

**Verdict key:**

- **matches**: same behavior and numbers.
- **differs**: behavior changed. The quotes from both files show how, and the entry says which side DESIGN.md supports.
- **missing**: the original does it and the rebuild does not.

---

## Summary

Every number on the "Preserve exactly" list matches: scoring, penalties, health, the replay cost, the match length, the audio timings, the 15-second fallback, the storage keys and the history shape. All six "Known issues" from DESIGN.md are fixed. The differences below are mostly small. Only two affect behavior in a way a player would notice:

- A timed-out question keeps sounding, where the original cut it off (§9a).
- On the setup screen, tapping the already-selected **Type** while a root is pinned makes the app forget the earlier guess target (§4a).

Everything else is a deliberate fix of an original bug, a decision written down in CLAUDE.md, or a cosmetic change.

| # | Area | Verdict |
| --- | --- | --- |
| 1 | Scoring and health | **matches** (all 11 numbers verified). Feedback wording differs slightly (1a). |
| 2 | Round generation | **matches**, apart from 2a and 2b. 2a (no-repeat) is an original bug the rebuild fixes, as DESIGN.md asks. |
| 3 | Piano chord answers | **matches** (verified). The rebuild also marks keys after a timeout (3a). |
| 4 | Setup rules | **matches**, with one edge-case bug (4a) and one documented change (4b). |
| 5 | History | **matches** (shape, caps, logging verified). `matches[].method` differs (5a); import is stricter (5b); export date (5c). |
| 6 | Settings | **matches** (keys, fields, `intervals` survives reload, verified). Validation differs in three small places (6a–6c). |
| 7 | Learn | **matches** defaults and mapping. The anchor wording differs and is a fix (7a). "Practice this" fixes an original bug (7b). |
| 8 | Stats | **matches** thresholds, window and trend rules. Faded-bar styling and two empty-state details differ (8a–8c). |
| 9 | Audio | **matches** all timings and the fallback. Timeout silencing is **missing** (9a). The synth path now shares the 95 ms wait (9b). |

---

## 1. Scoring

| Rule | Original | Rebuild | Verdict |
| --- | --- | --- | --- |
| Base 100, or 150 for chord root + type | `orig:1399` `mode === 'chords' ? (guessTarget === 'both' ? 150 : 100) : 100` | `game.js:546` `base: askRoot && askType ? CHORD_BOTH_POINTS : BASE_POINTS`; piano chord `game.js:624` `CHORD_BOTH_POINTS`; piano root `game.js:565` `BASE_POINTS` | matches. Verified: 1st correct = 110, chord both = 160. |
| +10 per streak step, capped at 10 steps | `orig:1400` `base + Math.min(streak, 10) * 10` | `game.js:86` `(base \|\| BASE_POINTS) + Math.min(streak, STREAK_CAP) * STREAK_BONUS` | matches. Verified: streak 10, 11 and 15 all give 200; a perfect 24 gives 4,350. |
| Rarity multiplier, then round | `orig:1401` `Math.round(raw * currentMult)` | `game.js:87` `Math.round(raw * (rarityMultiplier \|\| 1))` | matches |
| Miss penalty `0` or `25 + 25 × d` | `orig:1394` | `game.js:82` (identical) | matches. Verified 0, 50, 75 … 175. |
| Interval distance `min(\|g − a\|, 6)` | `orig:1647` | `game.js:93` | matches. Verified: m2 vs P8 costs 175. |
| Cap 200 per question | `orig:1445` `Math.min(penalty \|\| 0, MAX_PENALTY)` | `game.js:436` `-Math.min(grade.penalty, MAX_PENALTY)` | matches. Verified: a tritone root plus a wrong type (250) costs 200; 7 stray keys (315) cost 200. |
| Wrong quality: flat 75, added to the root penalty | `orig:1683` `if (!qualOk) penalty += 75;` | `game.js:530` `+ (qualOk ? 0 : WRONG_QUALITY_PENALTY)` | matches. Verified −75. |
| Piano chord: 45 per missed or stray key | `orig:1866` `(expected.size - matched) + (sel.length - matched)` × 45 | `game.js:623` `(missed.length + no.length) * PIANO_KEY_PENALTY` | matches |
| Timeout: flat 100 | `orig:2950` `finishRound(false, …, 1300, 100)` | `game.js:665` `penalty: TIMEOUT_PENALTY` | matches. Verified −100. |
| Replay costs 8, Medium and Hard only, can knock out | `orig:3274-3277` | `game.js:393-400` | matches. Verified: 800 → 792; Easy costs 0. |
| Health: Easy none, Medium 800, Hard 500 | `orig:1050-1054` | `game.js:57-61` | matches (verified) |
| 24-question match; ends at 24 or when health ≤ 0 | `orig:1454-1457` | `game.js:441-442` | matches (verified) |

**1a. Feedback wording (differs, cosmetic).** The rebuild adds the "off by …" suffix in two places where the original did not, and spells intervals differently.

- Intervals. Original `orig:1645` `const text = iv.label + ' — ' + iv.full + dir;` and `orig:1649` `correct ? 'Correct — ' + text : 'That was ' + text`. Rebuild `game.js:267` `iv.label + ' (' + iv.name + ')'` and `game.js:502` `'That was ' + question.text + missSuffix(d)`.
- Chord root-only on buttons. Original `orig:1686` `if (guessTarget !== 'both') msg = 'That was ' + text;`. Rebuild `game.js:536` `else if (askRoot && !askType) message = 'That was ' + question.text + missSuffix(d);`.

DESIGN.md ("Misses name the size of the error") supports adding the suffix. But for intervals the suffix reuses the pitch-class names, so guessing m2 for P8 reads "off by a tritone", although the sizes are 11 semitones apart. The 6 is only the penalty cap. See fix list #5.

## 2. Round generation

**2a. No repeat in a row (differs; the rebuild follows DESIGN.md).** In Notes mode the original's exclusion skips the check for the first candidate, so the lowest selected note in the lowest register can come up twice in a row:

- `orig:1325` `if (cands.length && String(midi) === lastKey) continue;` (when `cands` is empty, the first candidate is pushed even if it equals `lastKey`)
- `game.js:170` / `game.js:179` `candidates.filter(function (k) { return k !== previous; })`, used by both the uniform and the weighted pick

DESIGN.md says "never the same as the one just before it". The rebuild is right. Verified: 0 repeats over 24 questions with 2 candidates.

**2b. Previous question kept across matches (differs, harmless).** The original resets `lastKey = null` when an exercise is opened (`orig:3142`). The rebuild keeps `game.js:286` `var previousKey = null;` at module level and never resets it, so a new match will not open on the question the last one ended on. DESIGN.md is silent. This is harmless.

| Rule | Verdict |
| --- | --- |
| Weak-note weight `1 + 3 × (1 − acc)` over the last 100 `note` answers, only with 3+ attempts (`orig:1091`, `orig:1097-1104`, `game.js:194-206`) | matches. Verified: 50% → 2.5, no history → 1. |
| Rarity correction `(totalWeight / poolSize) / weight` (`orig:1342-1344`, `game.js:343-347`) | matches |
| Setup "leaning on N weak notes" (weight > 1.2) (`orig:2780`, `game.js:211`) | matches |
| Registers: Notes and Intervals use `registers`, chord roots use `chordRegisters`, base C3 (`orig:1120`, `game.js:131-133`) | matches |
| Notes candidates: selected notes × enabled registers (`orig:1321-1329`, `game.js:218-224`) | matches |
| Chord candidates: enabled registers × root pool (all 12, or the pinned one) × selected qualities (`orig:1364-1366`, `game.js:240-245`) | matches |
| Interval candidates: registers × roots × selected intervals; direction per question, with a coin flip for mixed (`orig:1348-1357`, `game.js:232-237`, `game.js:263`) | matches |
| Arpeggio 0.42 s apart, then a 0.95 s pause before the block (`orig:3290-3293`, `game.js:49-50`) | matches (verified) |
| Interval notes 0.6 s apart (`orig:3289`, `game.js:48`) | matches (verified) |
| Reference pitch first, target 0.7 s later (`orig:3287-3291`, `game.js:255-256`) | matches (verified) |
| Chord playback: only `block` and `arp`, no "random" (`orig:1939`, `storage.js:41`) | matches (the quirk is kept, as intended) |

## 3. Piano answers

| Rule | Verdict |
| --- | --- |
| Lowest key names the root; the offsets above it must equal the shape exactly (`orig:1837-1841`, `game.js:594-601`) | matches. Verified: C-E-G an octave up is correct; E-G-C is wrong, with root E. |
| Model answer shown where the player put a correct root, else in the lowest octave, and pulled down 12 if it would run past the drawn board (`orig:1849-1850`, `game.js:577-583`) | matches |
| Marks: chosen and right = `ok`, chosen and wrong = `no`, right but not chosen = `missed` (`orig:1854-1863`, `game.js:607-609`, `app.js:431-433`) | matches |
| Notes on the piano: the guessed key is `ok`/`no`; the played key is also `ok` (right) or `missed` (wrong) (`orig:1782-1784`, `app.js:435-436`) | matches |
| Chord root-only: one key; the C3-octave root key is marked `missed` on a miss (`orig:1798-1800`, `game.js:570`) | matches |
| Ghost keys: 11 above the 24-key chord board, drawn and never playable (`orig:1744`, `game.js:55`; ghost keys are `<div>`s, not buttons, so `keyboard.js:94` ignores them) | matches |
| Dead keys: Notes only, outside the note pool or an off register; none on the chord board (`orig:1753-1764`, `app.js:342-347`) | matches |
| Type-only answers on the piano are not allowed; the toggle is hidden (`orig:1012`, `orig:3211-3213`, `game.js:119-123`, `app.js:375-377`) | matches |
| Unknown shape logs the root entry only (`orig:1843-1844`, `game.js:617-619`) | matches, and is now a recorded decision (CLAUDE.md, step 3). Verified. |

**3a. Keys marked after a timeout (differs, an addition).** The original `timeOut()` (`orig:2940-2951`) only prints the answer. The rebuild marks the right keys as `missed` on the piano: `game.js:647` `if (viaPiano) detail.keys = { ok: [], no: [], missed: [question.midi] };`. DESIGN.md is silent. This is harmless and helpful.

## 4. Setup rules

| Rule | Verdict |
| --- | --- |
| Minimums: 2 notes, 2 intervals, 1 chord type, 1 register (`orig:2758`, `orig:2968`, `orig:3017`, `orig:2880`; `setup.js:208-228`) | matches |
| Type-only with fewer than 2 types cannot start (`orig:2860`, `game.js:143`) | matches |
| Presets: notes all / naturals; types basic / triads / sevenths / all; intervals wide / thirds / all (`orig:1014-1019`, `orig:2953-2957`, `data.js:13-16`, `data.js:33-38`, `data.js:66-70`) | matches |
| Pinning a chord root forces type-only, which forces buttons (`orig:3096-3105`, `setup.js:184-194`, `game.js:126-128`) | matches |
| Defaults: Notes, piano, Easy, all 12 notes, M3/P4/P5/P8, maj + min, random roots, guess both, block, ascending, names, register C3 only (both), timer off, no reference, focus off, anchor C4 on, maj vs min (`orig:992-1118`, `orig:2367-2376`, `storage.js:80-111`) | matches |
| Time per question and difficulty shared across exercises (`orig:2736`, `orig:1056`, one settings field each) | matches |

**4a. Unpinning can fail to restore the earlier target (differs; bug in the rebuild).** While a root is pinned, only the **Type** button is enabled. Tapping it, even though it is already selected, clears the remembered target:

- `setup.js:235` `guessBeforePin = null;` runs on every `data-guess` tap.
- In the original, `orig:3110` `guessTarget = b.dataset.guess;` is followed by `normalizeChordSetup()`, which only records the target when it is not already `type` (`orig:3098`). So the memory survives.

Repro: guess = Both → pin root D → tap Type → set root back to Random. The original restores Both; the rebuild stays on Type. DESIGN.md says "Unpinning restores the earlier guess target", which supports the original. See fix list #2.

**4b. A pinned root no longer overwrites the saved method (differs; documented).** The original permanently changes the saved method: `orig:3104` `if (!pianoAllowed() && method === 'piano') method = 'buttons';`. So after unpinning, the piano does not come back, even though the comment at `orig:3094` says it should. The rebuild leaves `method` alone and derives the input through `game.js:126-128` `effectiveMethod`. DESIGN.md ("forces type-only … and therefore buttons. Unpinning restores the earlier guess target") is closer to the rebuild, and CLAUDE.md records the decision.

## 5. History

| Rule | Verdict |
| --- | --- |
| Keys `pitchTrainer.history.v1` and `pitchTrainer.settings.v1` (`orig:1883`, `orig:1977`, `storage.js:27-28`) | matches |
| Shape `{ answers, matches, plays }`; load rejects data without `answers` and `matches` arrays; a missing `plays` becomes `[]` (`orig:1997-1999`, `storage.js:219-223`) | matches |
| `answers` `{ k, t, g, ts }`, with `t` and `g` as strings, capped at 4,000 (`orig:2006-2008`, `storage.js:242-247`) | matches (verified types) |
| `matches`, all 14 fields with the same names and `null`s outside chords, capped at 500 (`orig:2190-2203`, `game.js:366-381`) | matches, except `method` (5a). Verified a full entry. |
| `plays` `{ ts, correct, plays ≥ 1, mode }`, capped at 4,000 (`orig:1433-1435`, `storage.js:250-255`) | matches |
| Chord buttons: `root` and/or `qual` for the halves asked (`orig:1665-1666`, `game.js:539-541`) | matches (verified) |
| Piano chord: always `root`, plus `qual` if the shape is known (`orig:1843-1844`, `game.js:617-619`) | matches (verified) |
| Timeout: no `answers` entry, one `plays` entry (`orig:2948-2950`, `game.js:671`, `game.js:423`) | matches (verified) |
| Replay knock-out: logs the match, no `plays` entry for that question (`orig:3277`, `game.js:396-399`) | matches |
| Import merges: answers dedupe on `ts\|k\|t\|g`, matches and plays on `ts`, then sort by `ts` (`orig:2323-2334`, `storage.js:310-331`) | matches. The rebuild also sorts `plays`, which the original did not. |
| Re-cap after import (`orig:2335-2336` caps answers only) | **differs; the rebuild follows DESIGN.md.** `storage.js:333-335` caps all three, which fixes the Known issue. Verified: 4,100 imported plays → 4,000. |
| Reset empties all three (`orig:2181-2187`, `storage.js:348-353`) | matches. The rebuild asks for confirmation inline (CLAUDE.md). |

**5a. `matches[].method` (differs, low impact).**

- Original `orig:2194` `mode, method, difficulty,` logs the saved Buttons/Piano setting, so an Intervals match can be logged as `"piano"`.
- Rebuild `game.js:373` `method: lastMethod,` with `game.js:416` `lastMethod = grade.method;` logs the input actually used for the last answer. That is always `"buttons"` for Intervals and for type-only chords.

DESIGN.md only says "method". Nothing reads this field today. The rebuild's value is more truthful. Neither side records Names vs Semitones for Intervals.

**5b. Import is stricter (differs, an addition).** The original pushes incoming entries as they are. The rebuild drops malformed ones and reports the count (`storage.js:282-297`): answers need a known `k`, a numeric `ts` and a non-null `t`/`g`; matches need a numeric `ts`, `points` and `acc` and a known `mode`; plays need `plays ≥ 1` and a known `mode`. A real old export passes these checks. DESIGN.md is silent.

**5c. Export file date (differs, cosmetic).** The original names the file from the UTC date, `orig:2309` `new Date().toISOString().slice(0,10)`. The rebuild uses the local date, `stats.js:431` `dateStamp(new Date())`. DESIGN.md says only "dated JSON"; CLAUDE.md asks for local.

## 6. Settings

| Rule | Verdict |
| --- | --- |
| Saved fields: the same 23 keys, `mode … arpeggio` (`orig:1890-1897`, `storage.js:80-111`) | matches. Verified the key list. |
| `intervals` accepted for `mode` and `learnMode` (original `orig:1912`, `orig:1915` lists only `notes`, `chords`; rebuild `storage.js:119`, `storage.js:154` uses `MODES`) | **differs; the rebuild follows DESIGN.md** (Known issue fixed). Verified it survives a save and reload. |
| Old `range` migrated to `registers` (`orig:1944-1950`, `storage.js:146-151`) | matches. Verified `'2'` → `[true, true, false]`. |
| `timeLimit` ∈ {0, 5, 10, 20}; `anchorMidi` 60–71; `ivlSel` needs 2+ on; `qualSel` and registers need 1+ on; `chordPlay` ∈ {block, arp} | matches |
| A pinned root forces `guessTarget: 'type'` (applied on load in the rebuild, `storage.js:142`; at setup time in the original, `orig:3097-3099`) | matches in effect |

**6a. `noteSel` minimum on load (differs, harmless).** Original `orig:1923` `saved.noteSel.some(Boolean)` (1+). Rebuild `storage.js:123` `boolArray(saved.noteSel, D.NOTES.length, 2, s.noteSel)` (2+). The setup UI never allows fewer than 2, so only a hand-edited save is affected. That save would reset to all 12. DESIGN.md's minimum of 2 supports the rebuild.

**6b. `refPitch` range on load (differs, harmless).** Original `orig:1935` `saved.refPitch >= 21 && saved.refPitch <= 108`. Rebuild `storage.js:126` `saved.refPitch >= D.REGISTER_LOW && … < D.REGISTER_LOW + 12 * D.REGISTER_COUNT` (C3–B5). The original menu only offered C3–B5 and reset anything else to None (`orig:3088`), so the effect is the same.

**6c. Corrupt JSON in storage (differs; worth a decision).**

- Original `orig:1898`, `orig:2001` `} catch (e) { storageOK = false; }`. Unparseable data turns saving off for the session, so the bad blob is never overwritten.
- Rebuild `storage.js:173`, `storage.js:227` `if (!(e instanceof SyntaxError)) storageOK = false;`. The app starts with an empty history and overwrites the corrupt blob on the first save.

DESIGN.md is silent. The rebuild keeps the app usable, but a corrupted history becomes unrecoverable as soon as one question is answered. See fix list #3.

## 7. Learn

| Rule | Verdict |
| --- | --- |
| Anchor on by default, C4, selectable C4–B4; changing it plays the anchor (`orig:2367`, `orig:2389-2396`, `orig:2664-2670`; `storage.js:105-106`, `learn.js:345-347`) | matches |
| Anchor plays first, then the note 0.62 s later; with the anchor off, or on the anchor itself, the note plays alone (`orig:2504-2510`, `learn.js:156-159`) | matches |
| Note-button octave defaults to C4 and follows the last tapped key (`orig:2432`, `orig:2496`, `learn.js:116`, `learn.js:153`) | matches |
| Intervals default m3 vs M3, root C4, melodic 0.55 s, ascending; a key tap sets the root; changing direction replays (`orig:2370-2372`, `orig:2564`, `learn.js:108-113`, `learn.js:34`) | matches |
| Chords default maj vs min, root C4; root buttons keep the octave; a key tap keeps the tapped octave; block or arpeggio 0.42 / 0.95 (`orig:2375`, `orig:2414-2422`, `orig:2543`, `learn.js:291-295`, `learn.js:179`) | matches |
| Ghost keys: 12 (Intervals) and 11 (Chords) above C3–B5 (`orig:2459-2465`, `learn.js:40`) | matches |
| Learn never writes history; saves only `learnMode`, `anchorOn`, `anchorMidi`, `cmpA`, `cmpB`, `arpeggio` | matches |
| "Practice this": Notes → Pitch with current settings; Intervals → the two intervals become the pool, with `asc` or `desc`; Chords → the two types become the pool (`orig:2717-2731`, `learn.js:369-391`) | matches mapping. See 7b. |

**7a. Anchor interval naming (differs; the rebuild follows DESIGN.md and CLAUDE.md).** The original folds every distance into one octave and always says "above":

- `orig:2498` `const semis = ((midi - anchorMidi) % 12 + 12) % 12;`
- `orig:2501` `intervalName(semis) + ' above ' + midiToName(anchorMidi)`

So A3 against C4 reads "major 6th above C4", and C5 reads "unison above C4". The rebuild uses the real distance: `learn.js:55` `var d = midi - anchorMidi;` and `learn.js:67` `name + (d > 0 ? ' above ' : ' below ') + …`. That gives "minor 3rd below C4" and "octave above C4". DESIGN.md asks for the interval *between them*, which the rebuild gives correctly.

**7b. "Practice this" lands on the match (differs; the rebuild follows DESIGN.md).** The original sets the tab but not `practiceView`:

- `orig:2728` `} else mode = 'notes';`
- `orig:2729` `tab = 'practice';`, then `applyTab(); startMatch();`

From a fresh session (`practiceView = 'menu'`) the player lands on the menu while a match starts out of sight. The rebuild goes straight to the game, or to setup when the settings cannot start a match: `app.js:186` `if (Game.setupProblem(Store.settings())) { showView('setup'); return; }`. The rebuild also refuses A = B for intervals (`learn.js:373`), where the original started a one-interval match. DESIGN.md ("A match starts immediately") supports the rebuild.

## 8. Stats

| Rule | Verdict |
| --- | --- |
| Recent = the last 100 answers of each kind (`orig:2023-2024`, `stats.js:53-67`) and the last 100 plays (`orig:2269`, `stats.js:112-115`) | matches |
| Faded under 4 attempts; weak at 4+ attempts and under 50% (exactly 50% is not weak) (`orig:2072-2073`, `stats.js:228-229`) | matches logic. See 8a for styling. |
| Bar colour: ≥ 80% good, ≥ 50% amber, else bad (`orig:2074-2076`, `stats.js:234`) | matches (theme tokens instead of `#c9922f`) |
| Trend: one exercise at a time; defaults to the last played; needs 2+ matches; shows the last 30, with best over all matches of that exercise (`orig:2229-2264`, `stats.js:260-290`) | matches |
| Last 8 matches (`orig:2288`, `stats.js:328`) | matches |
| Six biggest confusions across `note` and `root`, roots tagged "(root)" (`orig:2139-2145`, `stats.js:89-105`) | matches |
| Matrix: `note` only; green diagonal; red errors at `0.25 + 0.75 × v / peak`, with peak ≥ 1 (`orig:2089-2109`, `stats.js:166-178`, `stats.js:368-370`) | matches. The original uses `rgba(209,107,92, a)`; the rebuild uses `color-mix(var(--bad) a%, var(--bg))`, the same ramp. |
| Interval and type bars only once they have data (`orig:2150-2163`, `stats.js:381-387`) | matches |
| Per-mode replay list includes Intervals (`orig:2274` lists only `['notes','chords']`; `stats.js:303` uses `MODE_ORDER`) | **differs; the rebuild follows DESIGN.md** (Known issue fixed) |
| Empty state keeps Export, Import and Reset visible | differs, by decision (CLAUDE.md) |

**8a. What "faded" fades (differs, cosmetic).** In the original only the figure dims: `orig:245` `.bar-row.thin .bar-num { opacity: 0.5; }`. In the rebuild the whole row dims: `css/styles.css:590` `.bar-row.thin { opacity: 0.5; }`. DESIGN.md ("Bars with fewer than 4 attempts are shown faded") reads closer to the rebuild.

**8b. No note answers yet (differs, cosmetic).** The original always draws 12 empty bars and an empty matrix. The rebuild prints "No single-note answers yet." (`stats.js:325`) and hides the matrix (`stats.js:355-356`) when there are only chord or interval answers. DESIGN.md is silent.

**8c. A flat sparkline (differs, cosmetic).** In the original a flat series sits on the bottom edge (`orig:2210` `const span = hi - lo || 1;`). In the rebuild it runs through the middle (`stats.js:151` `span === 0 ? SPARK.h / 2 : …`).

## 9. Audio

| Rule | Verdict |
| --- | --- |
| Mute ramp 15 ms, release voices, 95 ms muted wait, 8 ms unmute (`orig:1274`, `orig:1279`, `orig:1284`, `audio.js:29-37`, `audio.js:309-319`) | matches |
| Rolled notes 1.9 s when a block follows, else 2.6 s; block at `(n − 1) × gap + pause` (`orig:1266-1267`, `audio.js:301-302`) | matches |
| A play token cancels stale playback (`orig:1262`, `orig:1284`, `audio.js:296`, `audio.js:307`, `audio.js:314`) | matches. `silenceAll` now cancels scheduled notes too (CLAUDE.md). |
| 20 Salamander samples, 0.06 s release, −8 dB, nearest-sample shift (`orig:1143-1170`, `audio.js:24-49`, `audio.js:202-224`) | matches. The `Tone.Sampler` → `ToneAudioBuffers` swap is documented. |
| 15 s timeout, Tone.js missing, or a sample error → additive synth with the same partials, hammer noise and 6 kHz low-pass (`orig:1151-1179`, `orig:1188-1223`; `audio.js:84-143`, `audio.js:228-282`) | matches |
| `silenceAll` 25 ms fade (`orig:1238-1246`, `audio.js:336-342`) | matches |
| Switching tabs silences everything (`orig:2634-2637`, `app.js:170`) | matches |

**9a. A timeout does not silence the question (missing).** The original cuts the sound at once:

- `orig:2940` `function timeOut() {`
- `orig:2942` `silenceAll();`

In the rebuild, `app.js:273` `showResult(match.timeout(usingPiano()))` leads to `app.js:529-552`, which only stops the timer. The sound is silenced only when the next question is drawn, 1.3 s later (`app.js:469` → `stopMatchActivity`). A long arpeggio can therefore keep ringing over the "Time — it was …" message. DESIGN.md is silent, so this follows the original. See fix list #1.

**9b. The synth path now waits 95 ms (differs; documented).** The original synth path stops voices and plays at once, with no mute and no wait (`orig:1291-1294`). The rebuild runs the shared mute → wait → unmute sequence for the synth too (`audio.js:309-319`), adding about 0.1 s of latency on the fallback. DESIGN.md describes the sequence without naming an engine, and CLAUDE.md records sharing it. The rebuild also ends synth voices at the note duration (2.6 / 1.9 s) instead of letting them decay naturally (about 3.3 s). At that point the fundamental is already below −60 dB, so the cut cannot be heard.

---

## In the original, not described in DESIGN.md

| Original behavior | Rebuild | Notes |
| --- | --- | --- |
| A timeout silences the question at once (`orig:2942`) | **missing** | §9a, fix list #1 |
| Leaving a match for Learn or Stats and coming back resumes it, with the score kept and a new question drawn (`orig:2638` `else applyLayout();` → `orig:3187` `nextRound();`) | Replaced. `app.js:169` `if (view === 'game') { stopMatchActivity(); match = null; }` abandons it. | Deliberate (CLAUDE.md: "leaving a match for another tab abandons it"). Leave as is unless players miss it. |
| The summary appears the moment the last answer is graded (`orig:1456-1457`) | Differs. `app.js:543` `timer = setTimeout(showSummary, res.delay);` shows the feedback for 1.1–1.9 s first. | Cosmetic. The rebuild's way lets the last answer's colours be seen. |
| The question timer starts after the 95 ms settle (`orig:3293` `await playPitches(…)` then `orig:3296`) | Differs. The timer starts on the tap (`app.js:569`), before the sound. | Negligible (~0.1 s) |
| The "Practice this" label changes per sub-mode: "Practice notes", "Practice these intervals", "Practice these chords" (`orig:2599`) | Differs. A fixed "Practice this" label plus an explanatory line (`learn.js:203-222`). | Cosmetic. The rebuild's line says more. |
| Feedback for a single type on the chord buttons ("Only major … you just need the root") (`orig:1603-1605`) | Present (`app.js:362-364`) | matches |
| A difficulty switch inside the game view (`orig:3252-3260` wires `#diffSeg`) | Not built | Dead code in the original: there is no `#diffSeg` element in its markup, so there is nothing to port. |

The rebuild also adds a few things the original lacked: a storage-blocked notice, import validation with a 10 MB limit, an inline reset confirmation, a low-time colour on the timer bar, and keys marked after a timeout. None of these conflict with DESIGN.md.

## DESIGN.md drift (doc-only, no code change)

- The audio section still says `Tone.Sampler`. The rebuild uses `Tone.ToneAudioBuffers` plus its own voices, for the reason CLAUDE.md gives.
- "Notes for Claude Code" still points at `pitch-trainer_1.html` and says to edit it rather than rewrite. Both are stale now that the rebuild exists.
- The Known-issues table can be marked resolved. All six are fixed: listeners are attached once by delegation, `intervals` loads, unknown shapes log the root only (a decision), interval replays are listed, `plays` is capped on import, and the leftover code was not carried over.

---

## Prioritized fix list

1. **Silence on timeout** (§9a). When `res.timedOut` is set (or inside the timeout path in `app.js:273`), call `PianoAudio.silenceAll()`, as the original did. A player can notice this.
2. **Keep the pre-pin guess target when Type is tapped while pinned** (§4a). In `setup.js:234-236`, only clear `guessBeforePin` when the root is random, or when the tapped target differs from the current one. This is what DESIGN.md asks for.
3. **Decide what happens to corrupt stored JSON** (§6c). Recommended: don't overwrite an unparseable `pitchTrainer.history.v1`. Either keep saving off for history in that session, as the original did, or copy the raw string to a backup key before the first save. Today one answered question destroys it.
4. **Record what `matches[].method` means** (§5a). Keep the rebuild's "input actually used". Add one line to DESIGN.md / CLAUDE.md so future readers don't treat `"buttons"` on old Intervals matches as a bug. Optionally log Names vs Semitones as well.
5. **Interval miss wording** (§1a). Drop `missSuffix` for intervals, or say "off by N semitones" with the real `|guess − answer|`. The capped distance is right for the penalty but wrong as a label ("off by a tritone" for m2 vs P8).
6. **Remove the Dev sound-check section.** `index.html:415` `<details class="dev">` and `js/soundcheck.js` still ship. CLAUDE.md says to delete them once the real UI exists, and it now does.
7. **Update DESIGN.md** for the drift listed above (Sampler, the stale notes for Claude Code, the resolved Known issues). Also write down the documented decisions it is silent on: abandoning a match when the tab changes, the anchor's above/below naming, and `previousKey` persisting across matches.
8. **Cosmetic, optional:** match the original's faded-number styling only if wanted (§8a; DESIGN.md slightly favours the rebuild), the flat-sparkline position (§8c), and the per-sub-mode "Practice this" label.
