import pytest

from app.audio.analyzer import AnalysisResult
from app.audio.segments import DetectedSegment
from app.jobs import analyze_recording
from app.models import Analysis, ChordChart, Recording, User
from app.music_theory import Quality
from app.security import hash_password


class StubAnalyzer:
    def __init__(self, result=None, exc=None):
        self._result = result
        self._exc = exc

    def analyze(self, audio_path):
        if self._exc is not None:
            raise self._exc
        return self._result


def _seed_pending_recording(db):
    user = User(username="u", password_hash=hash_password("password123"))
    db.add(user)
    db.flush()
    rec = Recording(
        user_id=user.id, original_filename="a.wav", format="wav",
        stored_path="/x/a.wav", duration_seconds=4.0,
    )
    db.add(rec)
    db.flush()
    db.add(Analysis(recording_id=rec.id, status="pending"))
    db.commit()
    return rec


def test_successful_analysis_seeds_chart(db_session):
    rec = _seed_pending_recording(db_session)
    result = AnalysisResult(
        bpm=120.0, key_tonic_pc=0, key_mode="major", duration=4.0,
        segments=[
            DetectedSegment(0.0, 2.0, 0, Quality.MAJ),
            DetectedSegment(2.0, 4.0, 7, Quality.MAJ),
        ],
        engine_version="template-v1",
    )

    analyze_recording(db_session, rec.id, StubAnalyzer(result=result))

    analysis = db_session.query(Analysis).filter_by(recording_id=rec.id).one()
    assert analysis.status == "done"
    assert analysis.bpm == 120.0
    assert analysis.detected_key_tonic == "C"
    assert analysis.detected_key_mode == "major"
    assert analysis.engine_version == "template-v1"
    chart = db_session.query(ChordChart).filter_by(recording_id=rec.id).one()
    assert chart.key_tonic == "C"
    assert [(s.chord_root, s.chord_quality) for s in chart.segments] == [
        ("C", "maj"), ("G", "maj"),
    ]


def test_failed_analysis_records_error_and_no_chart(db_session):
    rec = _seed_pending_recording(db_session)

    analyze_recording(db_session, rec.id, StubAnalyzer(exc=RuntimeError("bad audio")))

    analysis = db_session.query(Analysis).filter_by(recording_id=rec.id).one()
    assert analysis.status == "failed"
    assert "bad audio" in analysis.error
    assert db_session.query(ChordChart).filter_by(recording_id=rec.id).count() == 0


def test_seeding_failure_marks_failed_not_running(db_session, monkeypatch):
    import app.jobs as jobs

    rec = _seed_pending_recording(db_session)
    result = AnalysisResult(120.0, 0, "major", 4.0, [DetectedSegment(0.0, 4.0, 0, Quality.MAJ)])

    def boom(*args, **kwargs):
        raise RuntimeError("seed failed")

    monkeypatch.setattr(jobs, "_seed_chart", boom)

    analyze_recording(db_session, rec.id, StubAnalyzer(result=result))

    analysis = db_session.query(Analysis).filter_by(recording_id=rec.id).one()
    assert analysis.status == "failed"
    assert "seed failed" in analysis.error
    assert db_session.query(ChordChart).filter_by(recording_id=rec.id).count() == 0


def test_reanalysis_replaces_existing_chart(db_session):
    rec = _seed_pending_recording(db_session)
    first = AnalysisResult(120.0, 0, "major", 4.0, [DetectedSegment(0.0, 4.0, 0, Quality.MAJ)])
    analyze_recording(db_session, rec.id, StubAnalyzer(result=first))

    second = AnalysisResult(90.0, 7, "major", 4.0, [DetectedSegment(0.0, 4.0, 7, Quality.MAJ)])
    analyze_recording(db_session, rec.id, StubAnalyzer(result=second))

    chart = db_session.query(ChordChart).filter_by(recording_id=rec.id).one()
    assert chart.key_tonic == "G"
    assert [(s.chord_root, s.chord_quality) for s in chart.segments] == [("G", "maj")]


