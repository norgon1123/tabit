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
    # 3.10s -> beat 6.2. Nearest bar line is 1.8 away, > the 0.75-beat pull tolerance ->
    # no pull, takes its nearest whole beat, 6.
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


def test_a_real_final_chord_shorter_than_a_beat_is_kept_not_dropped():
    """A closing chord in the last <1 beat must survive: dropping it makes the chart end
    before the audio does. Interior chords still need a full beat, but the final chord
    clamps to the recording's fractional max_beat and is kept down to the half-beat floor."""
    # duration 15.45s -> max_beat 30.9. C over beats 0-30, then a real G over 30.0-30.9.
    seed = build_chart_seed(_result([_seg(0.0, 15.0), _seg(15.0, 15.45, 7)], duration=15.45))
    assert len(seed.segments) == 2
    assert seed.segments[-1].chord_root != seed.segments[0].chord_root  # the G survived
    assert seed.segments[-1].end_beat == pytest.approx(30.9)
    assert seed.segments[-1].start_beat == pytest.approx(30.0)


def test_the_bar_line_pull_moves_a_boundary_to_the_downbeat():
    # A boundary at 1.65s -> beat 3.3, which sits 0.7 from the bar line at beat 4 (inside the
    # 0.75 pull) but rounds to 3 by plain whole-beat rounding. The pull is the whole feature:
    # with it the chord ends on the downbeat (4.0); with the pull effectively off, it lands on
    # the nearest whole beat (3.0). Asserting both proves the pull branch is what produces 4.0
    # -- this test fails if the bar-line pull is removed from snap_chart_beat.
    pulled = build_chart_seed(_result([_seg(0.0, 1.65), _seg(1.65, 16.0, 7)]))
    assert pulled.segments[0].end_beat == pytest.approx(4.0)
    unpulled = build_chart_seed(_result([_seg(0.0, 1.65), _seg(1.65, 16.0, 7)]), pull_beats=0.1)
    assert unpulled.segments[0].end_beat == pytest.approx(3.0)


def test_a_tail_change_inside_the_final_partial_beat_is_not_its_own_chord():
    # duration 15.15s -> max_beat 30.3. A tail change at raw beat 30.3 snaps to the nearest
    # whole beat (30.0), landing on the cursor: a zero-length span, dropped. (The 0.5 tail
    # floor is not what excludes it — with a whole-beat cursor a positive tail reaching
    # max_beat is always >= 0.5, so a sub-0.5 tail cannot occur; see the spec. What this
    # pins is that a chord change buried in the closing partial beat does not seed a chord.)
    seed = build_chart_seed(_result([_seg(0.0, 15.0), _seg(15.0, 15.15, 7)], duration=15.15))
    assert [s.chord_root for s in seed.segments] == ["C"]
