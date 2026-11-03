# Bar-Native Chord Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the **bar** the chord sheet's layout unit — every bar an equal-width box with real borders, and every engine-detected chord boundary snapped to a whole beat that prefers a nearby bar line.

**Architecture:** The split into bars is **derived at render**, never stored — the DB keeps one segment for a chord that vamps eight bars. A new pure frontend module (`barLayout.ts`) turns segments + meter into bars; `Timeline.tsx` renders them into one CSS grid. On the backend, one new pure function in `beatgrid.py` snaps seed boundaries to whole beats. **No schema change, no migration.**

**Tech Stack:** Python 3.12 / FastAPI / SQLAlchemy / pytest. React 18 / TypeScript / Vite / Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-17-bar-native-chord-sheet-design.md`. Read it before Task 1.

## Global Constraints

Every task's requirements implicitly include this section.

- **`pull_beats` MUST be `< 1.0`.** Default **`0.75`**. At 1.0 the pull eats beats 2 and 4 of every 4/4 bar (whole beats sit 1, 2, 1 from the nearest bar line) and collapses `| C G Am F |` to one chord. This is not a tuning preference; it is a correctness bound.
- **Round half UP** (`6.5 -> 7`, `7.5 -> 8`). Python's built-in `round()` is banker's rounding and gives `6` for `6.5` but `8` for `7.5`. Never use bare `round()` for a beat boundary.
- **`snap_half` / `snapHalfBeat` / the 0.5-beat minimum are UNTOUCHED.** The whole-beat rule corrects an engine bias and applies only at the seed. Manual edits keep half-beat resolution.
- **No schema change. No migration.** Do not add columns; do not touch `app/migrations.py`.
- **Screen-reader output and tab order must be IDENTICAL to today.** A chord spanning N bars is **one** `listitem` and **one** tab stop.
- **Slash marks are one per beat** — `beatSlashMarks(beats)`, unchanged. Do not "fix" this to `beats - 1`.
- **Beat math lives in one place per side:** `app/audio/beatgrid.py` on the backend; `chart/beatMath.ts` + `chart/beatGrid.ts` on the frontend. Do not re-derive inline — in particular, do not interpolate a fragment's time from a segment's own `start_time`/`end_time`.
- **Token values are exact.** `--bar-line`: `#998E80` light / `#7F7768` dark. `--bar-line-h`: `#C3BBB1` light / `#544E45` dark. Light `--bar-line` is 3.06:1 — thin margin over the enforced 3.0. Do not "round" these.
- **Both themes must define the same token names** (`palette.test.ts` enforces it), and **no hex may appear outside the two token blocks** (also enforced).
- **Base install gains no dependency.** Time-signature detection is out of scope.
- **Every new test is watched failing first** (`CLAUDE.md`). A test you only reasoned about is not a test.
- Base branch is **`main`**. One PR. Rebase before opening it.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `app/audio/beatgrid.py` | **Modify.** Add `_round_half_up`, `snap_chart_beat`. | 1 |
| `tests/test_beatgrid.py` | **Modify.** Snap tests incl. the invariant. | 1 |
| `app/chart_seed.py` | **Modify.** Use `snap_chart_beat`; threshold `0.5 -> 1.0`. | 2 |
| `tests/test_chart_seed.py` | **Create.** Does not exist today — `build_chart_seed` has **zero** tests. | 2 |
| `app/config.py` | **Modify.** Add `chart_bar_pull_beats`. | 2 |
| `app/jobs.py` | **Modify.** Pass the setting at both call sites. | 2 |
| `README.md` | **Modify.** Document `TABIT_CHART_BAR_PULL_BEATS`. | 2 |
| `frontend/src/chart/barLayout.ts` | **Create.** Pure `buildBars`. | 3 |
| `frontend/src/chart/barLayout.test.ts` | **Create.** | 3 |
| `frontend/src/chart/beatGrid.ts` | **Modify.** Add `timeForBeat` (port of `time_for_beat`). | 4 |
| `frontend/src/chart/beatGrid.test.ts` | **Modify.** | 4 |
| `frontend/src/index.css` | **Modify.** Tokens + the chart's CSS. | 5, 6 |
| `frontend/src/theme/palette.test.ts` | **Modify.** `--bar-line-h` floor; fix a stale comment. | 5 |
| `frontend/src/chart/Timeline.tsx` | **Modify.** Render bars; a11y; sweep the fill. | 6 |
| `frontend/src/chart/Timeline.test.tsx` | **Modify.** | 6 |
| `frontend/src/chart/chartLayout.ts` | **Modify.** Delete `groupIntoLines` + `MEASURES_PER_LINE`. | 6 |
| `frontend/src/chart/chartLayout.test.ts` | **Modify.** Delete their tests. | 6 |
| `frontend/src/chart/chordProgress.ts` | **Unchanged.** Reused as-is; read the note in Task 6. | 6 |

---

### Task 1: `snap_chart_beat` — the whole-beat + bar-line snap

**Files:**
- Modify: `app/audio/beatgrid.py`
- Test: `tests/test_beatgrid.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `snap_chart_beat(beat: float, beats_per_measure: int, measure_offset: int = 0, pull_beats: float = 0.75) -> float` — Task 2 calls this.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_beatgrid.py`, and add `snap_chart_beat` to the existing import block at the top:

```python
# --- snap_chart_beat -----------------------------------------------------------------
# 4/4 with no pickup: bar lines at 0, 4, 8, 12.


@pytest.mark.parametrize(
    "raw, expected",
    [
        (3.4, 4.0),    # 0.6 from the bar line -> pulled
        (7.6, 8.0),    # 0.4 -> pulled
        (11.7, 12.0),  # 0.3 -> pulled
        (6.3, 6.0),    # nearest bar is 2.3 away -> no pull, nearest whole beat
        (6.5, 7.0),    # 1.5 from the nearest bar -> no pull; ties round UP
    ],
)
def test_snap_chart_beat_pulls_to_a_nearby_bar_line(raw, expected):
    assert snap_chart_beat(raw, 4, 0) == pytest.approx(expected)


@pytest.mark.parametrize("beat", [0, 1, 2, 3, 4, 5, 6, 7, 8])
def test_snap_chart_beat_never_relocates_a_whole_beat(beat):
    """THE invariant. A boundary already on a whole beat is never moved.

    This is the test that fails at pull_beats >= 1.0 — beats 1, 3, 5 and 7 sit exactly
    1.0 from a bar line, so a 1.0 tolerance swallows beats 2 and 4 of every bar and
    `| C G Am F |` collapses to a single chord. It is why the default is 0.75.
    """
    assert snap_chart_beat(float(beat), 4, 0) == pytest.approx(float(beat))


def test_snap_chart_beat_ties_round_half_up_at_both_parities():
    """Catches a naive round(): banker's gives 6 for 6.5 but 8 for 7.5."""
    assert snap_chart_beat(6.5, 4, 0) == pytest.approx(7.0)
    assert snap_chart_beat(7.5, 4, 0) == pytest.approx(8.0)


def test_snap_chart_beat_honours_the_measure_offset():
    # measure_offset 2 -> bar lines at 2, 6, 10.
    assert snap_chart_beat(1.8, 4, 2) == pytest.approx(2.0)   # pulled to the shifted bar line
    assert snap_chart_beat(4.4, 4, 2) == pytest.approx(4.0)   # 1.6 from a bar line -> nearest beat


def test_snap_chart_beat_handles_three_four():
    # 3/4: bar lines at 0, 3, 6. Beat 1 and 2 are 1.0 away -> preserved.
    assert snap_chart_beat(2.5, 3, 0) == pytest.approx(3.0)   # 0.5 -> pulled
    assert snap_chart_beat(1.0, 3, 0) == pytest.approx(1.0)   # invariant holds in 3/4 too
    assert snap_chart_beat(2.0, 3, 0) == pytest.approx(2.0)


def test_snap_chart_beat_never_returns_a_negative_beat():
    assert snap_chart_beat(0.1, 4, 0) == pytest.approx(0.0)


def test_snap_chart_beat_rejects_a_destructive_tolerance():
    with pytest.raises(ValueError, match="pull_beats"):
        snap_chart_beat(3.4, 4, 0, pull_beats=1.0)
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
pytest tests/test_beatgrid.py -k snap_chart_beat -v
```

