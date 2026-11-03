# Bar-native chord sheet — design

**Date:** 2026-07-17
**Status:** approved, ready for an implementation plan

## Problem

The chord sheet does not read the way a musician expects a chord sheet to read.

Three causes, in the order a player notices them:

1. **The chord, not the bar, is the layout unit.** `chartLayout.ts::groupIntoLines` greedily
   fills each line to `beats_per_measure × MEASURES_PER_LINE` beats and breaks when the next
   chord would overflow. Because chords are arbitrary lengths, lines come out ragged and no
   line reliably sums to a whole number of bars. Bar lines are drawn per-cell in
   `Timeline.tsx` (`data-bar-start`, set when `(start_beat - measure_offset) % beats_per_measure
   ≈ 0`), so a bar line appears only where a chord's start *happens* to coincide with one. The
   result reads as arbitrary. A chord vamping for eight bars is one enormous cell.
2. **No borders.** A chord cell has a left hairline and nothing else — no top, no bottom, no
   right. Where a chord begins and ends is hard to see, and on a wrapped chart one row bleeds
   into the next.
3. **Half-beat false positives.** The seed snaps detected boundaries to the half-beat
   (`snap_half`). The engine is measurably more likely to emit a spurious half-beat than a real
   one, so charts are littered with 3.5- and 7.5-beat chords whose true length is 4 and 8 —
   which also guarantees the chords cannot line up with the bar lines.

## Scope

**In:** bar-unit layout, borders, and whole-beat + bar-line snapping at seed time.

**Out — deferred to its own spec/plan cycle:** *time-signature detection*. `beats_per_measure`
and `measure_offset` already exist on `ChordChart`, are already user-editable via
`TimeSignatureControl`, and default to `4`/`0`. This project consumes them; it does not detect
them. Detection is the riskiest, least-certain piece (see *Deferred: detection* below) and must
be measured against real recordings before it is trusted. Until it lands, a song in 3/4 needs a
trip to Advanced options — which is the status quo, not a regression.

**No schema change.** No new columns, no migration. Per `CLAUDE.md`, the data is disposable —
but nothing here even requires dropping the dev DB.

## Decisions

| Question | Decision |
|---|---|
| Split interval for a long chord | One cell per **bar** (lead-sheet convention) |
| Where the split lives | **Derived at render.** The DB keeps one segment |
| Snap direction | **Nearest bar line within tolerance, else nearest whole beat** |
| Bar-pull tolerance | **0.75 beats** — must be `< 1.0`; see *The snap* |
| Re-snap when the time signature changes | **No.** Bar lines redraw; chords never move |
| Manual edits | **Keep half-beat resolution.** `snap_half` is untouched |
| Border treatment | **Full bar boxes, dashed internal split** (layout A) |
| Horizontal edge token | **Decorative**, like `--line` — not WCAG-governed |
| Vertical rule width | **2px** against the 1px divider; the 3:1 width mandate is rewritten |

### Why "derived at render"

Storing one row per bar would make rendering trivial and everything else worse: 8× the rows;
practice mode would ask the same chord eight times; changing a chord would mean editing eight
rows; and the fact that beats 0–32 were ever *one* chord would be lost, requiring merge
semantics to recover. Deriving keeps `Analysis` truthful about what the engine heard, keeps
editing and resizing operating on real chord boundaries, and needs no schema change.

### Why the pull tolerance must be < 1.0

The rule is "if the raw boundary is within `t` of a bar line, take the bar line." In 4/4 with
bar lines at 0, 4, 8, the whole beats sit at distances **1, 2, 1** from the nearest bar line.
So `t = 1.0` **eats beats 2 and 4 of every bar**: `| C G Am F |` (one chord per beat) would
collapse to a single chord, and `| C / G / |` would survive only by luck.

`t < 1.0` yields the invariant that makes the rule safe:

> **A boundary already on a whole beat is never relocated.** Its distance to any
> non-coincident bar line is ≥ 1 > t.

