from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from app.config import get_settings
from app.db import get_db
from app.deps import get_current_user
from app.models import Session as SessionModel, User
from app.rate_limit import limit_auth
from app.schemas import Credentials, UserOut
from app.security import (
    generate_session_token,
    hash_password,
    hash_token,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])
_settings = get_settings()


def _start_session(db: DbSession, user: User, response: Response) -> None:
    # Sessions are refused once expired, but one nobody presents again would linger; a new
    # sign-in is the natural moment to clear the user's own stale ones.
    for stale in user.sessions:
        if stale.is_expired(_settings.session_max_age_seconds):
            db.delete(stale)
    token = generate_session_token()
    db.add(SessionModel(user_id=user.id, token_hash=hash_token(token)))
    db.commit()
    response.set_cookie(
        key=_settings.session_cookie_name,
        value=token,
        max_age=_settings.session_max_age_seconds,
        httponly=True,
        samesite="lax",
        secure=_settings.cookie_secure,
    )


@router.post(
    "/register",
    response_model=UserOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(limit_auth)],
)
def register(creds: Credentials, response: Response, db: DbSession = Depends(get_db)) -> User:
    exists = db.execute(select(User).where(User.username == creds.username)).scalar_one_or_none()
    if exists is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username taken")
    user = User(username=creds.username, password_hash=hash_password(creds.password))
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username taken")
    db.refresh(user)
    _start_session(db, user, response)
    return user


@router.post("/login", response_model=UserOut, dependencies=[Depends(limit_auth)])
def login(creds: Credentials, response: Response, db: DbSession = Depends(get_db)) -> User:
    user = db.execute(select(User).where(User.username == creds.username)).scalar_one_or_none()
    if user is None or not verify_password(creds.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    _start_session(db, user, response)
    return user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    response: Response,
    db: DbSession = Depends(get_db),
    user: User = Depends(get_current_user),
    session_token: str | None = Cookie(default=None, alias=_settings.session_cookie_name),
) -> Response:
    if session_token:
        db.execute(
            delete(SessionModel).where(SessionModel.token_hash == hash_token(session_token))
        )
        db.commit()
    response.delete_cookie(
        key=_settings.session_cookie_name,
        httponly=True,
        samesite="lax",
        secure=_settings.cookie_secure,
    )
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> User:
    return user
