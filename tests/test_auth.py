def test_register_then_me(client):
    resp = client.post("/api/auth/register", json={"username": "alice", "password": "password123"})
    assert resp.status_code == 201
    assert resp.json()["username"] == "alice"
    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["username"] == "alice"


def test_register_duplicate_username_rejected(client):
    client.post("/api/auth/register", json={"username": "bob", "password": "password123"})
    resp = client.post("/api/auth/register", json={"username": "bob", "password": "password123"})
    assert resp.status_code == 409


def test_login_wrong_password_rejected(client):
    client.post("/api/auth/register", json={"username": "carol", "password": "password123"})
    client.post("/api/auth/logout")
    resp = client.post("/api/auth/login", json={"username": "carol", "password": "wrongpass1"})
    assert resp.status_code == 401


def test_login_sets_cookie_and_me_works(client):
    client.post("/api/auth/register", json={"username": "dave", "password": "password123"})
    client.post("/api/auth/logout")
    resp = client.post("/api/auth/login", json={"username": "dave", "password": "password123"})
    assert resp.status_code == 200
    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["username"] == "dave"


def test_logout_revokes_session(client):
    client.post("/api/auth/register", json={"username": "erin", "password": "password123"})
    assert client.get("/api/auth/me").status_code == 200
    assert client.post("/api/auth/logout").status_code == 204
    assert client.get("/api/auth/me").status_code == 401


def test_logout_only_revokes_current_device(client):
    from fastapi.testclient import TestClient
    from app.main import app

    client.post("/api/auth/register", json={"username": "frank", "password": "password123"})
    device2 = TestClient(app)
    assert device2.post("/api/auth/login", json={"username": "frank", "password": "password123"}).status_code == 200
    assert device2.get("/api/auth/me").status_code == 200

    # Log out on device 1 only.
    assert client.post("/api/auth/logout").status_code == 204
    assert client.get("/api/auth/me").status_code == 401
    # Device 2 stays logged in.
    assert device2.get("/api/auth/me").status_code == 200


def test_session_older_than_max_age_is_refused_and_deleted(client, db_session):
    """The cookie's max-age is only a hint to the browser; a stolen token must still die."""
    from datetime import datetime, timedelta, timezone

    from sqlalchemy import select

    from app.config import get_settings
    from app.models import Session as SessionModel

    client.post("/api/auth/register", json={"username": "gina", "password": "password123"})
    row = db_session.execute(select(SessionModel)).scalar_one()
    max_age = get_settings().session_max_age_seconds
    row.created_at = datetime.now(timezone.utc) - timedelta(seconds=max_age + 60)
    db_session.commit()

    assert client.get("/api/auth/me").status_code == 401
    assert db_session.execute(select(SessionModel)).first() is None


def test_login_clears_the_users_expired_sessions(client, db_session):
    """An expired session nobody presents again would otherwise sit in the table forever."""
    from datetime import datetime, timedelta, timezone

    from sqlalchemy import select

    from app.config import get_settings
    from app.models import Session as SessionModel

    creds = {"username": "ivy", "password": "password123"}
    client.post("/api/auth/register", json=creds)
    stale = db_session.execute(select(SessionModel)).scalar_one()
    stale_id = stale.id
    max_age = get_settings().session_max_age_seconds
    stale.created_at = datetime.now(timezone.utc) - timedelta(seconds=max_age + 60)
    db_session.commit()
    client.cookies.clear()

    assert client.post("/api/auth/login", json=creds).status_code == 200

    ids = [s.id for s in db_session.execute(select(SessionModel)).scalars()]
    assert len(ids) == 1 and stale_id not in ids


def test_auth_attempts_beyond_rate_limit_get_429(client, monkeypatch):
    """Brute force is capped per client: once the budget is spent, even the right password
    waits — otherwise the limit would leak which guess was correct."""
    monkeypatch.setenv("TABIT_AUTH_RATE_LIMIT", "3")
    creds = {"username": "hank", "password": "password123"}
    assert client.post("/api/auth/register", json=creds).status_code == 201
    for _ in range(2):
        assert client.post("/api/auth/login", json={**creds, "password": "wrong-password"}).status_code == 401

    resp = client.post("/api/auth/login", json=creds)

    assert resp.status_code == 429
    assert int(resp.headers["Retry-After"]) > 0