Expected: **collection error** — `ImportError: cannot import name 'snap_chart_beat'`. That is a real failure; do not proceed until you have seen it.

- [ ] **Step 3: Implement**

In `app/audio/beatgrid.py`, add `import math` under `import bisect`, then add below `snap_half`:

```python
def _round_half_up(value: float) -> float:
    """Nearest integer, with .5 always going UP.

    Python's built-in round() is banker's rounding: round(6.5) == 6 but round(7.5) == 8.
    Where a chord boundary lands must not depend on the parity of the beat it happens to
    sit near, so this rule is spelled out rather than inherited.
    """
    return float(math.floor(value + 0.5))


def snap_chart_beat(
    beat: float,
    beats_per_measure: int,
    measure_offset: int = 0,
    pull_beats: float = 0.75,
) -> float:
    """An engine-detected boundary -> a whole beat, preferring a nearby bar line.

    Two corrections in one, both aimed at the same bias. The engine emits far more spurious
    half-beat boundaries than real ones, so a boundary is snapped to a whole beat. Chord
    changes also cluster on downbeats, so a boundary within `pull_beats` of a bar line takes
    the bar line rather than its nearest beat.

    `pull_beats` MUST be < 1.0. The whole beats of a 4/4 bar sit 1, 2 and 1 beats from the
    nearest bar line, so a tolerance of 1.0 swallows beats 2 and 4 of every bar — `| C G Am F |`
    would collapse into one chord. Below 1.0 the rule carries the invariant that makes it safe:
    **a boundary already ON a whole beat is never relocated**, because its distance to any
    non-coincident bar line is >= 1 > pull_beats.

    This is a SEED-time rule only. `snap_half` still serves manual edits: a player dragging a
    boundary knows what they heard, and chord changes on the half beat are real.
    """
    if not pull_beats < 1.0:
        raise ValueError(
            "pull_beats must be < 1.0: at 1.0 the bar-line pull swallows beats 2 and 4 of "
            "every 4/4 bar. See docs/superpowers/specs/2026-07-17-bar-native-chord-sheet-design.md"
        )
    if beats_per_measure < 1:
        raise ValueError("beats_per_measure must be >= 1")

    span = float(beats_per_measure)
    k = _round_half_up((beat - measure_offset) / span)
    bar = measure_offset + k * span
    if bar >= 0.0 and abs(beat - bar) <= pull_beats:
        return float(bar)
    return max(0.0, _round_half_up(beat))
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
pytest tests/test_beatgrid.py -v
```

Expected: PASS, including every pre-existing test in the file (`snap_half` must be untouched).

- [ ] **Step 5: Prove the invariant test earns its keep**

Temporarily change the default to `pull_beats: float = 1.0` and remove the `ValueError` guard, then:

```bash
pytest tests/test_beatgrid.py -k never_relocates -v
```

Expected: **FAIL for beats 1, 3, 5, 7.** This is the whole reason the constant is 0.75. Revert both edits and re-run to green.

- [ ] **Step 6: Commit**

```bash
git add app/audio/beatgrid.py tests/test_beatgrid.py
git commit -m "feat(beatgrid): snap_chart_beat — whole-beat snapping with a bar-line pull"
```

---

### Task 2: Wire the snap into the seed

**Files:**
- Modify: `app/chart_seed.py`, `app/config.py`, `app/jobs.py:79`, `app/jobs.py:128`, `README.md`
- Test: `tests/test_chart_seed.py` (**create** — `build_chart_seed` has no tests today)

**Interfaces:**
- Consumes: `snap_chart_beat(...)` from Task 1.
- Produces: `build_chart_seed(result, beats_per_measure=4, measure_offset=0, pull_beats=0.75) -> ChartSeed`. `ChartSeed` and `SeededSegment` are unchanged.

**Why the params, given detection is out of scope:** the seed always runs with `4`/`0` today. They exist as parameters so the detection project passes real values later without reshaping the signature. `chart_seed.py` stays pure — it does **not** import `get_settings`; `jobs.py` reads config and passes it.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_chart_seed.py`:

```python
import pytest

from app.audio.analyzer import AnalysisResult
from app.audio.segments import DetectedSegment
from app.chart_seed import build_chart_seed
from app.music_theory import Quality

# A steady 120 BPM grid: one beat every 0.5s, beat 0 at t=0. Beat b sits at t = b * 0.5.
BEATS = [i * 0.5 for i in range(33)]  # 0.0 .. 16.0s -> beats 0..32


def _result(segments, duration=16.0):
    return AnalysisResult(
        segments=segments,
        beat_times=BEATS,
        bpm=120.0,
        duration=duration,
        key_tonic_pc=0,
        key_mode="major",
        engine_version="test",
    )


def _seg(start_s, end_s, root_pc=0):
    return DetectedSegment(start_time=start_s, end_time=end_s, root_pc=root_pc, quality=Quality.MAJ)


def test_boundaries_land_on_whole_beats():
    # 1.75s -> beat 3.5. Nearest bar line (4) is 0.5 away -> pulled to 4.
    # 3.10s -> beat 6.2. Nearest bar line is 1.8 away -> nearest whole beat, 6.
    seed = build_chart_seed(_result([_seg(0.0, 1.75), _seg(1.75, 3.10, 7), _seg(3.10, 16.0, 5)]))
    ends = [s.end_beat for s in seed.segments]
    assert ends[0] == pytest.approx(4.0)
    assert ends[1] == pytest.approx(6.0)
    # Contiguous: each chord starts where the last one ended.
    assert [s.start_beat for s in seed.segments] == pytest.approx([0.0, 4.0, 6.0])


def test_a_whole_beat_boundary_survives_the_seed():
    """The invariant, end to end: beat 6 is a real mid-bar change and must not move."""
    seed = build_chart_seed(_result([_seg(0.0, 3.0), _seg(3.0, 16.0, 7)]))
    assert seed.segments[0].end_beat == pytest.approx(6.0)


def test_a_sub_beat_chord_is_dropped_not_emitted_at_zero_length():
    # 0.10s -> beat 0.2, which snaps to 0. A zero-length chord must not reach the chart.
    seed = build_chart_seed(_result([_seg(0.0, 0.10), _seg(0.10, 16.0, 7)]))
    assert all(s.end_beat - s.start_beat >= 1.0 for s in seed.segments)
    assert len(seed.segments) == 1


def test_the_final_chord_clamps_to_the_recording_and_may_be_fractional():
    """A chart's total length must NEVER exceed the recording's duration."""
    # duration 15.75s -> max_beat 31.5. The chord wants to run to beat 32.
    seed = build_chart_seed(_result([_seg(0.0, 16.0)], duration=15.75))
    assert seed.segments[-1].end_beat == pytest.approx(31.5)


