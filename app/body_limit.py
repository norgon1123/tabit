"""Cap request bodies at the ASGI stream, before anything parses or spools them.

FastAPI reads the whole body (multipart spools file parts to a temp file, unbounded) before
any dependency or handler runs, so a check there is too late for disk and bandwidth. This
counts bytes as they arrive: a declared Content-Length over the cap is refused outright,
and a chunked or understated body is cut off the moment it crosses the cap.

Uploads get `max_upload_bytes` (plus room for multipart framing); every other endpoint is
JSON or empty and gets the much smaller `max_body_bytes`.
"""

from fastapi import HTTPException, status
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.config import get_settings

_UPLOAD_PATH = "/api/recordings"
# Room for multipart boundaries and the small form fields that ride along with the file.
MULTIPART_OVERHEAD_BYTES = 64 * 1024


def too_large_detail(limit_bytes: int) -> str:
    size = limit_bytes / (1024 * 1024)
    return f"Request is larger than the {size:g} MB limit. Send a smaller file or request."


class BodyTooLarge(HTTPException):
    """Raised from inside `receive`. An HTTPException so FastAPI's body parsing re-raises it
    as-is (it turns any other exception into a 400) and renders it as a 413."""

    def __init__(self, limit_bytes: int) -> None:
        super().__init__(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=too_large_detail(limit_bytes),
        )


def body_limit_for(scope: Scope) -> tuple[int, int]:
    """(bytes allowed on the wire, the configured cap to name in the error)."""
    settings = get_settings()
    if scope["method"] == "POST" and scope["path"].rstrip("/") == _UPLOAD_PATH:
        cap = settings.max_upload_bytes
        return cap + MULTIPART_OVERHEAD_BYTES, cap
    return settings.max_body_bytes, settings.max_body_bytes


class BodyLimitMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        limit, cap = body_limit_for(scope)

        declared = dict(scope["headers"]).get(b"content-length", b"")
        if declared.isdigit() and int(declared) > limit:
            await _refuse(cap, send)
            return

        received = 0

        async def counting_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    raise BodyTooLarge(cap)
            return message

        started = False

        async def tracking_send(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, counting_receive, tracking_send)
        except BodyTooLarge:
            # Normally rendered by FastAPI's exception handling; this catches a read that
            # happens outside it (e.g. in another middleware).
            if started:
                raise
            await _refuse(cap, send)


async def _refuse(limit: int, send: Send) -> None:
    response = JSONResponse(
        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
        content={"detail": too_large_detail(limit)},
    )
    await response({"type": "http"}, _no_receive, send)


async def _no_receive() -> Message:
    return {"type": "http.disconnect"}
