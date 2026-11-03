# Project Constitution: tabit

> The non-negotiable principles for **tabit**. Every agent and workflow respects them.
> Operational how-to (shipping, worktrees, review, definition of done) lives in the
> policy zone of `AGENTS.md`; architecture orientation lives in `CONTEXT.md`.
> Where this file and the code disagree, that is a finding to report — not to resolve
> silently in either direction.

## Project Overview

- **Name**: tabit — turn practice voice memos into editable chord charts
- **Type**: brownfield
- **Track**: solo
- **Hosting**: self-hosted, single instance. Treat it as internet-reachable for
  security purposes.

## Technical Stack

| Concern | Choice |
|---|---|
| Language | Python ≥ 3.12 (backend), TypeScript (frontend) |
| Backend | FastAPI, Pydantic v2, pydantic-settings (`TABIT_` env prefix) |
| ORM | SQLAlchemy 2.0 |
| Database | SQLite by default (`TABIT_DATABASE_URL`) |
| Schema management | `Base.metadata.create_all` on startup. **No Alembic, no new migrations** — stored data is disposable; a breaking schema change means dropping the DB. `app/migrations.py` is dormant and frozen. |
| Auth | **Server-side sessions**: random token in an httpOnly cookie (`tabit_session`), only its hash stored. Argon2 password hashing. **Not JWT.** Guests get an in-memory session (`tabit_guest`). |
| Frontend | React 18 + TypeScript SPA, Vite, TanStack Query, React Router. Same-origin with the API. |
| Audio analysis | librosa/numpy (base); Chordino via `[chordino]` extra; BTC + Demucs via `[ml]` extra — lazily imported |
| Background work | In-process thread pool (`JobDispatcher`), polled for status |

## Architecture: modular monolith with explicit seams

Tabit is **not** layered DDD, and is not required to become it. It is a flat set of
modules organised around a few seams that carry the real invariants. The seams are the
architecture; protect them.

### Module roles

- **Pure core** — `app/audio/beatgrid.py`, `app/music_theory.py`, `app/audio/segments.py`,
  `app/chart_seed.py`. No FastAPI, no SQLAlchemy, no I/O. New business rules (chart,
  tempo, key, segment maths) go here, where they can be unit-tested without a database.
- **Storage seam** — `app/chart_store.py` (`ChartStore` → `DbChartStore` /
  `GuestChartStore`). Every chart edit goes through it so the guest and signed-in
  experiences are identical by construction.
- **Application** — `app/jobs.py` (analysis orchestration, chart seeding).
- **Adapters** — `app/audio/{analyzer,chordino,deep_chord,separation,decode}.py`,
  `app/storage.py`, `app/guest.py`, `app/db.py`, `app/models.py` (ORM models double as
  entities — accepted).
- **HTTP** — `app/routers/*`, `app/schemas.py`, `app/deps.py`. Validation, status codes,
  mapping. Existing rule checks in `routers/charts.py` are tolerated; **new** rules
  belong in the pure core.

### Invariants (breaking one is a defect)

1. **Charts are beat-native.** Segments are `start_beat`/`end_beat`; seconds are derived,
   never stored. Beat↔time conversion lives only in `app/audio/beatgrid.py`
   (backend) and `chart/beatMath.ts` / `chart/beatGrid.ts` (frontend). Half-beat snap,
   0.5-beat minimum.
2. **A chart never exceeds the recording's server-decoded duration.**
3. **`Analysis` is immutable**; `ChordChart` is the user's editable copy.
4. **BPM is a whole number** everywhere (`whole_bpm`).
5. **A guest leaves nothing behind** — no guest rows in the database, guest audio
   deleted the moment processing ends.
6. **Engine fallback is asymmetric** — `chordino` falls back to librosa; `btc` never
   falls back.
7. **Heavy dependencies stay lazy** — torch, demucs and vamp are imported inside the
   function that needs them.
8. **API shapes change on both sides together** — `app/schemas.py` and
   `frontend/src/api/types.ts`.
9. **Practice access is decided in one place** — `frontend/src/practice/gate.ts`.

### Anti-patterns

- Re-deriving beat/time maths outside the conversion modules.
- Bypassing `ChartStore` for anything a guest can edit.
- Writing guest data to the database or keeping guest audio after analysis.
- Silently downgrading the analysis engine.
- Top-level imports of optional heavy dependencies.
- Writing migration scripts while the data is disposable.
- Putting new business rules in routers or React components instead of the pure core.

## Quality Standards

- **Backend tests**: pytest — `pytest`
- **Frontend tests**: Vitest + Testing Library + MSW — `cd frontend && npm test`
- **Type-check**: `cd frontend && npm run build` (`tsc -b`)
- **Lint/format**: Ruff (`ruff check .`, `ruff format --check .`) — advisory until the
  baseline is clean; not yet a merge gate.
