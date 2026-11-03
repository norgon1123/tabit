from dataclasses import dataclass

from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.chart_store import ChartStore, DbChartStore, GuestChartStore
from app.config import get_settings
from app.db import get_db
from app.guest import GuestRecording, GuestStore, get_guest_store
from app.models import Recording, Session as SessionModel, User
from app.security import hash_token

_settings = get_settings()


def _user_for_token(db: DbSession, session_token: str | None) -> User | None:
    if not session_token:
        return None
    row = db.execute(
        select(SessionModel).where(SessionModel.token_hash == hash_token(session_token))
    ).scalar_one_or_none()
    if row is None:
        return None
    if row.is_expired(get_settings().session_max_age_seconds):
        db.delete(row)
        db.commit()
        return None
    return row.user


def get_current_user(
    db: DbSession = Depends(get_db),
    session_token: str | None = Cookie(default=None, alias=_settings.session_cookie_name),
) -> User:
    if not session_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    user = _user_for_token(db, session_token)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")
    return user


@dataclass(frozen=True)
class Principal:
    """Who is making this request: a signed-in user, or a guest known only by a cookie.

    Guests are the account-free trial path — one song, held in memory, never in the DB. A
    signed-in user is never treated as a guest, even if a stale guest cookie rides along.
    """

    user: User | None = None
    guest_key: str | None = None  # hash of the guest cookie token; the GuestStore key

    @property
    def is_guest(self) -> bool:
        return self.user is None


def get_principal(
    db: DbSession = Depends(get_db),
    session_token: str | None = Cookie(default=None, alias=_settings.session_cookie_name),
    guest_token: str | None = Cookie(default=None, alias=_settings.guest_cookie_name),
) -> Principal:
    """Resolve the caller without ever rejecting them.

    A missing *or unrecognized* session cookie means "not signed in", not "error": a visitor
    whose session was dropped server-side should land in guest mode rather than a 401 wall.
    Upload depends on this, so a first-timer carrying no cookies at all still gets a Principal
    — with no guest_key, which is the endpoint's cue to mint one.
    """
    user = _user_for_token(db, session_token)
    if user is not None:
        return Principal(user=user)
    return Principal(guest_key=hash_token(guest_token) if guest_token else None)


def require_principal(principal: Principal = Depends(get_principal)) -> Principal:
    """As above, but a caller with no identity at all is a 401 — for every endpoint that reads
    or edits something that must already exist."""
    if principal.user is None and principal.guest_key is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return principal


def get_owned_recording(db: DbSession, user: User, recording_id: str) -> Recording:
    rec = db.execute(
        select(Recording).where(Recording.id == recording_id, Recording.user_id == user.id)
    ).scalar_one_or_none()
    if rec is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recording not found")
    return rec


def get_recording_for_principal(
    recording_id: str,
    db: DbSession = Depends(get_db),
    principal: Principal = Depends(require_principal),
    guests: GuestStore = Depends(get_guest_store),
) -> Recording | GuestRecording:
    """The recording behind {recording_id}, from the DB or from the guest's in-memory slot.

    A guest holds exactly one recording, so any other id simply isn't theirs — 404, the same
    answer a signed-in user gets for someone else's recording.
    """
    if principal.user is not None:
        return get_owned_recording(db, principal.user, recording_id)
    rec = guests.get(principal.guest_key)
    if rec is None or rec.id != recording_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recording not found")
    return rec


def get_chart_store(
    db: DbSession = Depends(get_db),
    principal: Principal = Depends(require_principal),
    guests: GuestStore = Depends(get_guest_store),
) -> ChartStore:
    if principal.user is not None:
        return DbChartStore(db, principal.user)
    return GuestChartStore(guests.get(principal.guest_key))
