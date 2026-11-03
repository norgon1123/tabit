"""Pure beat<->time conversion over a detected beat-onset grid.

A *grid* is an ascending list of beat-onset times in seconds; index i is beat i.
Positions between or beyond onsets are linearly interpolated / extrapolated using
the surrounding (or final) inter-beat interval. All times are in original-audio
seconds; callers shift detected onsets to that frame before building the grid.
"""

from __future__ import annotations

import bisect
import math

_DEFAULT_BPM = 120.0


def snap_half(beat: float) -> float:
    """Round a beat position to the nearest half-beat (eighth)."""
    return round(beat * 2.0) / 2.0


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


def whole_bpm(bpm: float | None) -> int | None:
    """A tempo as a whole number of beats per minute — the only form we store or show.

    BPM is a number the player reads off a chart and counts in; 143.6 is a precision no
    one can act on. Nothing downstream needs the fraction either: the beat grid rides on
    the detected onset times in `beat_times`, not on this number, so rounding it costs no
    timing accuracy. Applied on the way in (detection), on the way out (legacy rows that
    still hold a fractional tempo) and to anything a client PATCHes.
    """
    if bpm is None:
        return None
    rounded = round(bpm)
    return rounded if rounded > 0 else None


def ensure_grid(beat_times: list[float], bpm: float | None, duration: float) -> list[float]:
    """Return a usable grid (>= 2 ascending entries) covering the audio from t=0.

    When detection produced fewer than two onsets, synthesize a uniform grid from
    `bpm` (falling back to 120 BPM) anchored at t=0 and spanning past `duration`.
    Otherwise keep the detected onsets and extend them back to the start of the
    recording (see `_backfill_head`).
    """
    clean = sorted(float(t) for t in beat_times)
    if len(clean) >= 2:
        return _backfill_head(clean)
    tempo = bpm if bpm and bpm > 0 else _DEFAULT_BPM
    interval = 60.0 / tempo
    span = max(duration, interval * 2)
    n = int(span / interval) + 2
    return [round(i * interval, 6) for i in range(n)]


def _backfill_head(grid: list[float]) -> list[float]:
    """Extend a grid backwards to t=0 at its opening inter-beat interval.

    Beat trackers commonly emit nothing until the groove settles — a rubato or softly
    picked intro can leave the first several bars of a recording with no onsets at all.
    That head must still be on the grid: `beat_for_time` clamps everything at or before
    the first onset to beat 0, so an off-grid head collapses every chord played there
    onto a single zero-length beat, and the chart drops them and opens on whichever chord
    happens to end after the first onset. Prepending beats keeps the head addressable.
    """
    interval = grid[1] - grid[0]
    if interval <= 0 or grid[0] <= 0:
        return grid
    n = int(grid[0] / interval)  # whole beats that fit before the first detected onset
    head = [round(grid[0] - i * interval, 6) for i in range(n, 0, -1)]
    return head + grid


def _interval(grid: list[float], i: int) -> float:
    """Inter-beat interval at index i, falling back to the final interval."""
    if 0 <= i < len(grid) - 1:
        step = grid[i + 1] - grid[i]
    else:
        step = grid[-1] - grid[-2]
    return step if step > 0 else 60.0 / _DEFAULT_BPM


def _raw_time_for_beat(beat: float, grid: list[float]) -> float:
    """Beat index -> seconds, unclamped (may fall outside the recording)."""
    last = len(grid) - 1
    if beat <= 0:
        # Beat 0 is grid[0], not necessarily t=0; extrapolate below it so the mapping
        # stays the inverse of beat_for_time (which puts beat 0 at grid[0]).
        return grid[0] + beat * _interval(grid, 0)
    if beat >= last:
        return grid[-1] + (beat - last) * _interval(grid, last)
    i = int(beat)
    return grid[i] + (beat - i) * _interval(grid, i)


def time_for_beat(beat: float, grid: list[float], duration: float) -> float:
    """Beat index -> seconds, clamped to [0, duration]."""
    return max(0.0, min(duration, _raw_time_for_beat(beat, grid)))


def beat_for_time(time: float, grid: list[float]) -> float:
    """Seconds -> fractional beat (inverse of time_for_beat), clamped to >= 0."""
    if time <= grid[0]:
        return 0.0
    if time >= grid[-1]:
        return (len(grid) - 1) + (time - grid[-1]) / _interval(grid, len(grid) - 1)
    i = bisect.bisect_right(grid, time) - 1
    return i + (time - grid[i]) / _interval(grid, i)


def total_beats(grid: list[float], duration: float) -> float:
    """The fractional beat reached at `duration` — the chart's maximum end_beat."""
    return beat_for_time(duration, grid)


# A runaway guard for grid rescaling: at 400 BPM (the highest tempo the API accepts) this
# is over four hours of audio, far past anything a practice recording will be.
_MAX_GRID_BEATS = 100_000


def rescale_grid(grid: list[float], factor: float, duration: float) -> list[float]:
    """Re-index a grid to a new tempo: one new beat every ``1 / factor`` old beats.

    `factor` is new_bpm / old_bpm, so halving the tempo (factor 0.5) keeps every second
    tracked onset and doubling it puts a new beat midway between each pair. The grid is
    *re-indexed, not replaced*: new beat k sits wherever old beat k/factor sat, so the beats
    stay on the recording's own timing (which drifts, as human performances do) instead of
    snapping to a rigid metronome at the requested BPM.
    """
    if factor <= 0:
        raise ValueError("factor must be positive")
    if len(grid) < 2:
        return list(grid)

    # Cover the same span as the grid we came from: a tracked grid's last onset can sit just
    # past `duration`, and cutting the new grid at `duration` would lose the final beat.
    span = max(duration, grid[-1])
    out: list[float] = []
    k = 0
    while k < _MAX_GRID_BEATS:
        seconds = _raw_time_for_beat(k / factor, grid)
        if seconds > span and len(out) >= 2:
            break
        out.append(round(max(0.0, seconds), 6))
        k += 1
    while len(out) < 2:  # a degenerate (zero-length) recording still needs a usable grid
        out.append(round(out[-1] + _interval(grid, 0) / factor, 6) if out else 0.0)
    return out


def rescale_windows(
    windows: list[tuple[float, float]], factor: float, max_beat: float
) -> list[tuple[float, float] | None]:
    """Scale ordered (start_beat, end_beat) windows onto a rescaled grid.

    Beats scale with the tempo, so a chord keeps the audio it covers. Results are snapped to
    the half-beat, kept in order, held to the half-beat minimum length, and bounded by
    `max_beat`. `None` marks a window with no room left — only reachable when snapping and
    the minimum length squeeze the tail of the chart past the end of the grid.
    """
    if factor <= 0:
        raise ValueError("factor must be positive")
    out: list[tuple[float, float] | None] = []
    cursor = 0.0
    for start, end in windows:
        new_start = max(cursor, snap_half(start * factor))
        new_end = min(snap_half(end * factor), max_beat)
        if new_end - new_start < 0.5:  # snapped to nothing; give it the minimum
            new_end = min(new_start + 0.5, max_beat)
        if new_end - new_start < 0.5:
            out.append(None)
            continue
        out.append((new_start, new_end))
        cursor = new_end
    return out
