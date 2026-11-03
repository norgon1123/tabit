import numpy as np
import pytest

from app.audio.decode import ffmpeg_available

pytest.importorskip("librosa")
pytestmark = pytest.mark.skipif(not ffmpeg_available(), reason="ffmpeg not installed")

from app.audio.analyzer import AnalysisResult, LibrosaAnalyzer, _trim_silence  # noqa: E402


def _tone(sr, seconds, hz=220.0, amp=0.3):
    t = np.linspace(0.0, seconds, int(sr * seconds), endpoint=False)
    return (amp * np.sin(2 * np.pi * hz * t)).astype(np.float32)


def test_trim_silence_ignores_a_brief_leading_transient():
    # A real file can open with a short loud click before the true silence, which
    # anchors a naive first-frame trim at t~=0. Trimming must skip that transient and
    # start at the music, judging content by sustained dB level, not the first blip.
    sr = 22050
    blip = _tone(sr, 0.2)  # 0.2s click at the very start
    silence = np.zeros(int(sr * 1.0), dtype=np.float32)  # 1.0s of quiet
    music = _tone(sr, 2.0)  # 2.0s of sustained content
    y = np.concatenate([blip, silence, music])

    trimmed, lead = _trim_silence(y, sr, top_db=30.0)

    assert lead == pytest.approx(1.2, abs=0.15)  # past the blip + silence
    assert len(trimmed) / sr == pytest.approx(2.0, abs=0.15)  # only the music survives


def _chord_block(pcs, sr, seconds, base_hz=261.63):
    t = np.linspace(0.0, seconds, int(sr * seconds), endpoint=False)
    chord = np.zeros_like(t)
    for pc in pcs:
        freq = base_hz * (2 ** (pc / 12))
        for harmonic in (1, 2, 3):
            chord += np.sin(2 * np.pi * freq * harmonic * t) / harmonic
    return chord


def _write_chord_song(path, chord_pitch_classes, sr=22050, seconds_each=2.0, lead_silence=0.0, trail_silence=0.0):
    sf = pytest.importorskip("soundfile")
    blocks = []
    if lead_silence:
        blocks.append(np.zeros(int(sr * lead_silence)))
    for pcs in chord_pitch_classes:
        blocks.append(_chord_block(pcs, sr, seconds_each))
    if trail_silence:
        blocks.append(np.zeros(int(sr * trail_silence)))
    signal = np.concatenate(blocks)
    signal = 0.3 * signal / np.max(np.abs(signal))
    sf.write(str(path), signal, sr)


def test_analyzes_a_two_chord_song(tmp_path):
    path = tmp_path / "song.wav"
    _write_chord_song(path, [(0, 4, 7), (7, 11, 2)])  # C major, then G major

    result = LibrosaAnalyzer().analyze(str(path))

    assert isinstance(result, AnalysisResult)
    assert result.bpm > 0
    assert result.bpm == int(result.bpm)  # tempo is detected as a whole number of BPM
    assert result.key_mode in ("major", "minor")
    assert result.engine_version == "hmm-v3"
    assert result.duration == pytest.approx(4.0, abs=0.05)
    roots = {segment.root_pc for segment in result.segments}
    assert 0 in roots  # C detected somewhere
    assert 7 in roots  # G detected somewhere
    # beat grid comes back non-empty, ascending, and non-negative
    assert len(result.beat_times) > 0
    assert result.beat_times == sorted(result.beat_times)
    assert all(t >= 0 for t in result.beat_times)


def test_chart_never_exceeds_audio_duration(tmp_path):
    path = tmp_path / "song.wav"
    _write_chord_song(path, [(0, 4, 7), (7, 11, 2), (9, 0, 4), (5, 9, 0)], seconds_each=2.0)

    result = LibrosaAnalyzer().analyze(str(path))

    assert result.segments
    assert max(s.end_time for s in result.segments) <= result.duration + 1e-6


def test_chord_change_lands_near_the_real_boundary(tmp_path):
    path = tmp_path / "song.wav"
    # One clean change at t=2.0s; the detected boundary must land close to it (#4).
    _write_chord_song(path, [(0, 4, 7), (7, 11, 2)], seconds_each=2.0)

    result = LibrosaAnalyzer().analyze(str(path))

    interior = [s.start_time for s in result.segments[1:]]
    assert interior, "expected at least one chord change"
    assert min(abs(t - 2.0) for t in interior) <= 0.3


def test_leading_and_trailing_silence_is_trimmed(tmp_path):
    path = tmp_path / "song.wav"
    _write_chord_song(path, [(0, 4, 7)], seconds_each=2.0, lead_silence=1.0, trail_silence=1.0)

    result = LibrosaAnalyzer().analyze(str(path))

    assert result.duration == pytest.approx(4.0, abs=0.05)  # full file length preserved
    assert result.segments
    assert result.segments[0].start_time >= 0.7  # chart starts at the first sound, not 0
    assert result.segments[-1].end_time <= 3.3  # and ends before the trailing silence


def test_analysis_result_has_beat_times_field():
    from app.audio.analyzer import AnalysisResult
    r = AnalysisResult(bpm=120.0, key_tonic_pc=0, key_mode="major", duration=2.0)
    assert r.beat_times == []


def test_btc_analyzer_returns_beat_times_past_the_leading_silence(tmp_path, monkeypatch):
    # The deep model only emits chords, so the chart's beat grid comes from librosa here.
    # Beat-tracking the untrimmed mix would anchor the grid inside the lead-in silence and
    # skew every chord's beat count; the onsets must land on the music and stay in
    # original-audio time (the frame the BTC segments are already in).
    from app.audio.analyzer import BTCAnalyzer
    from app.audio.segments import DetectedSegment
    from app.music_theory import Quality

    path = tmp_path / "song.wav"
    chords = [(0, 4, 7), (7, 11, 2), (9, 0, 4), (5, 9, 0)]
    _write_chord_song(path, chords, lead_silence=1.5)

    analyzer = BTCAnalyzer(sample_rate=22050)
    # Stub the deep engine: weights/torch are not needed to exercise the beat wiring.
    monkeypatch.setattr(
        analyzer._engine,
        "segments",
        lambda _p: [DetectedSegment(1.5, 9.5, 0, Quality.MAJ)],
    )

    result = analyzer.analyze(str(path))

    assert result.engine_version == "btc-v1"
    # >= 2 onsets, or beatgrid.ensure_grid discards them for a synthetic uniform grid and
    # the chart's beat counts stop tracking the music.
    assert len(result.beat_times) >= 2
    assert result.beat_times == sorted(result.beat_times)
    assert result.beat_times[0] >= 1.0  # on the music, not anchored in the silence
    assert result.beat_times[-1] <= result.duration
