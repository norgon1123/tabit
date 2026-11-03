import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import get_settings
from app.db import Base, get_db
from app.jobs import get_job_dispatcher
from app.main import app


@pytest.fixture
def db_session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


class _FakeDispatcher:
    def __init__(self):
        self.dispatched: list[str] = []
        self.guest_dispatched: list[object] = []

    def dispatch(self, recording_id: str) -> None:
        self.dispatched.append(recording_id)

    def dispatch_guest(self, recording) -> None:
        self.guest_dispatched.append(recording)

    def shutdown(self) -> None:
        pass


@pytest.fixture
def client(db_session):
    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_job_dispatcher] = lambda: _FakeDispatcher()
    with TestClient(app) as c:
        # Startup reads settings (storage dir, for the guest-audio sweep), which warms the
        # lru_cache. Tests monkeypatch TABIT_* env vars *after* this fixture runs, so drop
        # the cached copy or those vars would silently do nothing.
        get_settings.cache_clear()
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def fake_dispatcher(client):
    fake = _FakeDispatcher()
    app.dependency_overrides[get_job_dispatcher] = lambda: fake
    yield fake
    app.dependency_overrides.pop(get_job_dispatcher, None)


@pytest.fixture(autouse=True)
def _clear_settings_cache():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture(autouse=True)
def _clear_rate_limiter():
    """Request budgets are process-wide; one test's attempts must not spend another's."""
    from app.rate_limit import get_rate_limiter
    get_rate_limiter.cache_clear()
    yield
    get_rate_limiter.cache_clear()


@pytest.fixture(autouse=True)
def _clear_guest_store():
    """The guest store is a process-wide singleton; one test's guest must not be another's."""
    from app.guest import get_guest_store
    get_guest_store.cache_clear()
    yield
    get_guest_store.cache_clear()