def test_seeding_overwrites_browser_duration_and_clamps_segments(db_session):
    rec = _seed_pending_recording(db_session)  # browser-reported duration_seconds = 4.0
    # Server decoded a longer file; a stray segment runs past the true end and must be clamped.
    result = AnalysisResult(
        120.0, 0, "major", 7.5,
        [DetectedSegment(0.0, 4.0, 0, Quality.MAJ), DetectedSegment(4.0, 9.0, 7, Quality.MAJ)],
    )

    analyze_recording(db_session, rec.id, StubAnalyzer(result=result))

    db_session.refresh(rec)
    assert rec.duration_seconds == 7.5  # authoritative server duration wins
    chart = db_session.query(ChordChart).filter_by(recording_id=rec.id).one()
    ends = sorted(s.end_beat for s in chart.segments)
    # At 120 BPM over 7.5s the grid has 0.5s/beat -> 15 total beats; end_beat must not exceed it
    assert max(ends) <= 15.0


def test_seed_chart_assigns_whole_beats(db_session):
    from app.audio.analyzer import AnalysisResult
    from app.audio.segments import DetectedSegment
    from app.jobs import _seed_chart
    from app.models import Recording, User
    from app.music_theory import Quality

    user = User(username="seed", password_hash="x")
    db_session.add(user)
    db_session.flush()
    rec = Recording(user_id=user.id, original_filename="m.m4a", format="m4a",
                    stored_path="/tmp/m.m4a", duration_seconds=8.0)
    db_session.add(rec)
    db_session.flush()

    # Steady 120 BPM -> 0.5s/beat. Two chords, each 4 beats (2.0s).
    grid = [round(i * 0.5, 3) for i in range(17)]  # beats 0..16 over 8s
    result = AnalysisResult(
        bpm=120.0, key_tonic_pc=0, key_mode="major", duration=8.0,
        segments=[
            DetectedSegment(0.0, 2.0, 0, Quality.MAJ),
            DetectedSegment(2.0, 4.0, 7, Quality.MAJ),
        ],
        beat_times=grid,
    )
    _seed_chart(db_session, rec, result)
    db_session.commit()

    segs = sorted(rec.chart.segments, key=lambda s: s.start_beat)
    assert rec.chart.beat_times == grid
    assert rec.chart.beats_per_measure == 4
    assert (segs[0].start_beat, segs[0].end_beat) == (0.0, 4.0)
    assert (segs[1].start_beat, segs[1].end_beat) == (4.0, 8.0)


def test_seed_chart_keeps_chords_that_end_before_the_first_detected_beat(db_session):
    """Regression: a late-starting beat grid used to swallow the opening chords.

    On "The Power of the 5 Minor" librosa found no beat until 7.918s, so every chord that
    ended before that mapped to beat 0, was dropped as zero-length, and the chart opened on
    the third chord (A) — which then covered the audio the dropped B and F#m were playing
    over. The chords below are chordino's real output for that track; the chart must open on
    B and keep all three.
    """
    from app.audio.analyzer import AnalysisResult
    from app.audio.segments import DetectedSegment
    from app.jobs import _seed_chart
    from app.models import Recording, User
    from app.music_theory import Quality

    user = User(username="intro", password_hash="x")
    db_session.add(user)
    db_session.flush()
    rec = Recording(user_id=user.id, original_filename="p.mp3", format="mp3",
                    stored_path="/tmp/p.mp3", duration_seconds=20.0)
    db_session.add(rec)
    db_session.flush()

    grid = [round(7.918 + i * 0.418, 3) for i in range(29)]  # first onset 7.9s in
    result = AnalysisResult(
        bpm=143.6, key_tonic_pc=11, key_mode="minor", duration=20.0,
        segments=[
            DetectedSegment(0.91, 4.81, 11, Quality.MAJ),  # B
            DetectedSegment(4.81, 7.04, 6, Quality.MIN),   # F#m
            DetectedSegment(7.04, 9.64, 9, Quality.MAJ),   # A
        ],
        beat_times=grid,
    )
    _seed_chart(db_session, rec, result)
    db_session.commit()

    segs = sorted(rec.chart.segments, key=lambda s: s.start_beat)
    assert [s.chord_root for s in segs] == ["B", "F#", "A"]
    assert segs[0].start_beat == 0.0
    # Each chord keeps a plausible length instead of the first two collapsing to nothing.
    assert all(s.end_beat - s.start_beat >= 4.0 for s in segs)


