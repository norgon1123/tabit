"""In-process background analysis jobs and the chart seeding that follows."""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audio.analyzer import (
    Analyzer,
    AnalysisResult,
    BTCAnalyzer,
    ChordinoAnalyzer,
    LibrosaAnalyzer,
)
from app.audio.separation import SeparationService
from app.chart_seed import ChartSeed, build_chart_seed
from app.config import get_settings
from app.db import SessionLocal
from app.guest import GuestChart, GuestRecording, GuestSegment
from app.models import Analysis, ChordChart, ChordSegment, Recording
from app.music_theory import tonic_for_pitch_class
from app.storage import delete_audio

logger = logging.getLogger(__name__)


def analyze_recording(db: Session, recording_id: str, analyzer: Analyzer) -> None:
    """Run analysis for one recording, persist results, and seed its chart."""
    analysis = db.execute(
        select(Analysis).where(Analysis.recording_id == recording_id)
    ).scalar_one_or_none()
    recording = db.get(Recording, recording_id)
    if analysis is None or recording is None:
        logger.warning("analyze_recording: no analysis/recording for %s", recording_id)
        return

    analysis.status = "running"
    analysis.error = None
    db.commit()

    try:
        result = analyzer.analyze(recording.stored_path)
        _write_result(analysis, result)
        _seed_chart(db, recording, result)
        analysis.status = "done"
        db.commit()
    except Exception as exc:  # any analysis/seeding/commit failure -> FAILED with message
        db.rollback()
        analysis.status = "failed"
        analysis.error = str(exc)[:1000]
        db.commit()
        logger.exception("analysis failed for recording %s", recording_id)
        return


def analyze_guest_recording(recording: GuestRecording, analyzer: Analyzer) -> None:
    """Analyze a logged-out visitor's song entirely in memory, then delete the audio.

    Same pipeline and same seeding as `analyze_recording` — the difference is where the
    results land (the GuestRecording, never the DB) and that the uploaded file is scratch
    space: it exists only while the analyzer is reading it, and is gone by the time this
    returns, whether the analysis succeeded or failed.
    """
    analysis = recording.analysis
    analysis.status = "running"
    analysis.error = None
    try:
        result = analyzer.analyze(recording.stored_path)
        analysis.bpm = result.bpm
        analysis.detected_key_tonic = tonic_for_pitch_class(result.key_tonic_pc, result.key_mode)
        analysis.detected_key_mode = result.key_mode
        analysis.engine_version = result.engine_version
        # Trust the server-decoded length over the browser-reported duration.
        recording.duration_seconds = result.duration
        recording.chart = _guest_chart(
            recording,
            build_chart_seed(result, pull_beats=get_settings().chart_bar_pull_beats),
        )
        # Last: the frontend fetches the chart as soon as it sees "done".
        analysis.status = "done"
    except Exception as exc:
        analysis.status = "failed"
        analysis.error = str(exc)[:1000]
        logger.exception("analysis failed for guest recording %s", recording.id)
    finally:
        delete_audio(recording.stored_path)
        recording.stored_path = ""


def _guest_chart(recording: GuestRecording, seed: ChartSeed) -> GuestChart:
    return GuestChart(
        recording=recording,
        key_tonic=seed.key_tonic,
        key_mode=seed.key_mode,
        beat_times=seed.beat_times,
        bpm=seed.bpm,
        segments=[
            GuestSegment(
                start_beat=s.start_beat,
                end_beat=s.end_beat,
                chord_root=s.chord_root,
                chord_quality=s.chord_quality,
            )
            for s in seed.segments
        ],
    )


def _write_result(analysis: Analysis, result: AnalysisResult) -> None:
    analysis.bpm = result.bpm
    analysis.detected_key_tonic = tonic_for_pitch_class(result.key_tonic_pc, result.key_mode)
    analysis.detected_key_mode = result.key_mode
    analysis.engine_version = result.engine_version


