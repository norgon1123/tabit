"""T3-pure: BTC label mapping + frame-posterior -> segments (no model/weights needed)."""

import pytest

from app.audio.deep_chord import frames_to_segments, reduce_btc_label
from app.music_theory import Quality


@pytest.mark.parametrize(
    "label, expected",
    [
        # core qualities
        ("C:maj", (0, Quality.MAJ)),
        ("A:min", (9, Quality.MIN)),
        ("G:7", (7, Quality.DOM7)),
        ("D:maj7", (2, Quality.MAJ7)),
        ("E:min7", (4, Quality.MIN7)),
        # accidentals in the root spelling
        ("Bb:min", (10, Quality.MIN)),
        ("F#:maj", (6, Quality.MAJ)),
        # slash bass is dropped, quality preserved
        ("C:maj/3", (0, Quality.MAJ)),
        # bare root (no shorthand) reads as major
        ("C", (0, Quality.MAJ)),
    ],
)
def test_reduce_btc_label_parses_root_quality_and_drops_bass(label, expected):
    assert reduce_btc_label(label) == expected


@pytest.mark.parametrize(
    "label, expected",
    [
        ("C:hdim7", (0, Quality.MIN)),
        ("C:dim7", (0, Quality.MIN)),
        ("C:sus4", (0, Quality.MAJ)),
        ("C:aug", (0, Quality.MAJ)),
        ("C:minmaj7", (0, Quality.MIN7)),
        ("C:maj9", (0, Quality.MAJ7)),
    ],
)
def test_reduce_btc_label_collapses_extended_vocab_to_the_five_qualities(label, expected):
    assert reduce_btc_label(label) == expected


def test_reduce_btc_label_no_chord_and_garbage():
    assert reduce_btc_label("N") is None
    assert reduce_btc_label("X") is None
    assert reduce_btc_label("") is None
    assert reduce_btc_label("not-a-chord") is None


def test_frames_to_segments_groups_and_times():
    # 4 frames @ 0.5s: C, C, then A:min, A:min  ->  [0,1) C:maj, [1,2) A:min
    frames = [(0, Quality.MAJ), (0, Quality.MAJ), (9, Quality.MIN), (9, Quality.MIN)]
    segs = frames_to_segments(frames, 0.5)
    assert [(s.start_time, s.end_time, s.root_pc, s.quality) for s in segs] == [
        (0.0, 1.0, 0, Quality.MAJ),
        (1.0, 2.0, 9, Quality.MIN),
    ]


def test_frames_to_segments_drops_no_chord_frames_as_gaps():
    # C, N, N, G -> two segments with a gap where N was (scored as no-chord downstream)
    frames = [(0, Quality.MAJ), None, None, (7, Quality.MAJ)]
    segs = frames_to_segments(frames, 1.0)
    assert [(s.start_time, s.end_time, s.root_pc) for s in segs] == [
        (0.0, 1.0, 0),
        (3.0, 4.0, 7),
    ]


def test_frames_to_segments_smoothing_removes_single_frame_jitter():
    # one stray G frame inside a run of C should be voted out by a width-3 window
    frames = [(0, Quality.MAJ), (0, Quality.MAJ), (7, Quality.MAJ), (0, Quality.MAJ), (0, Quality.MAJ)]
    segs = frames_to_segments(frames, 1.0, smooth_window=3)
    assert len(segs) == 1
    assert segs[0].root_pc == 0 and segs[0].start_time == 0.0 and segs[0].end_time == 5.0


def test_frames_to_segments_empty_and_bad_hop():
    assert frames_to_segments([], 0.5) == []
    assert frames_to_segments([None, None], 0.5) == []
    with pytest.raises(ValueError):
        frames_to_segments([(0, Quality.MAJ)], 0.0)