def test_seed_threads_configured_bar_pull_beats(db_session, monkeypatch):
    # The bar-line pull tolerance is a setting (TABIT_CHART_BAR_PULL_BEATS, default 0.75).
    # A boundary at 1.65s -> beat 3.3 pulls to the downbeat 4.0 at 0.75, but to 3.0 at 0.1.
    # Setting the env to 0.1 and asserting the seeded chart shows 3.0 proves app/jobs.py
    # threads get_settings().chart_bar_pull_beats into build_chart_seed -- a dropped kwarg
    # would fall back to the 0.75 default and seed 4.0 instead.
    from app.config import get_settings
    from app.jobs import _seed_chart
    from app.audio.analyzer import AnalysisResult
    from app.audio.segments import DetectedSegment
    from app.models import Recording, User
    from app.music_theory import Quality

    user = User(username="pull", password_hash="x")
    db_session.add(user); db_session.flush()
    rec = Recording(user_id=user.id, original_filename="m.m4a", format="m4a",
                    stored_path="/tmp/m.m4a", duration_seconds=8.0)
    db_session.add(rec); db_session.flush()

    grid = [round(i * 0.5, 3) for i in range(17)]  # 120 BPM, beats 0..16 over 8s
    result = AnalysisResult(
        bpm=120.0, key_tonic_pc=0, key_mode="major", duration=8.0,
        segments=[DetectedSegment(0.0, 1.65, 0, Quality.MAJ),
                  DetectedSegment(1.65, 4.0, 7, Quality.MAJ)],
        beat_times=grid,
    )
    monkeypatch.setenv("TABIT_CHART_BAR_PULL_BEATS", "0.1")
    get_settings.cache_clear()
    try:
        _seed_chart(db_session, rec, result)
        db_session.commit()
        segs = sorted(rec.chart.segments, key=lambda s: s.start_beat)
        assert segs[0].end_beat == pytest.approx(3.0)  # would be 4.0 if the config didn't thread through
    finally:
        get_settings.cache_clear()


def test_dispatcher_uses_configured_min_segment_seconds(monkeypatch):
    # Round 2 #1: the min-segment threshold is an easily-adjustable setting (default 0.75).
    from app.config import get_settings
    from app.jobs import get_job_dispatcher

    assert get_settings().analysis_min_segment_seconds == 0.75

    # Pin the engine: this asserts on `_min_segment_seconds`, which the template-based
    # analyzers keep but BTCAnalyzer does not (it hands the value to BTCChordEngine as
    # `min_seconds`). Without pinning, the test reads whatever engine the developer's .env
    # happens to select and fails on TABIT_ANALYSIS_ENGINE=btc — a property of the machine,
    # not of the code under test, which is that the *setting* reaches the analyzer.
    monkeypatch.setenv("TABIT_ANALYSIS_ENGINE", "librosa")
    monkeypatch.setenv("TABIT_ANALYSIS_MIN_SEGMENT_SECONDS", "1.5")
    get_settings.cache_clear()
    get_job_dispatcher.cache_clear()
    dispatcher = get_job_dispatcher()
    try:
        assert dispatcher._analyzer._min_segment_seconds == 1.5
    finally:
        dispatcher.shutdown()
        get_job_dispatcher.cache_clear()
