import os
from typing import BinaryIO

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession, selectinload

from app.audio.decode import probe_duration
from app.config import get_settings
from app.db import get_db
from app.deps import (
    Principal,
    get_current_user,
    get_principal,
    get_recording_for_principal,
    require_principal,
)
from app.guest import GuestRecording, GuestStore, get_guest_store
from app.jobs import JobDispatcher, get_job_dispatcher
from app.models import Analysis, Recording, User
from app.rate_limit import limit_upload
from app.schemas import AnalysisOut, RecordingOut, RecordingUpdate
from app.security import generate_session_token, hash_token
from app.storage import GUEST_OWNER, delete_audio, save_audio

router = APIRouter(prefix="/api/recordings", tags=["recordings"])

_AUDIO_MEDIA_TYPES = {
    "m4a": "audio/mp4",
    "mp4": "audio/mp4",
    "mp3": "audio/mpeg",
    "wav": "audio/wav",
}

_GUEST_BUSY = (
    "Without an account you can analyze one song at a time. Wait for the current one to "
    "finish, or create an account to work on several."
)


def _enforce_length_limit(seconds: float | None, limit: float) -> None:
    """Reject a recording longer than the limit. Unknown length (None) passes."""
    if seconds is None or seconds <= limit:
        return
    raise HTTPException(
        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
        detail=(
            f"Recording is {seconds / 60:.1f} minutes long; "
            f"the maximum is {limit / 60:g} minutes."
        ),
    )


def upload_too_large(limit_bytes: int) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
        detail=(
            f"File is larger than the {limit_bytes / (1024 * 1024):g} MB limit. "
            "Upload a shorter or compressed recording."
        ),
    )


def read_capped(source: BinaryIO, limit_bytes: int) -> bytes:
    """Read an upload, refusing it (413) once it passes `limit_bytes`.

    The stream cap (app/body_limit.py) already bounds disk and bandwidth, but it allows for
    multipart framing on top of the cap; this enforces the cap on the file itself. Reads at
    most one byte past it."""
    data = source.read(limit_bytes + 1)
    if len(data) > limit_bytes:
        raise upload_too_large(limit_bytes)
    return data


def _extension(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"


@router.get("", response_model=list[RecordingOut])
def list_recordings(
    db: DbSession = Depends(get_db), user: User = Depends(get_current_user)
) -> list[Recording]:
    # A library of songs is what an account buys you; a guest has one recording and no list.
    # Each row renders its analysis and its chart's tempo/key, so load both up front rather
    # than lazily paying two queries per recording.
    return list(
        db.execute(
            select(Recording)
            .options(selectinload(Recording.analysis), selectinload(Recording.chart))
            .where(Recording.user_id == user.id)
            .order_by(Recording.created_at.desc())
        ).scalars()
    )


@router.post(
    "",
    response_model=RecordingOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(limit_upload)],
)
def upload_recording(
    response: Response,
    file: UploadFile = File(...),
    duration_seconds: float | None = Form(default=None),
    db: DbSession = Depends(get_db),
    principal: Principal = Depends(get_principal),
    guests: GuestStore = Depends(get_guest_store),
    dispatcher: JobDispatcher = Depends(get_job_dispatcher),
) -> Recording | GuestRecording:
    limit = get_settings().max_recording_seconds
    # The browser-reported duration is untrusted, but when it already exceeds the limit we
    # can say no before writing anything to disk.
    _enforce_length_limit(duration_seconds, limit)

    filename = file.filename or "recording"
    data = read_capped(file.file, get_settings().max_upload_bytes)
    if principal.user is None:
        return _upload_as_guest(
            response, filename, data, duration_seconds, principal, guests, dispatcher, limit
        )

    rec = Recording(
        user_id=principal.user.id,
        original_filename=filename,
        format=_extension(filename),
        stored_path="",
        duration_seconds=duration_seconds,
    )
    db.add(rec)
    db.flush()  # assign rec.id
    rec.stored_path = save_audio(principal.user.id, rec.id, rec.format, data)
    db.add(Analysis(recording_id=rec.id, status="pending"))
    try:
        # ffprobe the stored file: the server-decoded length is the authoritative one, and
        # a client can under-report (or omit) the duration to slip a long file past us.
        probed = probe_duration(rec.stored_path)
        if probed is not None:
            rec.duration_seconds = probed
        _enforce_length_limit(probed, limit)
        db.commit()
    except Exception:
        # Roll back the row and remove the just-written file so neither is orphaned.
        db.rollback()
        delete_audio(rec.stored_path)
        raise
    db.refresh(rec)
    dispatcher.dispatch(rec.id)
    return rec


