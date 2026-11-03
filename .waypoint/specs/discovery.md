# Discovery — tabit (brownfield)

- **Date**: 2026-11-03
- **Agent**: analyst
- **Scope**: first WayPoint pass over an existing codebase. Goal: map what exists,
  where the WayPoint scaffold disagrees with it, and what blocks the next
  `/waypoint.specify` / `/waypoint.architect` run.
- **Sources**: `CONTEXT.md`, `HEAD:AGENTS.md`, `docs/` (INITIAL-REVIEW, phase-4-audit,
  TODO, multi-instrument roadmap), `docs/superpowers/{specs,plans}`, `app/`, `pyproject.toml`,
  `architecture/tabit.yaml`, `design/`, uncommitted working-tree diff on `main`.

## 1. Context

Tabit turns practice voice memos into editable, beat-native chord charts.
Upload → background analysis (BPM, key, beat grid, chord segments) → immutable
`Analysis` → editable `ChordChart` (re-segment, re-time, transpose, re-key) →
optional practice mode (chords masked, player names them). Guests get the full
flow for one song, held only in memory.

Status: solo, early development, no production data ("stored data is disposable").
Active R&D thread: multi-instrument / stem-separation (Phase 0/1), go/no-go on
the deep BTC chord engine **not yet decided**.

## 2. Landscape

### Stack (actual)

| Concern | Actual | WayPoint scaffold claims |
|---|---|---|
| Backend | FastAPI, Python ≥3.12, Pydantic v2 | FastAPI ✓ |
| ORM | SQLAlchemy 2.0 | SQLAlchemy ✓ |
| Database | **SQLite** (`tabit.db`) | PostgreSQL ✗ |
| Migrations | `create_all` + dormant additive `app/migrations.py`; drop DB on schema break | `alembic upgrade head`, `alembic/`, `alembic.ini` ✗ (none exist) |
| Auth | **Server-side sessions**, hashed token in httpOnly cookie, Argon2 | JWT ✗ |
| Layout | Flat modules (`app/*.py`, `routers/`, `audio/`) | DDD 4-layer ✗ |
| Frontend | React 18 + TS + Vite + TanStack Query SPA (`frontend/`) | not described |
| Analysis | librosa / Chordino (Vamp) / vendored BTC + Demucs (`[ml]`, lazy) | not described |
| Tests | pytest (`tests/`, eval harness `tests/eval/`), Vitest frontend | pytest ✓ |
| Lint | — (no ruff config, ruff not installed) | Ruff ✗ |

### Module map → DDD layer (as-is)

| Module | Plays role of | Notes |
|---|---|---|
| `app/audio/beatgrid.py`, `music_theory.py`, `audio/segments.py`, `chart_seed.py` | Domain (pure) | Pure functions; already dependency-free. Best domain candidates. |
| `app/models.py` | Domain entities **+** ORM mapping | Entities are SQLAlchemy-mapped → "Domain Layer Database Dependency" anti-pattern by constitution's definition. Largely anemic. |
| `app/routers/charts.py` | Presentation **+** domain rules | Overlap check, duration bound, tempo rescale, transpose loop live in the router → "Leaking Domain Logic". |
| `app/chart_store.py` (`ChartStore`, `DbChartStore`, `GuestChartStore`) | Port + adapters | Real hexagonal seam already; user/guest parity by construction. |
| `app/jobs.py` | Application service | Orchestrates analyze → seed. |
| `app/audio/analyzer.py`, `chordino.py`, `deep_chord.py`, `separation.py`, `decode.py` | Infrastructure adapters | Engine selected by config; BTC deliberately not swappable. |
| `app/guest.py`, `storage.py`, `db.py` | Infrastructure | In-memory guest store; disk storage. |
| `app/schemas.py`, `routers/*` | Presentation | |

**Bounded contexts (candidate)**: `identity` (users, sessions), `library`
(recordings, upload, storage), `analysis` (engines, beat grid, key, immutable
result), `chart` (editable chart, segments, tempo/key/transpose), `practice`
(frontend-only today, gated by `practice/gate.ts`).

### Invariants (from CONTEXT.md — must survive any refactor)

1. `Analysis` immutable; `ChordChart` is the editable copy.
2. Segments are **beats**, half-beat snapped; seconds derived only via `beatgrid.py`.
3. Chart never exceeds server-decoded duration.
4. Guest leaves nothing behind; guest audio deleted when processing ends; all guest edits go through `ChartStore`.
5. Re-analyze re-seeds chart, overwriting edits.
6. `practice/gate.ts::allowedMode()` is the single access lock.

### Documentation inventory

- Strong: `CONTEXT.md` (architecture, auto-refreshed by `.github/workflows/context-docs.yml`
  via `tabit-context-docs` skill), 7 specs + 11 plans in `docs/superpowers/`.
- Empty WayPoint records: `architecture/tabit.yaml` (all TODO), `design/coverage.yaml`
  (no contexts), `design/glossary` + `design/screens` (starters only), manifest `documents: {}`.

## 3. Risks

Severity: **H** fix before next WayPoint action / exposure · **M** before real use · **L** polish.

