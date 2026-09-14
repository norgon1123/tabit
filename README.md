# Tabit

Turn practice voice memos into editable chord charts.

Upload a recording, get back tempo, key, a beat grid and a chord chart laid out in bars —
then correct it, re-time it, transpose it, or hide the chords and practise naming them.
No account needed to try it: a guest gets the whole flow for one song, stored nowhere.

- **`CONTEXT.md`** — architecture, data model, the beat-native chart model, invariants.
- **`AGENTS.md`** — the operating manual for anyone (human or agent) making a change.

## Stack

Two services, one origin:

- **Backend** — FastAPI + SQLAlchemy 2.0 + Pydantic v2 (Python ≥ 3.12). librosa/numpy
  for audio analysis; SQLite by default; Argon2 passwords; server-side sessions in an
  httpOnly cookie.
- **Frontend** — React 18 + TypeScript SPA (Vite, TanStack Query, React Router). The SPA
  must be served same-origin as the API (cookie auth); in dev, Vite proxies `/api` → `:8000`.

## Setup

    python -m venv .venv && . .venv/bin/activate
    pip install -e ".[dev]"
    cd frontend && npm install

### System dependencies

**ffmpeg** (and `ffprobe`) must be on `PATH`:

- **macOS:** `brew install ffmpeg`
- **Debian/Ubuntu:** `apt install ffmpeg`

Without it, uploads succeed but analysis jobs fail with a clear error; a warning is also
logged at startup.

### Optional extras

Not needed for the base app or the tests:

    pip install --no-build-isolation -e ".[chordino]"  # Chordino engine; also needs the
                                                       # native nnls-chroma Vamp plugin
    pip install -e ".[ml]"                             # torch/demucs/mir_eval — BTC engine,
                                                       # separation, the eval harness

`[ml]` is heavy; its torch wheels come from the PyTorch index first — see the comment in
`pyproject.toml` and `docs/technical-plan-phase-0-1.md`.

## Run

Run **both** — the SPA and API have to share an origin.

    uvicorn app.main:app --reload        # API + docs at http://localhost:8000/docs
    cd frontend && npm run dev           # http://localhost:5173

## Test / build

    pytest                               # backend
    cd frontend && npm test              # Vitest + Testing Library + MSW
    cd frontend && npm run build         # tsc -b type-check, then static assets in dist/

## Config (env vars, prefix `TABIT_`)

Settings live in `app/config.py` (pydantic-settings; reads `.env`).

**Core**

- `TABIT_DATABASE_URL` (default `sqlite:///./tabit.db`)
- `TABIT_STORAGE_DIR` (default `./storage`)
- `TABIT_COOKIE_SECURE` (default `false`; `true` behind HTTPS)
- `TABIT_SESSION_COOKIE_NAME` (default `tabit_session`) /
  `TABIT_SESSION_MAX_AGE_SECONDS` (default one year)
- `TABIT_MAX_RECORDING_SECONDS` (default `600`, i.e. 10 minutes; longer uploads are
  rejected with `413`)

**Analysis**

- `TABIT_ANALYSIS_ENGINE` (default `chordino`) — `chordino` | `librosa` | `btc`, see
  *Chord engines* below
- `TABIT_ANALYSIS_SAMPLE_RATE` (default `22050` Hz; resample target for analysis)
- `TABIT_ANALYSIS_MAX_WORKERS` (default `1`; background analysis worker threads)
- `TABIT_ANALYSIS_MIN_SEGMENT_SECONDS` (default `0.75`; shorter chord segments are treated
  as false positives and absorbed into a neighbour)
- `TABIT_ANALYSIS_CHANGE_PENALTY` (default `1.0`; librosa engine's Viterbi self-stay bias —
  higher is steadier, too high merges real chords)
- `TABIT_ANALYSIS_USE_HPSS` (default `true`; librosa engine analyses the harmonic part only)
- `TABIT_CHART_BAR_PULL_BEATS` (default `0.75`) — when seeding a chart, a detected chord
  boundary within this many beats of a bar line snaps to the bar line; otherwise it snaps to
  its nearest whole beat. **Must be less than 1.0**: at 1.0 the pull swallows beats 2 and 4
  of every 4/4 bar. Manual edits are unaffected — they still snap to the half beat.

**Guest mode**

- `TABIT_GUEST_COOKIE_NAME` (default `tabit_guest`; names a logged-out visitor's in-memory
  recording — see *Guest mode*)
- `TABIT_GUEST_TTL_SECONDS` (default `3600`; a guest recording is dropped after this much
  idle time, the timer sliding on each request)

**Multi-instrument pipeline (Phase 0/1)** — all default to the app being unchanged:

- `TABIT_ANALYSIS_DEVICE` (default `auto`; `auto` → cuda → mps → cpu, or force one)
- `TABIT_ENABLE_SEPARATION` (default `false`; needs `[ml]`; only the `btc` engine consumes
  stems today)
- `TABIT_SEPARATION_MODEL` (default `htdemucs_6s`; the only 6-source Demucs model)
- `TABIT_SEPARATION_STEMS` (default `harmonic`; a preset — `harmonic` | `accomp` | `full` —
  or an explicit list such as `guitar,piano`)
- `TABIT_STEM_STORAGE` (default `persist`) / `TABIT_STEM_FORMAT` (default `flac`)

## Chord engines

Selected by `TABIT_ANALYSIS_ENGINE`:

| Engine | Needs | Fallback |
|---|---|---|
| `chordino` (default) | `[chordino]` extra + native nnls-chroma Vamp plugin | Falls back to `librosa` when the plugin is missing |
| `librosa` | nothing extra | — |
| `btc` | `[ml]` extra + staged weights under `vendor/btc/weights/`; optionally a Demucs stem | **None** — a missing dep fails the recording rather than silently downgrading |