def test_the_pull_tolerance_is_honoured():
    # 1.75s -> beat 3.5. With no pull, it snaps to the nearest whole beat (4 — ties round up),
    # which is the same answer here; use 3.4 -> beat 6.8 instead to separate the two rules.
    # 3.40s -> beat 6.8: pull 0.75 -> bar line 8 is 1.2 away -> no pull -> 7.
    seed = build_chart_seed(_result([_seg(0.0, 3.40), _seg(3.40, 16.0, 7)]))
    assert seed.segments[0].end_beat == pytest.approx(7.0)
```

- [ ] **Step 2: Run and watch them fail**

```bash
pytest tests/test_chart_seed.py -v
```

Expected: `test_boundaries_land_on_whole_beats` FAILS with `ends[0]` ≈ **3.5**, not 4.0 — the current `snap_half` keeps the half beat. That is the bug this task fixes; confirm you see 3.5 before continuing.

> If `AnalysisResult`'s constructor signature differs from `_result` above, fix the helper to match `app/audio/analyzer.py` — do not change the assertions.

- [ ] **Step 3: Add the setting**

In `app/config.py`, after `analysis_min_segment_seconds`:

```python
    # Seed-time chord-boundary snapping. A detected boundary within this many beats of a bar
    # line takes the bar line; otherwise it takes its nearest whole beat. MUST be < 1.0 — at
    # 1.0 the pull swallows beats 2 and 4 of every 4/4 bar (they sit exactly 1.0 from a bar
    # line) and a one-chord-per-beat bar collapses into a single chord.
    chart_bar_pull_beats: float = 0.75
```

- [ ] **Step 4: Implement the seed change**

In `app/chart_seed.py`, change the import from `snap_half` to `snap_chart_beat`:

```python
from app.audio.beatgrid import beat_for_time, ensure_grid, snap_chart_beat, total_beats
```

Replace the signature and the loop body:

```python
def build_chart_seed(
    result: AnalysisResult,
    beats_per_measure: int = 4,
    measure_offset: int = 0,
    pull_beats: float = 0.75,
) -> ChartSeed:
    """Lay the detected chords out contiguously on the beat grid, snapped to whole beats and
    clamped to the recording's decoded length.

    Boundaries are snapped by `snap_chart_beat`, not `snap_half`: the engine emits far more
    spurious half-beat changes than real ones, and a chord that cannot sit on a whole beat can
    never line up with a bar line. Manual edits still snap to the half beat — the bias being
    corrected here is the engine's, not the player's.

    `beats_per_measure` / `measure_offset` are parameters rather than constants so the
    time-signature detection project can pass real values without reshaping this signature.
    Today every caller uses the ChordChart defaults (4 / 0).
    """
    duration = result.duration
    grid = ensure_grid(result.beat_times, result.bpm, duration)
    max_beat = total_beats(grid, duration)

    tonic = tonic_for_pitch_class(result.key_tonic_pc, result.key_mode)
    prefer_flats = key_prefers_flats(tonic, result.key_mode)

    segments: list[SeededSegment] = []
    cursor = 0.0  # beats; chords are laid out contiguously from beat 0
    for segment in result.segments:
        end_beat = snap_chart_beat(
            beat_for_time(min(segment.end_time, duration), grid),
            beats_per_measure,
            measure_offset,
            pull_beats,
        )
        end_beat = min(end_beat, max_beat)
        # One whole beat is the shortest chord the snap can now express; two boundaries
        # snapping onto the same beat would otherwise emit a zero-length segment.
        if end_beat - cursor < 1.0:
            continue
        segments.append(
            SeededSegment(
                start_beat=cursor,
                end_beat=end_beat,
                chord_root=pitch_class_to_note(segment.root_pc, prefer_flats=prefer_flats),
                chord_quality=segment.quality.value,
            )
        )
        cursor = end_beat
```

The rest of the function is unchanged.

- [ ] **Step 5: Pass the setting from both call sites**

`app/jobs.py` line ~79:

```python
        recording.chart = _guest_chart(
            recording,
            build_chart_seed(result, pull_beats=get_settings().chart_bar_pull_beats),
        )
```

`app/jobs.py` line ~128:

```python
    seed = build_chart_seed(result, pull_beats=get_settings().chart_bar_pull_beats)
```

Leave the `ChordChart(...)` construction alone — it deliberately takes the model's `beats_per_measure` / `measure_offset` defaults.

- [ ] **Step 6: Run the tests and watch them pass**

```bash
pytest tests/test_chart_seed.py tests/test_beatgrid.py tests/test_jobs.py -v
```

Expected: PASS.

- [ ] **Step 7: Run the whole backend suite**

```bash
pytest
```

Expected: PASS. If a test elsewhere asserted a half-beat seed boundary, that is a **real** consequence of this change — update it and say so in the PR body.

- [ ] **Step 8: Document the env var**

In `README.md`, alongside the other `TABIT_ANALYSIS_*` entries:

```markdown
- `TABIT_CHART_BAR_PULL_BEATS` (default `0.75`) — when seeding a chart, a detected chord
  boundary within this many beats of a bar line snaps to the bar line; otherwise it snaps to
  its nearest whole beat. **Must be less than 1.0**: at 1.0 the pull swallows beats 2 and 4
  of every 4/4 bar. Manual edits are unaffected — they still snap to the half beat.
```

- [ ] **Step 9: Commit**

```bash
git add app/chart_seed.py app/config.py app/jobs.py tests/test_chart_seed.py README.md
git commit -m "feat(chart): seed chord boundaries onto whole beats with a bar-line pull"
```

---

### Task 3: `barLayout.ts` — segments + meter -> bars

**Files:**
- Create: `frontend/src/chart/barLayout.ts`, `frontend/src/chart/barLayout.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces — Task 6 imports all of these:
  ```ts
  interface Fragment { segmentId: string; startBeat: number; beats: number;
                       isChordStart: boolean; isChordEnd: boolean }
  interface Bar      { index: number; startBeat: number; endBeat: number; fragments: Fragment[] }
  function buildBars(segments: BeatSpan[], beatsPerMeasure: number, measureOffset: number): Bar[]
  // BeatSpan = { id: string; start_beat: number; end_beat: number }
  ```

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/chart/barLayout.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildBars } from "./barLayout";

const seg = (id: string, start_beat: number, end_beat: number) => ({ id, start_beat, end_beat });