- All tests pass before merging.
- Every new test is watched failing first. Bug fixes start with a test that reproduces
  the bug against the real failing path, then the fix makes it pass.
- Prefer extending an existing test (extra assertion or parametrized case) over adding
  a new one; name tests for behaviour.
- Keep functions focused; prefer composition; delete dead code rather than commenting it out.
- Errors: handle at boundaries, give actionable messages, log with context, never
  swallow silently.

## Security Principles

Self-hosted does not mean trusted: guest mode exposes upload and analysis without an
account.

1. **No secrets in code** — configuration via `TABIT_` environment variables.
2. **Validate all input at the boundary** — including size and rate, not only shape.
   Every unauthenticated endpoint has a resource bound.
3. **Parameterized queries only** — via SQLAlchemy; never concatenate SQL.
4. **Least privilege** — a user reaches only their own recordings and charts.
5. **Sessions expire server-side**; cookies are `Secure` behind HTTPS.
6. **Security issues take priority over feature work.**

## Governance

- Architecture decisions that change a seam or an invariant are documented (ADR or a
  spec under `docs/`) before the code lands.
- Breaking changes are called out in the PR, including "drop your dev DB" when it applies.
- Code review (`tabit-reviewer`, plus `tabit-test-reviewer` when tests change) before
  merging to `main`.
- This constitution is amended deliberately: by a human decision, recorded in the
  amendment log below. Agents propose amendments; they do not make them unasked.

## Amendment log

| Date | Change | Decided by |
|---|---|---|
| 2026-11-03 | Replaced the generated FastAPI/DDD template (PostgreSQL, Alembic, JWT, 4-layer DDD) with the stack and architecture the code actually has. Dropped "immutable" clause in favour of this log. Added self-hosted security posture. Source: `.waypoint/specs/discovery.md` R3. | Project owner (instruction: "change the constitution to match the code") |
## Design Principles

### Design

## Before any UI work

Load, in order: `.claude/rules/design-constitution.md` →
`design/glossary/{context}.yaml` (the seam ledger for the touched context) →
the flow slice in `design/flows/` (if the task implements a flow) →
the project component registry. UI code written without these loaded fails review.

## Design triggers

A task trips a design redirect if it introduces or changes any of:

1. a user-facing noun not in the seam ledger, or a new meaning for an existing one
2. a new object type users see, or a new relationship between visible objects
3. a new user-initiated action (CTA) on any object
4. a destructive or irreversible operation
5. a new screen, surface type, or navigation entry
6. a multi-step flow, or a change to an existing flow's steps
7. a new empty/error/loading state class

NOT triggers (proceed without redirect): copy edits using ledger terms, layout
fixes inside an existing screen, styling changes inside the token vocabulary.

## Redirect protocol

On any trigger, check `design/coverage.yaml` for the touched context.
On a gap (missing/stale artifact): suggest ONCE per context+artifact per task —
"This task introduces {trigger}. Coverage for {context}.{artifact} is {state}.
Run /waypoint.design-model (or .flow) first, or proceed and the gap is enforced
at review." Proceeding writes a dated entry to `design/debt.yaml` and, for new
nouns, mints them `provisional` in the ledger. Review hard-fails on open debt,
missing/stale coverage, and nouns rejected at ratification; provisionals pass
until the next design.model run in their context, which must adjudicate them.

**Brownfield variant.** With no coverage AND a
`design/survey/env-contract.yaml` present, the redirect names the audit:
"This context ships screens the design record does not cover. Run
/waypoint.design-audit {context} to measure them, or proceed and the gap is
enforced at review." Measuring beats modelling from memory — guessing once
produced two approved mockups with the wrong page shape.

## Canonical verbs

Create (new object) · Add (attach existing) · Edit (mutate — Change/Modify/Update
banned as labels) · Save / Cancel (commit/abandon a form) · Delete (destroy —
permanent) · Remove (detach — recoverable) · View (navigate to detail — Show/
Display banned) · Duplicate · Archive / Restore · Search / Filter / Sort ·
Reorder (change sibling order — Move up/Move down banned as labels) ·
Export / Import (data-shape conversion out of/into the system) ·
Publish (make available at a stable URL, additive — corrections publish anew;
Upload banned as a label) · Download (retrieve a copy of a stored file — never
Export, which is data extraction) · Invite (people) · Assign / Unassign ·
Enroll (bind self to a track/plan) · Start (begin a session) ·
Write off (abandon a small owed amount as not collectible — gates are
policy, never confirm dialogs) · Approve / Reject (grant/refuse a GATED
action — Reject is not Cancel, which abandons your own form) ·
Enable / Disable ·
Close (dismiss, preserving state — never interchangeable with Cancel).
Button labels: canonical verb + ledger noun, 1–3 words, no articles, sentence
case. A label whose verb is not in this set fails review.