def _upload_as_guest(
    response: Response,
    filename: str,
    data: bytes,
    duration_seconds: float | None,
    principal: Principal,
    guests: GuestStore,
    dispatcher: JobDispatcher,
    limit: float,
) -> GuestRecording:
    """Analyze a song for a visitor with no account: in memory, one at a time, and the audio
    deleted the moment the job ends (app/jobs.py). Nothing here reaches the database."""
    settings = get_settings()
    key = principal.guest_key
    if key is None:  # first visit — mint the cookie that names this guest's one slot
        token = generate_session_token()
        key = hash_token(token)
        response.set_cookie(
            key=settings.guest_cookie_name,
            value=token,
            httponly=True,
            samesite="lax",
            secure=settings.cookie_secure,
            # No max-age: it expires with the browser session, like the recording it names.
        )

    current = guests.get(key)
    if current is not None and current.analysis.status in ("pending", "running"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_GUEST_BUSY)

    rec = GuestRecording(
        original_filename=filename,
        format=_extension(filename),
        duration_seconds=duration_seconds,
    )
    rec.stored_path = save_audio(GUEST_OWNER, rec.id, rec.format, data)
    try:
        probed = probe_duration(rec.stored_path)
        if probed is not None:
            rec.duration_seconds = probed
        _enforce_length_limit(probed, limit)
    except Exception:
        delete_audio(rec.stored_path)
        raise

    guests.put(key, rec)  # replaces — and deletes the audio of — whatever they had before
    dispatcher.dispatch_guest(rec)
    return rec


@router.get("/{recording_id}", response_model=RecordingOut)
def get_recording(
    rec: Recording | GuestRecording = Depends(get_recording_for_principal),
) -> Recording | GuestRecording:
    return rec


@router.patch("/{recording_id}", response_model=RecordingOut)
def rename_recording(
    payload: RecordingUpdate,
    db: DbSession = Depends(get_db),
    rec: Recording | GuestRecording = Depends(get_recording_for_principal),
) -> Recording | GuestRecording:
    rec.original_filename = payload.original_filename
    if not isinstance(rec, GuestRecording):
        db.commit()
        db.refresh(rec)
    return rec


@router.get("/{recording_id}/analysis", response_model=AnalysisOut)
def get_analysis(rec: Recording | GuestRecording = Depends(get_recording_for_principal)):
    if rec.analysis is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Analysis not found")
    return rec.analysis


@router.post(
    "/{recording_id}/analyze",
    response_model=AnalysisOut,
    status_code=status.HTTP_202_ACCEPTED,
)
def reanalyze_recording(
    db: DbSession = Depends(get_db),
    rec: Recording | GuestRecording = Depends(get_recording_for_principal),
    dispatcher: JobDispatcher = Depends(get_job_dispatcher),
) -> Analysis:
    if isinstance(rec, GuestRecording):
        # A guest's audio is deleted the moment analysis ends, so there is nothing here to
        # re-read. Re-analyzing means uploading the file again — which the browser, still
        # holding it, can do without troubling the user.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Guest audio is deleted after analysis; upload the file again to re-analyze.",
        )
    if rec.analysis is not None:
        db.delete(rec.analysis)  # immutable Analysis: re-run creates a fresh one
        db.flush()
    analysis = Analysis(recording_id=rec.id, status="pending")
    db.add(analysis)
    db.commit()
    db.refresh(analysis)
    dispatcher.dispatch(rec.id)
    return analysis


@router.get("/{recording_id}/audio")
def get_recording_audio(
    rec: Recording | GuestRecording = Depends(get_recording_for_principal),
) -> FileResponse:
    # For a guest this 404s once analysis is done, by design: the file is deleted at that
    # moment and the browser plays the copy it never had to send anywhere.
    if not rec.stored_path or not os.path.exists(rec.stored_path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Audio file not found")
    media_type = _AUDIO_MEDIA_TYPES.get(rec.format, "application/octet-stream")
    return FileResponse(rec.stored_path, media_type=media_type, filename=rec.original_filename)


@router.delete("/{recording_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_recording(
    db: DbSession = Depends(get_db),
    principal: Principal = Depends(require_principal),
    guests: GuestStore = Depends(get_guest_store),
    rec: Recording | GuestRecording = Depends(get_recording_for_principal),
) -> None:
    if isinstance(rec, GuestRecording):
        guests.discard(principal.guest_key)  # drops the chart, and any audio still on disk
        return
    delete_audio(rec.stored_path)
    db.delete(rec)
    db.commit()
