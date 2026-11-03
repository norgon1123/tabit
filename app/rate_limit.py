"""Per-client request budgets for the endpoints worth abusing: sign-in and upload.

In-process and in-memory, like the guest store: Tabit runs as one self-hosted process, so a
shared store would buy nothing yet. Budgets reset on restart.
"""

import math
import threading
import time
from collections import deque
from collections.abc import Callable
from functools import lru_cache

from fastapi import HTTPException, Request, status

from app.config import get_settings


class RateLimiter:
    """Sliding-window log: a key may make `limit` hits in any `window` seconds."""

    def __init__(
        self, clock: Callable[[], float] = time.monotonic, sweep_every: int = 1024
    ) -> None:
        self._clock = clock
        self._hits: dict[str, deque[float]] = {}
        self._windows: dict[str, float] = {}
        self._lock = threading.Lock()
        self._sweep_every = sweep_every
        self._since_sweep = 0

    def hit(self, key: str, limit: int, window: float) -> float | None:
        """Record a hit for `key`. Returns None if allowed, else seconds until it would be."""
        now = self._clock()
        with self._lock:
            self._maybe_sweep(now)
            hits = self._hits.setdefault(key, deque())
            self._windows[key] = window
            while hits and hits[0] <= now - window:
                hits.popleft()
            if len(hits) >= limit:
                return hits[0] + window - now
            hits.append(now)
            return None

    def tracked_keys(self) -> set[str]:
        with self._lock:
            return set(self._hits)

    def _maybe_sweep(self, now: float) -> None:
        """Forget keys whose every hit has aged out, so memory follows active clients only."""
        self._since_sweep += 1
        if self._since_sweep < self._sweep_every:
            return
        self._since_sweep = 0
        for key in [k for k, hits in self._hits.items() if not hits or hits[-1] <= now - self._windows[k]]:
            del self._hits[key]
            del self._windows[key]


@lru_cache
def get_rate_limiter() -> RateLimiter:
    return RateLimiter()


def rate_limited(scope: str, limit_setting: str, window_setting: str) -> Callable[[Request], None]:
    """A route dependency that spends one unit of the caller's `scope` budget, or 429s."""

    def dependency(request: Request) -> None:
        settings = get_settings()
        limit = getattr(settings, limit_setting)
        if limit <= 0:
            return
        client = request.client.host if request.client else "unknown"
        retry_after = get_rate_limiter().hit(
            f"{scope}:{client}", limit, getattr(settings, window_setting)
        )
        if retry_after is not None:
            seconds = max(1, math.ceil(retry_after))
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many attempts. Wait {seconds} seconds, then try again.",
                headers={"Retry-After": str(seconds)},
            )

    return dependency


limit_auth = rate_limited("auth", "auth_rate_limit", "auth_rate_window_seconds")
limit_upload = rate_limited("upload", "upload_rate_limit", "upload_rate_window_seconds")
