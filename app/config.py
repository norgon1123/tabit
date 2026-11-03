from functools import lru_cache
from typing import Literal
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="TABIT_", env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./tabit.db"
    storage_dir: str = "./storage"
    session_cookie_name: str = "tabit_session"
    session_max_age_seconds: int = 60 * 60 * 24 * 365  # 1 year ("stay logged in")
    cookie_secure: bool = False  # set True behind HTTPS in production
    # "development" or "production". Production refuses to start with insecure cookies
    # (check_production_safety) — a session cookie sent over plain HTTP can be sniffed.
    # A Literal so a near-miss ("prod", "Production") fails validation instead of quietly
    # skipping the check.
    environment: Literal["development", "production"] = "development"
    # Hard cap on an upload's size in bytes. Duration is client-reported and optional, so
    # only the byte size can bound memory and disk — and guests upload without an account.
    # 200 MB fits a 10-minute 48 kHz / 24-bit stereo WAV with room to spare.
    max_upload_bytes: int = 200 * 1024 * 1024
    # Cap for every non-upload request body (all JSON). Enforced on the stream, so an
    # unauthenticated login cannot carry megabytes into the JSON parser.
    max_body_bytes: int = 1024 * 1024
    # Per-client request budgets (sliding window, in-process). 0 disables a limit.
    # Behind a reverse proxy, start uvicorn with --forwarded-allow-ips=<the proxy's IP> so
    # the client IP comes from X-Forwarded-For; otherwise every visitor shares the proxy's
    # budget. Never use "*" while the app port is reachable directly — anyone could then
    # forge X-Forwarded-For and dodge the limit.
    auth_rate_limit: int = 10  # login + register attempts...
    auth_rate_window_seconds: float = 60.0  # ...per minute
    upload_rate_limit: int = 20  # uploads...
    upload_rate_window_seconds: float = 60.0 * 60  # ...per hour
    # Guest mode: try Tabit without an account. The cookie names the visitor's single
    # in-memory recording (app/guest.py); it is a browser-session cookie (no max-age) and
    # the entry is dropped after this much idle time. Nothing guest-related is ever written
    # to the database, and the uploaded audio is deleted the moment analysis finishes.
    guest_cookie_name: str = "tabit_guest"
    guest_ttl_seconds: float = 60 * 60  # 1 hour idle, sliding on each request
    # Uploads longer than this are rejected outright (413) — analysis cost and chart size
    # both scale with length, so a long file is refused at the door rather than half-processed.
    max_recording_seconds: float = 600.0  # 10 minutes
    analysis_sample_rate: int = 22050  # Hz; resample target for analysis
    analysis_max_workers: int = 1  # background analysis threads
    # Round 2 #1: chord segments shorter than this are treated as false positives and
    # absorbed into a neighbour. Easily tuned via TABIT_ANALYSIS_MIN_SEGMENT_SECONDS.
    analysis_min_segment_seconds: float = 0.75
    # Seed-time chord-boundary snapping. A detected boundary within this many beats of a bar
    # line takes the bar line; otherwise it takes its nearest whole beat. MUST be < 1.0 — at
    # 1.0 the pull swallows beats 2 and 4 of every 4/4 bar (they sit exactly 1.0 from a bar
    # line) and a one-chord-per-beat bar collapses into a single chord.
    chart_bar_pull_beats: float = 0.75
    # Tier 1: Viterbi self-stay bias. Higher = steadier labels, absorbs more playing
    # mistakes; too high merges genuinely distinct chords.
    analysis_change_penalty: float = 1.0
    # Tier 1: run harmonic/percussive separation and analyse the harmonic part, so
    # percussion and pick/string noise stop polluting the chroma. Disable to A/B.
    analysis_use_hpss: bool = True
    # Chord engine, set with TABIT_ANALYSIS_ENGINE:
    #   "chordino" - Tier 2; needs the vamp module + the nnls-chroma Vamp plugin. Default:
    #                markedly more accurate than librosa on real recordings, and it falls
    #                back to librosa when the plugin is missing.
    #   "librosa"  - the built-in HPSS-chroma + Viterbi engine (no extra deps).
    #   "btc"      - Tier 3; the pretrained BTC transformer, optionally fed a Demucs stem
    #                (see enable_separation). Needs the ".[ml]" extra and staged weights
    #                under vendor/btc/weights/; it does NOT fall back — a missing dep fails
    #                the recording with a message rather than quietly using a weaker engine.
    analysis_engine: str = "chordino"

    # --- Multi-instrument pipeline (Phase 0/1) ---
    # Compute backend for torch-based analysis (Demucs separation, deep chord model).
    # "auto" resolves cuda -> mps -> cpu; force with "cuda" | "mps" | "cpu".
    analysis_device: str = "auto"
    # Source separation. Off by default so the base app is byte-for-byte unchanged;
    # enabling it requires the ".[ml]" extra (Demucs) to be installed. Only the "btc"
    # engine consumes stems today: engine=btc + enable_separation=true is the full
    # demucs -> btc pipeline; engine=btc alone runs the model on the raw mix (the control).
    enable_separation: bool = False
    # Demucs model. htdemucs_6s is the only 6-source model (adds guitar + piano stems).
    separation_model: str = "htdemucs_6s"
    # Which stems feed the chord model: a preset from separation.STEM_PRESETS
    # ("harmonic" = guitar+piano+other, "accomp" = + bass, "full" = the whole mix) or an
    # explicit comma-separated source list, e.g. "guitar,piano".
    separation_stems: str = "harmonic"
    # Stem persistence policy (Phase 1). "persist" keeps stems on disk (Option A, the
    # Phase 0/1 recommendation — never recompute the expensive separation step);
    # "ephemeral" would regenerate on demand. Swappable later without a schema change.
    stem_storage: str = "persist"
    # On-disk codec for persisted stems. FLAC (lossless) by default — lossy formats add
    # artifacts that degrade downstream chord/tab analysis.
    stem_format: str = "flac"


@lru_cache
def get_settings() -> Settings:
    return Settings()


def check_production_safety(settings: Settings) -> None:
    """Refuse a production configuration that would leak session cookies over plain HTTP."""
    if settings.environment == "production" and not settings.cookie_secure:
        raise RuntimeError(
            "TABIT_ENVIRONMENT=production requires TABIT_COOKIE_SECURE=true: serve Tabit "
            "over HTTPS and set it, or session cookies travel in clear text."
        )