## Analysis flow

Upload rejects anything longer than `TABIT_MAX_RECORDING_SECONDS`. The length is checked
against the browser-reported value before anything hits disk, then against `ffprobe` on the
stored file (the authoritative one — a client can under-report). If ffprobe isn't on `PATH`
the upload is allowed through and analysis fails later with the usual missing-ffmpeg error.

Uploading a recording enqueues an in-process background job that:

1. Decodes the audio to mono and records its true duration (used in place of the
   browser-reported length, so charts never run past the end of the audio)
2. Trims leading/trailing silence so the chart spans only the audible region
3. Detects BPM (rounded to a whole number) and the beat grid via beat tracking
4. Estimates key (tonic pitch class and mode)
5. Recognizes chord segments with the configured engine; segments shorter than
   `TABIT_ANALYSIS_MIN_SEGMENT_SECONDS` are dropped
6. Creates an immutable `Analysis` record with results
7. Seeds a new editable `ChordChart`: boundaries snap to whole beats (with the bar-line
   pull), chords are laid out contiguously from beat 0 and clamped to the recording's length

Poll `GET /api/recordings/{id}/analysis` to monitor the `Analysis` status:
`pending` → `running` → `done` or `failed`.

Charts are **beat-native**: segments are stored as `start_beat`/`end_beat` on the beat
grid, and seconds are derived on read. Manual edits snap to the half beat; displayed times
are rounded to the centisecond. The chart is the user's working copy — **re-running
analysis re-seeds it and overwrites manual edits.**

## Guest mode (no account)

A logged-out visitor can upload one song, have it analyzed, and edit the resulting chord
sheet — the same endpoints, the same chart, the same editing rules a signed-in user gets.
The difference is what survives:

- **Nothing is written to the database.** The recording, its analysis and its chart live in
  an in-process store (`app/guest.py`), keyed by the hash of a `tabit_guest` browser-session
  cookie.
- **The uploaded audio is deleted the moment analysis ends**, success or failure. It exists
  on disk (under `<storage>/_guest/`) only while the analyzer is reading it. Playback in the
  chord sheet therefore comes from the browser's own copy of the file, not from the server;
  `GET /api/recordings/{id}/audio` 404s for a guest once analysis is done, and re-analyzing
  means re-uploading (`POST .../analyze` answers `409`). Startup sweeps `<storage>/_guest/`
  in case a process died mid-analysis.
- **One song at a time.** Uploading while an analysis is running is refused with `409`;
  uploading after it finishes replaces the previous song. Entries also expire
  (`TABIT_GUEST_TTL_SECONDS`).

An account is what buys persistence: a library (`GET /api/recordings` is the one endpoint a
guest cannot reach — `401`), stored audio, and several songs at once.

## Practice mode

Every song opens through a choice: **chart** or **practice**. Practice shows the same chart
with the chords masked as `?`; the player names each one to reveal it. Marking is by pitch
class (Db and C# both count) with exact quality. It is read-only, client-side, and open to
everyone today — `frontend/src/practice/gate.ts` is the one place that decides who may
practise.

## API

- **Health** — `GET /api/health`
- **Auth** (`/api/auth`) — `POST /register`, `POST /login`, `POST /logout`, `GET /me`
- **Recordings** (`/api/recordings`) — `GET` (list; signed-in only), `POST` (upload, `201`),
  `GET /{id}`, `PATCH /{id}` (rename), `DELETE /{id}`, `GET /{id}/audio`,
  `GET /{id}/analysis`, `POST /{id}/analyze` (`202`; re-seeds the chart, overwriting
  manual edits)
- **Charts** (`/api`) — `POST|GET /recordings/{id}/chart`,
  `POST /charts/{id}/segments`, `PATCH /charts/{id}/segments/{sid}`,
  `PATCH /charts/{id}/segments` (batch resize), `DELETE /charts/{id}/segments/{sid}`,
  `PATCH /charts/{id}/settings` (beats per measure, measure offset, key),
  `PATCH /charts/{id}/tempo` (whole-number BPM; rescales the grid and every segment),
  `POST /charts/{id}/transpose`

Interactive docs at http://localhost:8000/docs.

## Chord-accuracy work (Phase 0/1)

Engine changes are measured, not eyeballed. The harness scores an engine against
hand-corrected MIREX `.lab` ground truth in `tests/eval/` with `mir_eval` (needs `[ml]`):

    python scripts/eval_chords.py --dataset tests/eval --engine librosa --baseline chordino
    python scripts/eval_chords.py --dataset tests/eval-stems \
        --engines deep,chordino --baseline chordino --out gate-report.md
    python scripts/bootstrap_labels.py path/to/clip.m4a --engine chordino  # starter .lab
    python scripts/validate_labels.py --dataset tests/eval                  # lint .lab files
    python scripts/separation_spike.py path/to/song.m4a --out-dir /tmp/stems
    python scripts/make_eval_stems.py --stem harmonic --out tests/eval-stems

Plans, gate and findings: `docs/multi-instrument-roadmap.md`,
`docs/technical-plan-phase-0-1.md`, `docs/phase-0-findings.md`.

## Development notes

- Tabit has **no production data**. A schema change means deleting `tabit.db` (and
  `TABIT_STORAGE_DIR` if recordings would be orphaned) and restarting — no migrations.
- Working in a git worktree? `bash scripts/setup-worktree.sh` symlinks the root `.venv`
  and `node_modules` so the branch can run.