| # | Sev | Area | Risk | Evidence |
|---|---|---|---|---|
| R1 | **H** | Repo / process | `waypoint init` **overwrote hand-maintained `AGENTS.md`** (policy zone: base-branch rule, rebase-before-PR, worktree setup, "never resolve policy from code") with a generic WayPoint template. Uncommitted. Committing it loses team policy; `tabit-context-docs` CI also owns the generated half. | `git diff AGENTS.md` (−262/+151) |
| R2 | **H** | Repo / process | `.env.example` **deleted** in working tree (uncommitted). | `git status`: ` D .env.example` |
| R3 | **H** | Governance | WayPoint scaffold describes a different system (Postgres, Alembic, JWT, DDD layers, Ruff). Agents following `CLAUDE.md` will run `alembic upgrade head`, add JWT, or "fix" sessions. Constitution marked **immutable**, so the mismatch can't be edited away without an exception record. | §2 table; `CLAUDE.md`, `.claude/rules/constitution.md` |
| R4 | **H** | Governance | Review gates will hard-fail all existing UI: no design coverage, no glossary, no `design/survey/env-contract.yaml` → every UI touch trips a redirect + writes debt. | `design/coverage.yaml` empty |
| R5 | **H** | Security | **No upload byte cap.** `file.file.read()` loads whole body; only duration (client-supplied, optional) is pre-checked. Now reachable **unauthenticated** via guest mode. | `app/routers/recordings.py:90` |
| R6 | **H** | Security | No rate limiting on `/login`, `/register`, or guest upload; open registration, no toggle. | grep: no limiter; INITIAL-REVIEW #2 still open |
| R7 | M | Security | Sessions never expire server-side (1-year cookie, DB row lives until logout). | `config.py:11`; `models.Session` has no expiry |
| R8 | M | Security | `cookie_secure=False` default, no prod guard. | `config.py:12` |
| R9 | M | Deploy | No SPA static mount / no CORS → no prod deploy story; same-origin required. | `main.py` |
| R10 | M | Arch | Domain rules in routers + ORM-mapped entities conflict with constitution's DDD rules; any `/waypoint.review` will flag them. Refactor touches the beat-native core — high regression risk. | `routers/charts.py:86,92,184,251-283` |
| R11 | M | Data | Re-analyze silently overwrites manual edits; no confirm found in frontend. Constitution severity ladder would class this `irreversible` → confirm dialog required. | INITIAL-REVIEW #9; no `confirm`/`overwrite` match in `frontend/src` |
| R12 | M | Env | Local `.venv` symlinks to a macOS Python 3.14 → unusable in the container; system Python 3.12 lacks pytest/deps. **Test suite could not be run in this discovery.** | `.venv/bin/python3.14 -> /Library/Frameworks/...` |
| R13 | M | Product | Multi-instrument direction hinges on an undecided BTC go/no-go; specs built on chord accuracy assumptions may be invalidated. | `docs/phase-0-findings.md`, CONTEXT.md |
| R14 | L | Auth | `verify_password` catches only `VerificationError`; malformed hash → 500. | `app/security.py:17` |
| R15 | L | Repo | Binary fixture `tests/Simple I V IV I.m4a` (127 KB) staged; root `node_modules/` (WayPoint tooling) untracked and not in `.gitignore`. | `git status`, `.gitignore` |
| R16 | L | A11y | `WhereAmI` disabled; real screen-reader / device passes still owed. | `docs/phase-4-audit.md` §"Still owed" |

## 4. Open questions (need a human decision)

1. **Constitution vs reality** — amend constitution to SQLite + cookie sessions + current
   layout (needs exception record, since "immutable"), or commit to migrating toward it
   (Postgres, Alembic, DDD layering)? Every downstream WayPoint action depends on this.
2. **AGENTS.md** — restore `HEAD:AGENTS.md` and merge WayPoint's content into the
   generated zone, or keep WayPoint's version?
3. **`.env.example` deletion** — intentional?
4. **DDD target** — strangler (extract `chart` domain first: `beatgrid`, `music_theory`,
   segment rules out of `routers/charts.py`), or accept current pragmatic layout and
   record as ADR?
5. **Design record** — run `/waypoint.design-audit` per context to back-fill coverage, or
   accept review debt for now?
6. **Exposure timeline** — is internet exposure planned? Decides whether R5–R8 jump the queue.

## 5. Recommended next steps

1. Resolve R1/R2 before any commit on `main`: `git checkout HEAD -- AGENTS.md .env.example`, then re-add WayPoint pointers below the GENERATED marker.
2. Decide Q1; then `/waypoint.constitute` to record it (fixes R3).
3. Fill `architecture/tabit.yaml` (contexts in §2, invariants as `rules`) via `/waypoint.architect`.
4. Fix env (`scripts/setup-worktree.sh` or fresh Linux venv + `pip install -e ".[dev]"`), add Ruff config, get green baseline.
5. Security spec: upload byte cap, rate limiting, session expiry, prod cookie guard (R5–R8) → `/waypoint.specify security-hardening`.
6. Design audit for `chart` + `library` contexts before next UI work (R4, R11).