def _seed_chart(db: Session, recording: Recording, result: AnalysisResult) -> None:
    existing = db.execute(
        select(ChordChart).where(ChordChart.recording_id == recording.id)
    ).scalar_one_or_none()
    if existing is not None:
        db.delete(existing)
        db.flush()

    # #1: trust the server-decoded length over the browser-reported duration.
    recording.duration_seconds = result.duration

    seed = build_chart_seed(result, pull_beats=get_settings().chart_bar_pull_beats)
    chart = ChordChart(
        recording_id=recording.id,
        key_tonic=seed.key_tonic,
        key_mode=seed.key_mode,
        beat_times=seed.beat_times,
        bpm=seed.bpm,  # the user's starting tempo; they can re-count it (PATCH .../tempo)
    )
    db.add(chart)
    db.flush()

    for segment in seed.segments:
        db.add(
            ChordSegment(
                chart_id=chart.id,
                start_beat=segment.start_beat,
                end_beat=segment.end_beat,
                chord_root=segment.chord_root,
                chord_quality=segment.chord_quality,
            )
        )


class JobDispatcher:
    """Runs analysis on worker threads, each with its own DB session."""

    def __init__(self, max_workers: int, analyzer: Analyzer) -> None:
        self._pool = ThreadPoolExecutor(
            max_workers=max_workers, thread_name_prefix="analysis"
        )
        self._analyzer = analyzer

    def dispatch(self, recording_id: str) -> None:
        self._pool.submit(self._run, recording_id)

    def dispatch_guest(self, recording: GuestRecording) -> None:
        """Guest jobs carry the recording itself — there is no row to look up."""
        self._pool.submit(analyze_guest_recording, recording, self._analyzer)

    def _run(self, recording_id: str) -> None:
        db = SessionLocal()
        try:
            analyze_recording(db, recording_id, self._analyzer)
        finally:
            db.close()

    def shutdown(self) -> None:
        self._pool.shutdown(wait=False, cancel_futures=True)


def _build_librosa_analyzer(settings) -> Analyzer:
    return LibrosaAnalyzer(
        settings.analysis_sample_rate,
        min_segment_seconds=settings.analysis_min_segment_seconds,
        change_penalty=settings.analysis_change_penalty,
        use_hpss=settings.analysis_use_hpss,
    )


def _build_btc_analyzer(settings) -> Analyzer:
    """The deep engine, fed a Demucs stem when separation is enabled.

    Nothing heavy is imported here: Demucs and the BTC weights load on the first analyze()
    call, on the worker thread. A missing dependency therefore surfaces as a failed analysis
    with the real error, never as a silent downgrade — the deep model is the point of
    selecting this engine (see the "not swappable" note in app/audio/deep_chord.py).
    """
    separator = (
        SeparationService(
            model=settings.separation_model, device=settings.analysis_device
        )
        if settings.enable_separation
        else None
    )
    return BTCAnalyzer(
        settings.analysis_sample_rate,
        min_segment_seconds=settings.analysis_min_segment_seconds,
        device=settings.analysis_device,
        separator=separator,
        stem=settings.separation_stems,
    )


def _build_analyzer(settings) -> Analyzer:
    engine = settings.analysis_engine.lower()
    if engine in ("btc", "deep"):
        return _build_btc_analyzer(settings)
    if engine == "chordino":
        try:
            return ChordinoAnalyzer(
                settings.analysis_sample_rate,
                min_segment_seconds=settings.analysis_min_segment_seconds,
            )
        except RuntimeError as exc:
            # The native Vamp plugin isn't available here; degrade to the built-in engine
            # rather than failing analysis outright.
            logger.warning("Chordino unavailable (%s); falling back to librosa engine", exc)
    return _build_librosa_analyzer(settings)


@lru_cache
def get_job_dispatcher() -> JobDispatcher:
    settings = get_settings()
    return JobDispatcher(settings.analysis_max_workers, _build_analyzer(settings))