describe("buildBars", () => {
  it("splits a vamping chord into one fragment per bar", () => {
    // The whole point: 8 bars of C is EIGHT cells, not one enormous one.
    const bars = buildBars([seg("s1", 0, 32)], 4, 0);
    expect(bars).toHaveLength(8);
    expect(bars.every((b) => b.fragments.length === 1)).toBe(true);
    expect(bars.every((b) => b.fragments[0].segmentId === "s1")).toBe(true);
    expect(bars.every((b) => b.fragments[0].beats === 4)).toBe(true);
  });

  it("marks only the first and last fragment of a chord as its boundaries", () => {
    // Resize handles hang off these. A vamp must NOT grow 8 pairs of handles.
    const bars = buildBars([seg("s1", 0, 32)], 4, 0);
    expect(bars.map((b) => b.fragments[0].isChordStart)).toEqual(
      [true, false, false, false, false, false, false, false],
    );
    expect(bars.map((b) => b.fragments[0].isChordEnd)).toEqual(
      [false, false, false, false, false, false, false, true],
    );
  });

  it("puts two chords sharing a bar in one bar, sized by their beats", () => {
    const bars = buildBars([seg("f", 0, 2), seg("g", 2, 4)], 4, 0);
    expect(bars).toHaveLength(1);
    expect(bars[0].fragments.map((f) => [f.segmentId, f.beats])).toEqual([["f", 2], ["g", 2]]);
    // Both are whole chords, so both ends are real boundaries.
    expect(bars[0].fragments.every((f) => f.isChordStart && f.isChordEnd)).toBe(true);
  });

  it("divides a bar by beats, not evenly — a 3+1 split is 3:1", () => {
    const bars = buildBars([seg("c", 0, 3), seg("g", 3, 4)], 4, 0);
    expect(bars[0].fragments.map((f) => f.beats)).toEqual([3, 1]);
  });

  it("gives a chord that straddles a bar line one fragment on each side", () => {
    const bars = buildBars([seg("c", 0, 6), seg("g", 6, 8)], 4, 0);
    expect(bars).toHaveLength(2);
    expect(bars[0].fragments.map((f) => [f.segmentId, f.beats])).toEqual([["c", 4]]);
    expect(bars[1].fragments.map((f) => [f.segmentId, f.beats])).toEqual([["c", 2], ["g", 2]]);
    expect(bars[0].fragments[0].isChordStart).toBe(true);
    expect(bars[0].fragments[0].isChordEnd).toBe(false);
    expect(bars[1].fragments[0].isChordStart).toBe(false);
    expect(bars[1].fragments[0].isChordEnd).toBe(true);
  });

  it("opens with a short pickup bar when the bar line is shifted", () => {
    // measure_offset 2 -> bar lines at 2, 6, 10. Beats 0-2 are a pickup.
    const bars = buildBars([seg("s1", 0, 10)], 4, 2);
    expect(bars.map((b) => [b.startBeat, b.endBeat])).toEqual([[0, 2], [2, 6], [6, 10]]);
  });

  it("ends with a partial bar when the recording stops mid-bar", () => {
    const bars = buildBars([seg("s1", 0, 6)], 4, 0);
    expect(bars.map((b) => [b.startBeat, b.endBeat])).toEqual([[0, 4], [4, 6]]);
    expect(bars[1].fragments[0].beats).toBe(2);
  });

  it("stops at the last chord, not at the end of the audio", () => {
    // Trailing audio with no detected chords must not render as empty bars.
    const bars = buildBars([seg("s1", 0, 4)], 4, 0);
    expect(bars).toHaveLength(1);
  });

  it("returns no bars for an empty chart", () => {
    expect(buildBars([], 4, 0)).toEqual([]);
  });

  it("handles 3/4", () => {
    const bars = buildBars([seg("s1", 0, 9)], 3, 0);
    expect(bars.map((b) => [b.startBeat, b.endBeat])).toEqual([[0, 3], [3, 6], [6, 9]]);
  });

  it("keeps a half-beat chord from a manual edit", () => {
    // The seed snaps to whole beats; a PLAYER may still cut a half. Layout must not lose it.
    const bars = buildBars([seg("c", 0, 3.5), seg("g", 3.5, 4)], 4, 0);
    expect(bars).toHaveLength(1);
    expect(bars[0].fragments.map((f) => f.beats)).toEqual([3.5, 0.5]);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
cd frontend && npx vitest run src/chart/barLayout.test.ts
```

Expected: FAIL — `Failed to resolve import "./barLayout"`.

- [ ] **Step 3: Implement**

Create `frontend/src/chart/barLayout.ts`:

```ts
/** Segments + meter -> bars. The chord sheet's layout unit is the BAR, not the chord.
 *
 * A chord that vamps for eight bars is ONE segment in the database and EIGHT fragments here:
 * the split is derived, never stored. That keeps the analysis truthful about what the engine
 * heard, keeps editing and resizing operating on real chord boundaries, and keeps a vamp from
 * asking the same practice question eight times.
 *
 * Pure and DOM-free on purpose — this is where the chart's geometry is decided, so it is the
 * thing that has to be cheap to test.
 */

interface BeatSpan {
  id: string;
  start_beat: number;
  end_beat: number;
}

export interface Fragment {
  segmentId: string;
  startBeat: number;
  beats: number;
  /** This fragment carries the chord's real start — where a resize handle belongs, and
   *  where the <button> and the screen-reader label go. */
  isChordStart: boolean;
  /** This fragment carries the chord's real end. */
  isChordEnd: boolean;
}

export interface Bar {
  index: number;
  startBeat: number;
  endBeat: number;
  fragments: Fragment[];
}

// Beats are half-beat-quantised at worst, so anything this small is float noise.
const EPS = 1e-6;

export function buildBars(
  segments: BeatSpan[],
  beatsPerMeasure: number,
  measureOffset: number,
): Bar[] {
  const ordered = [...segments].sort((a, b) => a.start_beat - b.start_beat);
  if (ordered.length === 0) return [];

  const span = Math.max(1, beatsPerMeasure);
  const offset = ((measureOffset % span) + span) % span;
  // A chart ends where its chords end — NOT at the recording's total_beats. Trailing audio
  // with no detected chords must not render as empty bars.
  const chartEnd = ordered[ordered.length - 1].end_beat;

  // Bar edges: beat 0, every bar line at offset + k*span, then the chart's end. With
  // offset > 0 the leading [0, offset) span becomes a short pickup bar. `offset + k * span`
  // is computed from k rather than accumulated, so a long chart cannot drift.
  const edges: number[] = [0];
  for (let k = 0; ; k += 1) {
    const edge = offset + k * span;
    if (edge >= chartEnd - EPS) break;
    if (edge > EPS) edges.push(edge);
  }
  edges.push(chartEnd);

  const bars: Bar[] = [];
  for (let i = 0; i < edges.length - 1; i += 1) {
    const startBeat = edges[i];
    const endBeat = edges[i + 1];
    if (endBeat - startBeat < EPS) continue;

    const fragments: Fragment[] = [];
    for (const s of ordered) {
      const from = Math.max(s.start_beat, startBeat);
      const to = Math.min(s.end_beat, endBeat);
      if (to - from < EPS) continue; // this chord does not sound in this bar
      fragments.push({
        segmentId: s.id,
        startBeat: from,
        beats: to - from,
        isChordStart: s.start_beat >= startBeat - EPS,
        isChordEnd: s.end_beat <= endBeat + EPS,
      });
    }
    bars.push({ index: bars.length, startBeat, endBeat, fragments });
  }
  return bars;
}
```

- [ ] **Step 4: Run and watch them pass**

```bash
cd frontend && npx vitest run src/chart/barLayout.test.ts
```

Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/chart/barLayout.ts frontend/src/chart/barLayout.test.ts
git commit -m "feat(chart): barLayout — derive bars and fragments from segments + meter"
```

---

### Task 4: `timeForBeat` — beat -> seconds on the frontend

**Files:**
- Modify: `frontend/src/chart/beatGrid.ts`, `frontend/src/chart/beatGrid.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `timeForBeat(beat: number, beatTimes: number[], bpm: number | null, duration: number): number` — Task 6 calls it to give each fragment its own start/end time for the progress sweep.

**Why this exists.** Task 6 sweeps the progress fill box-to-box across a vamping chord, so each fragment needs its start/end **time**, not just its beats. The frontend has no beat→time conversion today — `beatGrid.ts` exports only `totalBeats`, though its private `ensureGrid` / `intervalAt` helpers are exactly what this needs. `CLAUDE.md`: *"Beat↔time conversion lives in exactly one place per side."* Do **not** interpolate a fragment's time inline from the segment's `start_time`/`end_time` — that would be a second, drifting implementation of this math.

This is a **port of `app/audio/beatgrid.py::time_for_beat`**. Read that function first; the two sides must agree.

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/chart/beatGrid.test.ts` (add `timeForBeat` to the existing import):

```ts
describe("timeForBeat", () => {
  // A steady 120 BPM grid: one beat every 0.5s, beat 0 at t=0. Mirrors GRID in
  // tests/test_beatgrid.py — the two sides are ports of each other and must not drift.
  const GRID = [0, 0.5, 1.0, 1.5, 2.0];

  it("maps a beat on the grid to its onset", () => {
    expect(timeForBeat(0, GRID, 120, 2)).toBeCloseTo(0);
    expect(timeForBeat(2, GRID, 120, 2)).toBeCloseTo(1.0);
  });

  it("interpolates a half beat", () => {
    expect(timeForBeat(1.5, GRID, 120, 2)).toBeCloseTo(0.75);
  });

  it("extrapolates past the last onset at the final interval, and clamps to duration", () => {
    expect(timeForBeat(6, GRID, 120, 10)).toBeCloseTo(3.0);
    expect(timeForBeat(6, GRID, 120, 2.5)).toBeCloseTo(2.5);
  });

  it("clamps below zero", () => {
    expect(timeForBeat(-4, GRID, 120, 2)).toBeCloseTo(0);
  });

  it("falls back to a BPM division when the tracker found fewer than two onsets", () => {
    expect(timeForBeat(2, [], 120, 10)).toBeCloseTo(1.0);
  });

  it("inverts totalBeats", () => {
    const beats = totalBeats(GRID, 120, 1.75);
    expect(timeForBeat(beats, GRID, 120, 1.75)).toBeCloseTo(1.75);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
cd frontend && npx vitest run src/chart/beatGrid.test.ts
```

Expected: FAIL — `timeForBeat is not exported by ./beatGrid`.

- [ ] **Step 3: Implement**

In `frontend/src/chart/beatGrid.ts`, add below `totalBeats`:

```ts
/** Beat index -> seconds, clamped to [0, duration]. The inverse of totalBeats' mapping, and
 *  the port of app/audio/beatgrid.py::time_for_beat — keep the two in step.
 *
 *  Beat 0 is grid[0], which is not necessarily t=0, so positions below it extrapolate at the
 *  opening interval rather than collapsing to zero. */
export function timeForBeat(
  beat: number,
  beatTimes: number[],
  bpm: number | null,
  duration: number,
): number {
  const grid = ensureGrid(beatTimes, bpm, duration);
  const last = grid.length - 1;
  let seconds: number;
  if (beat <= 0) {
    seconds = grid[0] + beat * intervalAt(grid, 0);
  } else if (beat >= last) {
    seconds = grid[last] + (beat - last) * intervalAt(grid, last);
  } else {
    const i = Math.floor(beat);
    seconds = grid[i] + (beat - i) * intervalAt(grid, i);
  }
  return Math.max(0, Math.min(duration, seconds));
}
```

- [ ] **Step 4: Run and watch them pass**

```bash
cd frontend && npx vitest run src/chart/beatGrid.test.ts
```

Expected: PASS, including the file's pre-existing `totalBeats` tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/chart/beatGrid.ts frontend/src/chart/beatGrid.test.ts
git commit -m "feat(chart): port time_for_beat to the frontend beat grid"
```

---

### Task 5: Tokens — the bar box's colours

**Files:**
- Modify: `frontend/src/index.css` (token blocks, lines ~16–30 and ~39/55), `frontend/src/theme/palette.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: CSS custom properties `--bar-line` (revalued) and `--bar-line-h` (new), in both themes. Task 6 consumes them.

**Exact values — do not recompute or round.** These are the base token composited over each theme's `--bg` at the tuned alpha, then baked flat. Opacity was the tuning instrument, not the shipped mechanism: an alpha multiplier layered over these would silently invalidate every documented ratio in the file.

| Token | Light | Dark |
|---|---|---|
| `--bar-line` (78%) | `#998E80` — 3.06:1 bg / 3.21:1 surface | `#7F7768` — 4.03:1 bg / 3.67:1 surface |
| `--bar-line-h` (45%) | `#C3BBB1` — 1.81:1 | `#544E45` — 2.17:1 |

- [ ] **Step 1: Write the failing test**

In `frontend/src/theme/palette.test.ts`, add after the existing "keeps the decorative hairline perceptible" test:

```ts
  it("keeps the bar box's horizontal edge perceptible without governing it", () => {
    // --bar-line-h is the top/bottom edge of a bar box. It is NOT WCAG-governed, and that is
    // a deliberate call: the VERTICAL rule (--bar-line) is the graphical object that says "a
    // bar starts here", while the horizontal edge only separates one row of bars from the
    // next — a card's-edge job. Same reasoning, and the same self-imposed floor, as --line.
    expect(contrastRatio(tokens["--bar-line-h"], tokens["--bg"])).toBeGreaterThanOrEqual(1.6);
  });
```

- [ ] **Step 2: Run and watch it fail**

```bash
cd frontend && npx vitest run src/theme/palette.test.ts
```

Expected: FAIL — the new test errors on an undefined token, **and** `"defines every token the other theme defines"` still passes (neither theme has it yet). Both go green in step 4.

- [ ] **Step 3: Update the token documentation block**

In `frontend/src/index.css`, in the comment block at lines ~16–30, replace the `--bar-line` entry with:

```
     --bar-line        the measure rule on the chart — the VERTICAL edge of a bar box. A
                       graphical object that says "a bar starts here": 3:1, enforced, and
                       heavier than --line by colour AND width.
     --bar-line-h      the HORIZONTAL edge of a bar box (its top and bottom). NOT
                       WCAG-governed, for the same reason --line is not: it is not a
                       component boundary and it carries no meaning of its own — the
                       vertical rule is what says "a bar starts here"; this only keeps one
                       row of bars from bleeding into the next, which is a card's-edge job.
                       Kept perceptible at ~1.8:1, like --line.
```

- [ ] **Step 4: Set the values**

In the `:root, [data-theme="light"]` block, replace the `--bar-line` line and add `--bar-line-h` directly beneath it:

```css
  --bar-line: #998E80;        /* bar box, vertical            3.06:1 on bg, 3.21:1 on surface */
  --bar-line-h: #C3BBB1;      /* bar box, horizontal          1.81:1 — decorative, see above */
```

In the `[data-theme="dark"]` block:

```css
  --bar-line: #7F7768;        /* bar box, vertical            4.03:1 on bg, 3.67:1 on surface */
  --bar-line-h: #544E45;      /* bar box, horizontal          2.17:1 — decorative, see above */
```

> Light `--bar-line` at 3.06:1 has **thin margin** over the enforced 3.0. Do not darken `--bg` or lighten `--bar-line` without re-running this suite.

- [ ] **Step 5: Fix the now-stale width comment**

`palette.test.ts`, in `"makes the measure rule out-weigh the ordinary chord divider"`, the comment says `(3px vs 1px, in the CSS)`. Task 6 ships 2px. Replace that comment body with:

```ts
    // Two channels, not one: the bar line is heavier than --line by COLOUR (this test) and by
    // WIDTH (2px vs 1px, in the CSS). A user who cannot see the colour difference still sees
    // the weight difference. Hue is never the only channel — and since the bar became a boxed
    // grid there is a third: the box is an enclosed shape, not a hue.
```

- [ ] **Step 6: Run and watch them pass**

```bash
cd frontend && npx vitest run src/theme/palette.test.ts
```

Expected: PASS — including `--bar-line on --bg`/`--surface` at 3:1 in both themes, `bar > line`, the new `--bar-line-h` floor, `"defines every token the other theme defines"`, and `"has no hardcoded hex outside the token blocks"`.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/index.css frontend/src/theme/palette.test.ts
git commit -m "feat(theme): retune --bar-line and add --bar-line-h for the bar box"
```

---

### Task 6: Render the chart as bars

**Files:**
- Modify: `frontend/src/chart/Timeline.tsx`, `frontend/src/chart/Timeline.test.tsx`, `frontend/src/chart/chartLayout.ts`, `frontend/src/chart/chartLayout.test.ts`, `frontend/src/index.css`

**Interfaces:**
- Consumes: `buildBars`, `Bar`, `Fragment` (Task 3); `timeForBeat` (Task 4); `--bar-line`, `--bar-line-h` (Task 5).
- Produces: the rendered chart. `boundaryUpdates` and `redistributeLength` in `chartLayout.ts` are **unchanged** and still exported. `chordProgress.ts` is **unchanged**.

**The accessibility contract — this is the task's hardest requirement.** A chord spanning 8 bars renders 8 boxes but must remain **one** `listitem` and **one** tab stop. Your own code already argues the principle: the comment on `.chart-line` says a line is *"a layout artefact… role=presentation keeps it out of the accessibility tree."* Eight boxes for one chord is the same kind of artefact. So:

- the **first fragment** of a chord (`isChordStart`) is the `<button role="listitem">`, carries the `aria-label`, and takes the focus;
- **continuation fragments** are `aria-hidden`, not focusable, but still clickable;
- **resize handles** appear only on `isChordStart` / `isChordEnd` fragments.

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/chart/Timeline.test.tsx`:

```ts
describe("bar-native layout", () => {
  const VAMP = [{
    id: "s1", start_beat: 0, end_beat: 32, start_time: 0, end_time: 16,
    chord_root: "C", chord_quality: "maj", roman_numeral: "I",
  }];

  // The file's module-level GRID only spans 9 beats / 4s. A 32-beat vamp needs its own, or
  // timeForBeat clamps every fragment past beat 8 to t=4 and the sweep test is meaningless.
  // Still 120 BPM: beat b sits at t = b * 0.5.
  const VAMP_GRID: BeatGridInfo = {
    beatTimes: Array.from({ length: 33 }, (_, i) => i * 0.5), // beats 0..32 -> t 0..16
    bpm: 120,
    duration: 16,
    beatsPerMeasure: 4,
    measureOffset: 0,
  };

  const renderVamp = (props: Partial<React.ComponentProps<typeof Timeline>> = {}) =>
    renderTimeline({ segments: VAMP, duration: 16, grid: VAMP_GRID, ...props });

  it("splits a vamping chord into one box per bar", () => {
    renderVamp();
    expect(document.querySelectorAll(".chart-bar")).toHaveLength(8);
  });

  it("announces a vamping chord ONCE, not once per bar", () => {
    // A chord spanning 8 bars is still ONE chord. Eight boxes is a layout artefact — the same
    // kind the old .chart-line wrapper was hidden for. If this regresses, a screen-reader user
    // hears "C, bar 1... C, bar 2..." eight times for a chord that never changed.
    renderVamp();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("gives a vamping chord ONE tab stop, not eight", () => {
    renderVamp();
    expect(document.querySelectorAll("button[data-segment-id]")).toHaveLength(1);
  });

  it("selects the chord when a continuation box is clicked", async () => {
    const onSelect = vi.fn();
    renderVamp({ onSelect });
    // The 4th bar holds a continuation fragment — no button, but it must still respond.
    const boxes = document.querySelectorAll<HTMLElement>(".chart-bar .chord-cell");
    await userEvent.click(boxes[3]);
    expect(onSelect).toHaveBeenCalledWith("s1");
  });

  it("gives a vamping chord ONE pair of resize handles, at its real boundaries", () => {
    // 8 bars must not grow 8 pairs of handles — the 7 interior bar lines are not chord changes.
    renderVamp({ onResizeCommit: () => {} });
    expect(document.querySelectorAll(".chord-cell__resize--left")).toHaveLength(1);
    expect(document.querySelectorAll(".chord-cell__resize--right")).toHaveLength(1);
  });

  it("sweeps the progress fill box to box across a vamping chord", () => {
    // .chord-progress answers ONE question: how much of this chord is left? Pinned to the
    // first box, an 8-bar vamp's fill would finish 8 bars early and answer nothing. Boxes
    // behind the playhead are full, boxes ahead are empty, and only the sounding box moves.
    //
    // VAMP_GRID is 120bpm: beat b sits at t = b*0.5, so bar 3 (beats 8-12) spans t=4..6.
    // At t=5 we are halfway through bar 3. Paused, so the sounding box snaps rather than
    // transitioning — which is what makes the fraction assertable.
    renderVamp({ currentTime: 5 });
    const fills = document.querySelectorAll<HTMLElement>(".chord-progress");
    expect(fills).toHaveLength(8); // one per box, not one for the chord
    expect(fills[0].style.transform).toBe("scaleX(1)"); // bar 1: played
    expect(fills[1].style.transform).toBe("scaleX(1)"); // bar 2: played
    expect(fills[3].style.transform).toBe("scaleX(0)"); // bar 4: not yet
    expect(fills[7].style.transform).toBe("scaleX(0)"); // bar 8: not yet
    // Paused, so the sounding box snaps to its true fraction rather than transitioning.
    expect(fills[2].style.transform).toBe("scaleX(0.5)"); // bar 3: halfway
  });

  it("sizes a fragment by its beats — the width IS the rhythm", () => {
    // The ratio must sit on the fragment, which is the flex child of .chart-bar. If it drifts
    // onto a descendant, the fragment falls back to `flex: 0 1 auto`, sizes to its content, and
    // the chart silently stops showing rhythm. jsdom does no layout, so this test is the only
    // thing standing between that regression and production: it names the exact element.
    const segs = [
      { ...BASE, id: "f", start_beat: 0, end_beat: 3, start_time: 0, end_time: 1.5 },
      { ...BASE, id: "g", start_beat: 3, end_beat: 4, start_time: 1.5, end_time: 2 },
    ];
    renderTimeline({ segments: segs, duration: 2 });
    const cellFor = (id: string) =>
      document.querySelector<HTMLElement>(`.chart-bar [data-segment-id="${id}"]`)!;
    // jsdom's CSSOM normalises the flex shorthand's zero basis to "0px".
    expect(cellFor("f").style.flex).toBe("3 1 0px");
    expect(cellFor("g").style.flex).toBe("1 1 0px");
    expect(cellFor("f").parentElement).toHaveClass("chart-bar");
  });
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
cd frontend && npx vitest run src/chart/Timeline.test.tsx -t "bar-native"
```

Expected: FAIL — `.chart-bar` matches nothing (0 !== 8), and the vamp announces 8 listitems.

- [ ] **Step 3: Rewrite Timeline's render**

In `frontend/src/chart/Timeline.tsx`, replace the `groupIntoLines` import with `buildBars`:

```tsx
import { boundaryUpdates, type SegmentUpdate } from "./chartLayout";
import { buildBars } from "./barLayout";
import { timeForBeat } from "./beatGrid";
```

Replace the `beatsPerLine` / `lines` lines with:

```tsx
  const bars = useMemo(
    () => buildBars(ordered, beatsPerMeasure, measureOffset),
    [ordered, beatsPerMeasure, measureOffset],
  );
  const segmentById = useMemo(() => new Map(ordered.map((s) => [s.id, s])), [ordered]);
```

Now replace the single-fill `fillRef` + `useEffect` block with a per-box sweep. Delete the old
`const fillRef = useRef<HTMLSpanElement | null>(null);` and the `useEffect` beneath it, and put
this in their place:

```tsx
  // ONE FILL PER BOX of the active chord. A chord vamping across eight bars is eight boxes, and
  // .chord-progress answers exactly one question — how much of this chord is left? A fill pinned
  // to the first box would finish eight bars early and answer nothing.
  const fillRefs = useRef(new Map<string, HTMLSpanElement>());

  // Each box's own start/end time. Times come from timeForBeat — NOT from interpolating the
  // segment's own start_time/end_time, which would be a second implementation of beat<->time
  // that drifts against the grid (CLAUDE.md: one home per side).
  const activeFills = useMemo(() => {
    const out = new Map<string, { startTime: number; endTime: number }>();
    if (!activeId) return out;
    for (const bar of bars) {
      for (const f of bar.fragments) {
        if (f.segmentId !== activeId) continue;
        out.set(`${f.segmentId}-${bar.index}`, {
          startTime: timeForBeat(f.startBeat, grid.beatTimes, grid.bpm, grid.duration),
          endTime: timeForBeat(f.startBeat + f.beats, grid.beatTimes, grid.bpm, grid.duration),
        });
      }
    }
    return out;
  }, [activeId, bars, grid]);

  useEffect(() => {
    for (const [key, { startTime, endTime }] of activeFills) {
      const el = fillRefs.current.get(key);
      if (!el) continue;
      if (currentTime >= endTime) {
        el.style.transition = "none";
        el.style.transform = "scaleX(1)";   // already played
      } else if (currentTime < startTime) {
        el.style.transition = "none";
        el.style.transform = "scaleX(0)";   // not yet
      } else {
        // paintChordFill CLAMPS currentTime into the window it is handed, so it may only ever
        // be given the box that is actually sounding. Hand it a future box and it paints
        // scaleX(0) and then transitions to full over that box's own duration — the entire
        // vamp would start filling at once.
        paintChordFill(el, { startTime, endTime, currentTime, playing, rate });
      }
    }
  }, [activeFills, currentTime, playing, rate]);
```

Replace the whole `return (...)` block with:

```tsx
  return (
    <ul className="chart-bars" aria-label="Chord chart">
      {bars.map((bar) => (
        // A BAR is a real musical object, but it is not a list entry — the CHORDS are the
        // list. A chord spanning eight bars is one chord in eight boxes, and role="presentation"
        // is what keeps a screen-reader user from being told about the seven splits that a
        // different time signature would move.
        <li key={bar.index} className="chart-bar" role="presentation">
          {bar.fragments.map((f) => {
            const s = segmentById.get(f.segmentId)!;
            const i = indexById.get(s.id)!;
            const selected = s.id === selectedId;
            const isActive = s.id === activeId;
            const masked = maskedIds.has(s.id);
            const chordBeats = Math.max(0.5, s.end_beat - s.start_beat);

            const label = [
              masked ? "Hidden chord" : chordLabel(s.chord_root, s.chord_quality),
              formatMusicalPosition(barBeatAt(grid, s.start_time)),
              `${chordBeats} ${chordBeats === 1 ? "beat" : "beats"}`,
            ].join(", ");

            const body = (
              <>
                <strong>{masked ? "?" : chordLabel(s.chord_root, s.chord_quality)}</strong>
                <span className="muted slash-marks">{beatSlashMarks(f.beats)}</span>
                <span className="muted">{masked ? "" : s.roman_numeral}</span>
                {/* Every box of the active chord gets a fill — the effect above decides which
                    are full, which are empty, and which is sweeping. */}
                {isActive && (
                  <span
                    ref={(el) => {
                      const key = `${s.id}-${bar.index}`;
                      if (el) fillRefs.current.set(key, el);
                      else fillRefs.current.delete(key);
                    }}
                    aria-hidden
                    className="chord-progress"
                    style={{ transform: "scaleX(0)" }}
                  />
                )}
              </>
            );

            const common = {
              className: "chord-cell",
              "data-segment-id": s.id,
              "data-selected": selected ? "true" : undefined,
              "data-playing": isActive ? "true" : undefined,
              "data-masked": masked ? "true" : undefined,
              "data-revealed": revealed.has(s.id) ? "true" : undefined,
              // Runtime geometry ONLY: the fragment's width IS its beat count within this bar.
              // It must sit here — this element is the flex child of .chart-bar.
              style: { flex: `${f.beats} 1 0` },
            } as const;

            // A CONTINUATION box: the same chord, still sounding, in a later bar. It is
            // aria-hidden and unfocusable so the chord is announced once and takes one tab
            // stop — but it stays clickable, because a player aiming at any box of a vamp
            // means "this chord".
            if (!f.isChordStart) {
              return (
                <span key={`${s.id}-${bar.index}`} {...common} aria-hidden
                      onClick={() => { onSelect(s.id); onSeek?.(s.start_time); }}>
                  {body}
                </span>
              );
            }

            return (
              <button key={`${s.id}-${bar.index}`} {...common} type="button" role="listitem"
                aria-pressed={selected} aria-label={label}
                onClick={() => {
                  if (suppressClick.current) { suppressClick.current = false; return; }
                  onSelect(s.id);
                  onSeek?.(s.start_time);
                }}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" && e.key !== " ") return;
                  e.preventDefault(); // Space scrolls the page otherwise
                  onSelect(s.id);
                  onSeek?.(s.start_time);
                }}
              >
                {onResizeCommit && (
                  <span className="chord-cell__resize chord-cell__resize--left"
                    aria-label={`Resize start of ${chordLabel(s.chord_root, s.chord_quality)}`}
                    draggable={false}
                    onPointerDown={(e) => startResize(i, "left", e)}
                    onClick={(e) => e.stopPropagation()} />
                )}
                {body}
                {onResizeCommit && f.isChordEnd && (
                  <span className="chord-cell__resize chord-cell__resize--right"
                    aria-label={`Resize end of ${chordLabel(s.chord_root, s.chord_quality)}`}
                    draggable={false}
                    onPointerDown={(e) => startResize(i, "right", e)}
                    onClick={(e) => e.stopPropagation()} />
                )}
              </button>
            );
          })}
        </li>
      ))}
    </ul>
  );
```

> The `, starts a bar` suffix and the `onMeasure` calculation are **deleted**: every bar now has a drawn box, and the first fragment of a chord that begins a bar is already at a bar's left edge. The label keeps `what, where, how long` — `where` (`"bar 3, beat 1"`) already carries the position.
>
> A chord whose start is mid-bar and whose end is mid-a-later-bar has `isChordEnd` on its last fragment only, which is why the right handle is gated on it.

- [ ] **Step 4: Write the CSS**

In `frontend/src/index.css`, add to the `:root` geometry block beside `--chord-cell-min`:

```css
  /* How many bars sit on one line of the sheet. Four is the lead-sheet convention. This is a
     TOKEN, not a JS constant, so a narrow viewport reflows with a media query instead of a
     breakpoint in the render path. */
  --bars-per-line: 4;
```

And after the `[data-theme="dark"]` `--shadow-panel` block:

```css
@media (max-width: 600px) {
  :root { --bars-per-line: 2; }
}
```

Replace the `/* ---- Chord chart ---- */` header comment and the `.chord-cell` block through the `[data-bar-start]` / `[data-selected]` rules with:

```css
/* ---- Chord chart ----------------------------------------------------------------------
   The sheet is a GRID OF BARS, not a row of chords. Every bar is exactly one track wide
   whatever it holds, so the bar lines form a hard vertical rule down the page — that
   regularity is the thing that makes a chord grid scannable at playing speed.

   A chord that vamps for eight bars is ONE segment (see barLayout.ts) rendered as eight
   boxes. Only the first box is a <button>; the rest are aria-hidden. */
.chart-bars {
  display: grid;
  /* minmax() rather than a bare 1fr: a bare 1fr is minmax(auto, 1fr), whose auto floor lets
     a bar with four chords in it push its track wider than its neighbours — which knocks the
     bar lines out of alignment between rows. The floor is the token, never the content. */
  grid-template-columns: repeat(var(--bars-per-line), minmax(var(--chord-cell-min), 1fr));
  list-style: none;
  margin: 0;
  padding: 0;
  /* Closes the right-hand end of every row: the grid spans the full width, so its right edge
     IS each row's final bar line. */
  border-right: 2px solid var(--bar-line);
  border-bottom: 1px solid var(--bar-line-h);
}

.chart-bar {
  display: flex;
  min-width: 0;     /* never widen to fit content — see the minmax() note above */
  overflow: hidden;
  border-left: 2px solid var(--bar-line);
  /* Top only; the grid carries the last row's bottom edge. Otherwise adjacent rows would
     stack two 1px edges into a 2px seam. */
  border-top: 1px solid var(--bar-line-h);
}

/* Chord cells are real <button>s (Timeline.tsx) so a keyboard user can Tab to one and press
   Enter/Space to open the segment editor — that focusability is what makes cutting
   drag-to-resize safe. A continuation box is a <span> with the same class: same look, no
   focus, no announcement. */
.chord-cell {
  position: relative;
  min-width: 0;
  height: 64px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  font-family: var(--font-chart);
  font-variant-numeric: tabular-nums;
  background: transparent;
  border: 0;
  border-radius: 0;
  padding: var(--space-2);
  text-align: center;
  color: var(--text);
  transition: transform 120ms ease;   /* the current-chord lift; reduced-motion resets it below */
}

/* The divider between two chords sharing a bar. Lighter than the bar line by BOTH colour and
   width, and dashed as a third channel: solid means "bar", dashed means "chord". */
.chord-cell + .chord-cell { border-left: 1px dashed var(--line); }

.chord-cell[data-selected="true"] { outline: 2px solid var(--accent); outline-offset: -2px; }
```

Leave `[data-playing]`, `[data-masked]`, `[data-revealed]`, `.chord-progress`, `.chord-cell__resize` and the `prefers-reduced-motion` block as they are. **Delete** the `.chord-cell[data-bar-start="true"]` rule and any `.chart-lines` / `.chart-line` / `.chord-cell__item` rules — search for them:

```bash
cd frontend && grep -rn "chart-lines\|chart-line\b\|chord-cell__item\|data-bar-start" src/
```

- [ ] **Step 5: Delete the dead layout code**

`frontend/src/chart/chartLayout.ts`: delete **only** `MEASURES_PER_LINE` and `groupIntoLines`. Keep everything else — `boundaryUpdates`, `redistributeLength`, `SegmentUpdate`, the `BeatSpan` interface, and the `snapHalfBeat` import (`redistributeLength` still uses it, and manual edits still snap to the half beat).

`frontend/src/chart/chartLayout.test.ts`: delete the whole `describe("groupIntoLines (beat-aware)")` block. The bar-splitting it used to guard is now `barLayout.test.ts`'s job.

- [ ] **Step 6: Run the frontend suite**

```bash
cd frontend && npm test
```

Expected: PASS. Two pre-existing tests are expected to need updating, and both are **real** consequences:
- `"sizes each cell by its beat count"` in `Timeline.test.tsx` asserts `.chord-cell__item` and `parentElement` is `.chart-line` — both are gone. Delete it; the new `"sizes a fragment by its beats"` replaces it and guards the same regression.
- Anything importing `groupIntoLines` or `MEASURES_PER_LINE`.

`"renders slash marks for a 4-beat chord"` must **still pass untouched** — a 4-beat chord in 4/4 is exactly one bar, so it is one fragment of 4 beats and still renders `beatSlashMarks(4)`. If you had to change it, you changed the slash rule; revert that.

- [ ] **Step 7: Type-check**

```bash
cd frontend && npm run build
```

Expected: clean `tsc -b`, assets emitted.

- [ ] **Step 8: See it in the real app**

```bash
uvicorn app.main:app --reload    # terminal 1
cd frontend && npm run dev       # terminal 2
```

Upload a recording and confirm by eye:
- bar lines form an unbroken vertical grid down the page, and rows do not bleed into each other;
- a vamping chord shows one box per bar; a bar holding two chords shows a dashed divider at the beat, not the midpoint;
- **press play on a chord that lasts several bars and watch the fill sweep box to box** — boxes behind the playhead full, boxes ahead empty, one box moving. If the whole chord fills at once, `paintChordFill` is being handed a box that is not sounding;
- narrow the window past 600px and confirm the sheet reflows to 2 bars per line;
- Tab through the chart — a vamp takes **one** tab stop.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/chart/Timeline.tsx frontend/src/chart/Timeline.test.tsx \
        frontend/src/chart/chartLayout.ts frontend/src/chart/chartLayout.test.ts \
        frontend/src/index.css
git commit -m "feat(chart): render the sheet as a grid of bars"
```

---

### Task 7: Review and ship

- [ ] **Step 1: Full suites, both sides**

```bash
pytest
cd frontend && npm test && npm run build
```

Expected: all green.

- [ ] **Step 2: Dispatch the reviewer**

Dispatch the **`tabit-reviewer`** subagent over the full diff (`CLAUDE.md` requires it for any non-trivial change). Point it explicitly at:
- the `pull_beats < 1.0` bound and whether the invariant test actually fails at 1.0;
- whether a vamping chord really produces one `listitem` and one tab stop;
- whether the progress sweep hands `paintChordFill` only the sounding box, and whether `timeForBeat` agrees with `app/audio/beatgrid.py::time_for_beat`;
- whether `tests/test_chart_seed.py` — a brand-new file over previously untested code — actually fails against the old `snap_half` seed;
- whether any new test **could not fail**.

Act on what it finds.

- [ ] **Step 3: Rebase**

```bash
git fetch origin && git rebase origin/main
```

Resolve any conflicts and say so in the PR body.

- [ ] **Step 4: Open the PR against `main`**

Body must state:
- Charts seeded before this change keep their half-beat boundaries — **re-analysis** (which overwrites manual edits) is what re-seeds them onto whole beats. No migration; no DB drop needed.
- `TABIT_CHART_BAR_PULL_BEATS` is new, defaults to `0.75`, and must be `< 1.0`.
- Time-signature detection is **out of scope** and deferred to its own spec.
- `docs/TODO.md` #6's "no more than 16 beats per line" is deliberately superseded above 4/4 — see the spec.
