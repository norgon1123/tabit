import numpy as np
import pytest

from app.audio.decode import ffmpeg_available

vamp = pytest.importorskip("vamp")
pytest.importorskip("librosa")
pytestmark = pytest.mark.skipif(
    not ffmpeg_available() or "nnls-chroma:chordino" not in vamp.list_plugins(),
    reason="ffmpeg or the nnls-chroma:chordino Vamp plugin is not installed",
)

from app.audio.analyzer import AnalysisResult, ChordinoAnalyzer  # noqa: E402


def _write_chord_song(path, chord_pitch_classes, sr=22050, seconds_each=2.0, base_hz=130.81):
    sf = pytest.importorskip("soundfile")
    blocks = []
    for pcs in chord_pitch_classes:
        t = np.linspace(0.0, seconds_each, int(sr * seconds_each), endpoint=False)
        chord = np.zeros_like(t)
        for pc in pcs:
            freq = base_hz * (2 ** (pc / 12))
            for harmonic in (1, 2, 3, 4):
                chord += np.sin(2 * np.pi * freq * harmonic * t) / harmonic
        blocks.append(chord)
    signal = np.concatenate(blocks)
    signal = 0.3 * signal / np.max(np.abs(signal))
    sf.write(str(path), signal, sr)


def test_chordino_detects_a_progression(tmp_path):
    path = tmp_path / "song.wav"
    # C major, G dominant 7th, A minor.
    _write_chord_song(path, [(0, 4, 7), (7, 11, 2, 5), (9, 0, 4)])

    result = ChordinoAnalyzer().analyze(str(path))

    assert isinstance(result, AnalysisResult)
    assert result.engine_version == "chordino-v1"
    assert result.bpm > 0
    assert result.duration == pytest.approx(6.0, abs=0.05)
    chords = {(s.root_pc, s.quality.value) for s in result.segments}
    roots = {root for root, _ in chords}
    assert {0, 7, 9} <= roots  # C, G, and A all detected


def _write_with_leading_silence(path, chord_pitch_classes, sr=22050, seconds_each=2.0,
                                lead_silence=1.5, blip_seconds=0.2, base_hz=130.81):
    """A song that opens with a brief click, then silence, then the chords."""
    sf = pytest.importorskip("soundfile")
    t_blip = np.linspace(0.0, blip_seconds, int(sr * blip_seconds), endpoint=False)
    blocks = [0.3 * np.sin(2 * np.pi * base_hz * t_blip)]  # leading transient
    blocks.append(np.zeros(int(sr * lead_silence)))  # then quiet
    for pcs in chord_pitch_classes:
        t = np.linspace(0.0, seconds_each, int(sr * seconds_each), endpoint=False)
        chord = np.zeros_like(t)
        for pc in pcs:
            freq = base_hz * (2 ** (pc / 12))
            for harmonic in (1, 2, 3, 4):
                chord += np.sin(2 * np.pi * freq * harmonic * t) / harmonic
        blocks.append(chord)
    signal = np.concatenate(blocks)
    signal = 0.3 * signal / np.max(np.abs(signal))
    sf.write(str(path), signal, sr)


def test_chordino_trims_leading_silence_from_beats_and_chords(tmp_path):
    # The beats feature must not analyse the leading silence: neither beats nor chords
    # should land in the quiet ~1.7s before the music (a 0.2s click + 1.5s silence).
    path = tmp_path / "leadsilence.wav"
    _write_with_leading_silence(path, [(0, 4, 7), (7, 11, 2), (5, 9, 0)],
                                lead_silence=1.5, blip_seconds=0.2)

    result = ChordinoAnalyzer().analyze(str(path))

    assert result.duration == pytest.approx(1.7 + 6.0, abs=0.05)  # full length preserved
    assert result.beat_times, "expected a beat grid"
    assert min(result.beat_times) >= 1.2  # no beats inside the leading silence
    assert result.segments
    assert result.segments[0].start_time >= 1.2  # first chord starts at the music


def test_chordino_reduces_extensions_to_the_five_qualities(tmp_path):
    path = tmp_path / "addninth.wav"
    # Cadd9 held; Chordino should read it as plain C major (one of the five qualities).
    _write_chord_song(path, [(0, 4, 7, 2)], seconds_each=3.0)

    result = ChordinoAnalyzer().analyze(str(path))

    assert result.segments
    qualities = {s.quality.value for s in result.segments}
    assert qualities <= {"maj", "min", "dom7", "maj7", "min7"}
    assert any(s.root_pc == 0 for s in result.segments)
