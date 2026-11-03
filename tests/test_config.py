import pytest
from fastapi.testclient import TestClient

from app.main import app


def test_production_refuses_to_start_with_insecure_cookies(monkeypatch):
    """Session cookies sent over plain HTTP can be lifted off the wire; a production deploy
    that forgot TABIT_COOKIE_SECURE must fail loudly at startup, not run quietly."""
    monkeypatch.setenv("TABIT_ENVIRONMENT", "production")
    monkeypatch.setenv("TABIT_COOKIE_SECURE", "false")

    with pytest.raises(RuntimeError, match="TABIT_COOKIE_SECURE"), TestClient(app):
        pass


@pytest.mark.parametrize("environment", ["prod", "Production"])
def test_unrecognised_environment_name_is_refused_at_startup(monkeypatch, environment):
    """A near-miss spelling of "production" must not slip past the cookie check."""
    monkeypatch.setenv("TABIT_ENVIRONMENT", environment)
    monkeypatch.setenv("TABIT_COOKIE_SECURE", "false")

    with pytest.raises(ValueError, match="environment"), TestClient(app):
        pass


@pytest.mark.parametrize(
    ("environment", "cookie_secure"),
    [("production", "true"), ("development", "false")],
)
def test_app_starts_when_cookies_are_secure_or_not_in_production(
    monkeypatch, environment, cookie_secure
):
    monkeypatch.setenv("TABIT_ENVIRONMENT", environment)
    monkeypatch.setenv("TABIT_COOKIE_SECURE", cookie_secure)

    with TestClient(app) as c:
        assert c.get("/api/health").status_code == 200