`t = 0.75` is the default. It preserves every whole beat and still corrects the jitter the rule
exists for:

```
raw 3.4  -> 4    (0.6 from the bar line — pulled)
raw 7.6  -> 8    (0.4 — pulled)
raw 11.7 -> 12   (0.3 — pulled)
raw 6.3  -> 6    (nearest bar 2.3 away — no pull, nearest whole beat)
raw 6.5  -> 7    (1.5 away — no pull; round-half-up)
beat 3.0 -> 3.0  (exactly 1.0 away — NEVER pulled, by the invariant)
```

### Why the seed snaps but manual edits do not

The whole-beat rule corrects a **known engine bias**, so it applies where that bias lives: the
seed. A player dragging a boundary knows what they heard — chord changes on the half beat are
real, if less common than the engine claims. `snap_half`, `snapHalfBeat`, and the 0.5-beat
minimum stay exactly as they are on the edit path.

### Why the time signature never re-snaps

Changing `beats_per_measure` re-draws bar lines only. Re-snapping would move chords under the
user, silently overwrite manual edits, and compound — each change would snap already-snapped
data, so 4/4 → 3/4 → 4/4 would not round-trip. It is also unnecessary in the long run: once
detection lands it runs **during analysis, before the seed**, so the pull uses the real meter
and the problem disappears on its own.

## Architecture

### Frontend

**New: `frontend/src/chart/barLayout.ts`** — pure, no DOM, replaces `groupIntoLines`.

```ts
buildBars(segments, beatsPerMeasure, measureOffset): Bar[]

interface Bar      { index: number; startBeat: number; endBeat: number; fragments: Fragment[] }
interface Fragment { segmentId: string; startBeat: number; beats: number;
                     isChordStart: boolean; isChordEnd: boolean }
```

Bars span **beat 0 to the last segment's `end_beat`** — not to `totalBeats`. A chart ends where
its chords end; trailing audio with no detected chords does not render as empty bars. No
`totalBeats` parameter is needed, and none is passed.

A chord spanning 8 bars yields 8 fragments across 8 bars. A bar holding F and G yields one bar
with 2 fragments. `measure_offset > 0` yields a leading **pickup bar**; a recording ending
mid-bar yields a **partial final bar**, rendered as a real bar box whose fragments simply do
not fill it (no padding to a phantom full bar).

**`Timeline.tsx`** renders a *flat* list of bars — no line grouping in JS:

- One `<ul class="chart-bars">` as a single CSS grid,
  `grid-template-columns: repeat(var(--bars-per-line), 1fr)`, rows created by auto-flow.
- A bar is a flex row with **`min-width: 0`** — the property whose absence let a bar widen to
  fit its content and knocked the rows out of vertical alignment. Bar width must never be a
  function of content.
- A fragment is `flex: <beats>`, so a 3+1 split lands its divider three-quarters across.

`groupIntoLines` and `MEASURES_PER_LINE` are deleted. `.chart-line` and its
`role="presentation"` wrapper disappear — there are no line elements left to hide. Bars-per-line
becomes the CSS token `--bars-per-line`, so narrow screens reflow to 2 bars via a media query
rather than a JS breakpoint.

`chartLayout.ts` keeps `boundaryUpdates` and `redistributeLength` unchanged.

### The progress fill sweeps box to box

