from app.rate_limit import RateLimiter


class _Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def test_idle_clients_are_forgotten():
    """Every new client address costs memory; one that has gone quiet must not keep it,
    or rotating source addresses would grow the limiter until restart."""
    clock = _Clock()
    limiter = RateLimiter(clock=clock, sweep_every=1)
    limiter.hit("auth:a", limit=5, window=60)
    limiter.hit("auth:b", limit=5, window=60)

    clock.now = 61
    limiter.hit("auth:c", limit=5, window=60)

    assert limiter.tracked_keys() == {"auth:c"}
