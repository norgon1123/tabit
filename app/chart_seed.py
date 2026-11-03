"""Turn an AnalysisResult into the chart that seeds it — beats, not seconds.

Kept storage-agnostic on purpose: the same seed becomes ORM rows for a signed-in user's
recording and in-memory objects for a guest's (see app/jobs.py), so the beat math that
decides where a chord starts and ends exists once.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.audio.analyzer import AnalysisResult
from app.audio.beatgrid import beat_for_time, ensure_grid, snap_chart_beat, total_beats
from app.music_theory import key_prefers_flats, pitch_class_to_note, tonic_for_pitch_class


@dataclass(frozen=True)
class SeededSegment:
    start_beat: float
    end_beat: float
    chord_root: str
    chord_quality: str


@dataclass(frozen=True)
class ChartSeed:
    key_tonic: str
    key_mode: str
    bpm: float | None
    beat_times: list[float]
    segments: list[SeededSegment]


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
        # Interior chords snap to whole beats, so the shortest is one beat; anything less is
        # two boundaries collapsed onto the same beat — a zero-length artefact to drop. The
        # FINAL chord is the exception: it clamps to the recording's *fractional* max_beat, so
        # a genuine tail chord can be shorter than a beat and must be kept (down to the
        # half-beat minimum) rather than silently lost. See the spec's asymmetric-floor rule.
        reaches_end = end_beat >= max_beat - 1e-9
        floor = 0.5 if reaches_end else 1.0
        if end_beat - cursor < floor:
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

    return ChartSeed(
        key_tonic=tonic,
        key_mode=result.key_mode,
        bpm=result.bpm,  # the chart's starting tempo; the user can re-count it
        beat_times=grid,
        segments=segments,
    )