`.chord-progress` (Round 2 #2) answers one question: *how much of this chord is left?* Today the
chord is one cell and the fill sweeps across it. Once a vamping chord is eight boxes, a fill
pinned to the first box would finish eight bars early and stop answering that question at all.

So the fill lives on **whichever fragment is currently sounding**, sweeping each box in turn:

- fragments already past → `scaleX(1)`, no transition;
- fragments still ahead → `scaleX(0)`, no transition;
- the sounding fragment → handed to `paintChordFill` with **its own** start/end times.

`paintChordFill` **cannot** be reused unmodified for the first two cases. It clamps `currentTime`
into the window it is given, so a *future* fragment would paint `scaleX(0)` and then immediately
transition to full over its own duration — every unplayed box of a vamp would start filling at
once. Past and future fragments are therefore set explicitly. `chordProgress.ts` itself is
unchanged.

This needs a fragment's start/end **time**, not just its beats. **`beatGrid.ts` gains
`timeForBeat`** — the port of `app/audio/beatgrid.py::time_for_beat`, whose private `ensureGrid` /
`intervalAt` helpers already sit in that file. Per `CLAUDE.md`, beat↔time conversion lives in
exactly one place per side: it must **not** be interpolated inline from the segment's own
`start_time` / `end_time`, which would be a second, drifting implementation of the same math.

### Accessibility — the chord stays the unit

Naively, per-bar rendering would make a chord spanning 8 bars announce itself **8 times** and
consume 8 tab stops. The existing comment on `.chart-line` already settles the principle: a line
is *"a layout artefact… `role="presentation"` keeps it out of the accessibility tree."* Splitting
one chord into 8 boxes is the same kind of artefact — it is still one chord, and the label
already carries the position.

Therefore:

- The **first fragment** of a chord carries the `<button>`, `role="listitem"`, the `aria-label`
  (`"C, bar 3, beat 1, 4 beats, starts a bar"`), and the focus.
- **Continuation fragments** are `aria-hidden` and unfocusable, but remain clickable — clicking
  any box selects the chord.
- **Resize handles** appear only on `isChordStart` / `isChordEnd` fragments: the real chord
  boundaries.

**Screen-reader output and tab order are identical to today.** This is a hard requirement, not a
nice-to-have: it is what stops the redesign from being an accessibility regression.

### Backend

**`app/audio/beatgrid.py`** gains one function — beat math stays in its one home per side:

```python
def snap_chart_beat(beat, beats_per_measure, measure_offset, pull_beats=0.75) -> float:
    """An engine boundary -> a whole beat, preferring a bar line within `pull_beats`.

    `pull_beats` MUST be < 1.0 (see the spec): at 1.0 the pull eats beats 2 and 4 of
    every 4/4 bar. Ties round HALF UP — note that Python's built-in round() is banker's
    rounding and would give 6 for 6.5 but 8 for 7.5.
    """
```

`snap_half` and `whole_bpm` are untouched.

**`app/chart_seed.py`** calls `snap_chart_beat` instead of `snap_half`.
`build_chart_seed` takes `beats_per_measure` / `measure_offset` as parameters defaulting to
`4` / `0`, so the detection project passes real values later without reshaping the signature.

**The minimum-length rule is asymmetric between interior and final chords, and the asymmetry is
load-bearing.** Interior boundaries snap to whole beats, so the shortest interior chord is one
whole beat; anything less means two boundaries collapsed onto the same beat, which is a
zero-length artefact to drop. But the **final** chord clamps to `max_beat = total_beats(grid,
duration)`, which is *fractional* — the recording does not end on a bar line — so a genuine tail
chord can legitimately be shorter than a beat. A single interior threshold would silently delete
it: raise the floor to 1.0 for everyone and the last chord you played vanishes whenever the final
change lands inside the closing beat.

So the seed applies **a 1.0-beat floor to interior chords and a 0.5-beat floor to the chord that
reaches `max_beat`** (0.5 being the half-beat minimum used everywhere else in the system). In
practice, because the cursor always sits on a whole beat, a tail reaching `max_beat` is *always*
either ≤ 0 beats (its boundary snapped back onto the cursor — a zero-length artefact, dropped) or
≥ 0.5 beats (its boundary snapped up and clamped to the fractional `max_beat` — kept); the 0.5
floor is therefore defensive rather than a case a real recording produces. A kept tail's
`end_beat` is *not* a whole beat, and the last bar is genuinely partial, which is exactly what the
partial-final-bar rendering expects. **A chart's total length must never exceed the recording's
duration** — but it must not fall short of it by dropping a real closing chord either.

**Config:** `TABIT_CHART_BAR_PULL_BEATS` (default `0.75`) in `app/config.py`, documented in
`README.md`.

### Tokens (`frontend/src/index.css`)

Values are the base token composited over each theme's `--bg` at the stated alpha, then baked as
a flat hex. Opacity was the tuning instrument, not the shipped mechanism: an alpha multiplier
layered over these tokens would silently invalidate every documented ratio in the file.

| Token | Alpha | Width | Light | Dark | Governed |
|---|---|---|---|---|---|
| `--bar-line` (vertical) | 78% | 2px | `#998E80` — 3.06:1 bg / 3.21:1 surface | `#7F7768` — 4.03:1 bg / 3.67:1 surface | **Yes, 3:1** |
| `--bar-line-h` (horizontal) | 45% | 1px | `#C3BBB1` — 1.81:1 | `#544E45` — 2.17:1 | No — house floor 1.6 |
| `--line` (divider) | 100% | 1px dashed | `#C4B8A6` — 1.86:1 (unchanged) | `#4A443B` — 1.85:1 (unchanged) | No |

All four governed pairs clear 3:1 in both themes. Light-on-bg at 3.06:1 has **thin margin** over
the threshold — do not darken `--bg` or lighten `--bar-line` without re-running
`palette.test.ts`.

**`--bar-line-h` is decorative, not governed.** The *vertical* rule is the graphical object that
says "a bar starts here"; the horizontal edge only separates row from row, which is a card's-edge
job. At 1.81:1 it sits essentially on `--line`'s shipped 1.86:1, which the palette already
accepts as perceptible. This justification belongs in the CSS comment block, alongside the
existing `--line` note.

**The 3:1 width mandate at lines 243–246 is rewritten, not violated.** It was written when the
bar line was the *only* thing marking a bar. Three channels now distinguish a bar from a chord
change — width (2:1), colour (3.06:1 vs 1.86:1), and **the box itself**, an enclosed shape that
is not hue. "Never hue alone" still holds. The comment must state this reasoning; silently
shipping 2px against a comment demanding 3px is not acceptable.

## Rendering contract

```
| C ╱ ╱ ╱ ╱ | C ╱ ╱ ╱ ╱ | Am ╱ ╱ ╱ ╱ | F ╱ ╱ ¦ G ╱ ╱ |
| C ╱ ╱ ╱ ╱ | Em ╱ ╱ ╱ ╱| F ╱ ╱ ╱ ╱  | Dm ╱ ╱ ¦ G ╱ ╱ |
  ^solid 2px = bar                  ^dashed 1px = chord change within a bar
```

**Slash marks are unchanged: one per beat**, via the existing `beatSlashMarks(beats)`. The chord
name is *stacked above* the slash row rather than sitting inline on beat 1, so the row honestly
reads "this chord lasts four beats" — it is not the inline lead-sheet idiom where the symbol
replaces the first slash. `beatMath.ts` and `Timeline.test.tsx:168` are untouched. (The mockups
during design drew the inline convention, `C ╱ ╱ ╱`; that was mockup shorthand and is **not** what
ships.)

- Every bar is exactly `1 / --bars-per-line` of the row, regardless of content.
- Bar lines form a hard vertical grid down the page.
- Rows share a horizontal edge; the sheet reads as one continuous grid.
- Internal dividers land on beats, so they align across rows only when the beats do.

## Testing

Per `CLAUDE.md`, **every new test is watched failing first** — against the un-fixed code or with
the behavior reverted.

**`barLayout.test.ts`** (pure, no DOM): a chord vamping across many bars → one fragment per bar,
`isChordStart` only on the first; two chords in one bar → one bar, two fragments, widths
proportional to beats; `measure_offset > 0` → pickup bar; recording ending mid-bar → partial
final bar; a chart of zero segments → no bars.

**`test_beatgrid.py`**: the worked examples above; **the invariant** — for every whole beat in a
bar, `snap_chart_beat` returns it unchanged (this is the test that fails at `pull_beats = 1.0`,
and is the reason the constant is what it is); round-half-up at `6.5` *and* `7.5`, which is what
catches a naive `round()`; `measure_offset > 0` shifting the bar lines.

**`test_chart_seed.py`**: boundaries land on whole beats; a sub-beat chord is dropped, not
emitted at zero length; the final chord still clamps to `max_beat` and may be fractional.

**`beatGrid.test.ts`**: `timeForBeat` round-trips against `totalBeats` on a steady grid;
interpolates a half beat; extrapolates past the final onset and clamps to `duration`; falls back
to a BPM division on a grid with fewer than two onsets. Cross-check the same cases against
`tests/test_beatgrid.py::test_time_for_beat_*` — the two sides are ports of each other and must
not drift.

**`Timeline.test.tsx`**: a chord spanning N bars produces **exactly one** `listitem` and **one**
tab stop; clicking a continuation fragment selects the chord; resize handles exist only at real
chord boundaries; on a vamping chord, boxes before the playhead paint full, boxes after it paint
empty, and only the sounding box carries a transition.

**`palette.test.ts`**: picks up the new values automatically (it reads `index.css` as text, so it
cannot drift), plus a floor test for `--bar-line-h` mirroring `--line`'s ≥ 1.6.

## Definition of done

- `pytest` and `cd frontend && npm test` pass; `npm run build` type-checks.
- The `tabit-reviewer` subagent has reviewed the change and its findings are addressed.
- `TABIT_CHART_BAR_PULL_BEATS` is in `app/config.py` and `README.md`.
- Rebased on `main`, conflict-free. One PR.
- `docs/TODO.md` #6 — see below. Nothing else in `docs/TODO.md` is regressed.

### A note on `docs/TODO.md` #6

#6 asks for a chart that wraps, is left-justified, and carries "at least four beats per line, no
more than 16." Wrapping and left-justification are preserved. The beat cap is **satisfied for
every meter up to 4/4** (`--bars-per-line: 4` gives 8 beats in 2/4, 12 in 3/4, 16 in 4/4) and
**deliberately superseded above it** — a 7/4 chart renders 28 beats per line, because four bars
per line is the lead-sheet convention and a musician reading 7/4 still expects to count bars, not
beats. #6 was written when the chord was the layout unit and a "line" had no musical meaning;
once the bar is the unit, a beat cap is the wrong control. Narrow viewports are handled by
reflowing `--bars-per-line` to 2, not by capping beats.

## Deferred: detection

Its own spec/plan cycle. Recorded here so the option space is not re-litigated:

- **madmom** — the classic RNN downbeat tracker. Effectively unmaintained, pins old numpy
  against this repo's `numpy>=1.26`, does not build cleanly on 3.12. **Not recommended.**
- **beat_this** (ISMIR 2024) — the modern equivalent, pip-installable, torch-based. Would fit
  the existing `[ml]` extra, but the base app cannot depend on it (heavy deps stay lazy).
- **Onset-clustering heuristic** — no new dependency. Chord changes cluster on downbeats: score
  each hypothesis (numerator `N ∈ {3, 4}`, phase `φ ∈ [0, N)`) by how many detected chord onsets
  land on a beat `≡ φ (mod N)`, take the winner. Not circular — detect from *raw* onsets, then
  snap. Pure and unit-testable, and it optimizes for exactly the property this project wants.

Likely shape: the heuristic on the base install, `beat_this` as an optional upgrade under
`[ml]`. Detection must be **measured** before it is trusted — a heuristic that guesses 3/4 on a
4/4 song produces a chart worse than today's. Note the asymmetric-fallback rule in `CLAUDE.md`
when choosing where a missing dependency fails vs. degrades.
