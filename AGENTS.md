# AGENTS.md — Tabit

Operating instructions for coding agents working in this repo. Read **CONTEXT.md** first
for the architecture and data model; this file is the *how-to-work* manual.

<!-- ═══════════════════════════════════════════════════════════════════════════════
     POLICY ZONE — hand-maintained. Humans own everything above the GENERATED marker.

     `/tabit-context-docs` MUST NOT rewrite this zone. These are decisions, not facts
     read off the code, so the code cannot be used to "correct" them. If the code
     contradicts a rule here, that is either a bug in the code or a policy that needs
     a human to change it — REPORT the conflict, do not resolve it.
     ═══════════════════════════════════════════════════════════════════════════════ -->

## Shipping a change

- **The base branch is `main` unless the task explicitly names another one.** Do not
  guess, and do not infer a base from whichever branch happens to be checked out. If the
  task is ambiguous, ask before opening the PR — landing on the wrong base has cost this
  repo a duplicate ship.
- **Rebase on the base branch before you open the PR:**

      git fetch origin && git rebase origin/main

  Several changes at a time may be in flight against the same files. If you hit conflicts,
  resolve them and say so in the PR body. **Do not open a PR you already know conflicts** —
  a conflict you resolve now costs minutes; one discovered at merge time costs a round trip.
- One PR per task. Keep the file footprint as small as the task allows; a change that
  sprawls across the chart editor will collide with whatever else is in flight.
- Never push to `main`, never force-push, never merge your own PR.

## Working in a worktree

Worktrees under `.claude/worktrees/` share git history but **not** ignored artifacts, so a
fresh one has no `.venv` and no `frontend/node_modules`. `scripts/setup-worktree.sh` fixes
that automatically on session start (it is wired to a `SessionStart` hook in
`.claude/settings.json`). Run it by hand if anything looks unbootstrapped:

    bash scripts/setup-worktree.sh

It **symlinks** the root checkout's `.venv` and `frontend/node_modules` rather than
reinstalling them — the venv is ~5GB and there are 20+ worktrees. This is safe for imports:
`app` resolves from the worktree's own tree, because setuptools' editable finder is appended
*after* `PathFinder` on `sys.meta_path`. If this branch changes `pyproject.toml` or the
frontend lockfile, the script detects the drift and does a real private install instead.

> **Do not run `pip install -e .` from inside a worktree** while `.venv` is a symlink. It
> would repoint the *root* checkout's editable install at your branch and quietly break
> everyone else. If you genuinely need a private environment, delete the `.venv` symlink
> first and let the setup script build you a real one.

## Review before you ship

For any non-trivial change, dispatch the **`tabit-reviewer`** subagent before opening the
PR, and act on what it finds.

It is read-only and adversarial on purpose. You cannot reliably review your own work — you
are conditioned by the same reasoning that produced the bug, so the defects you left are
precisely the ones you cannot see. A fresh reviewer has uncorrelated blind spots. This has
already paid for itself here: a review pass caught three tests in this repo that *could not
fail*, and another caught a critical bug where a correct answer was silently discarded.

If your change **adds or modifies any test**, also dispatch the **`tabit-test-reviewer`**
subagent before the PR, and act on what it finds. It is a *different* review from
`tabit-reviewer`: that one asks whether a test is correct and can fail; this one asks
whether the test should exist at all or belongs inside one that already does. Both are
required when tests change (see *Definition of done*).

## Adding tests: enhance before you add

A test suite is documentation — a reader should be able to learn what a unit is *supposed
to do* from the tests covering it. Every redundant test dilutes that signal and costs
maintenance. So **adding a test is a decision, not a reflex.** Before you write a new one,
the burden is on proving it cannot instead be an extra assertion, or an extra case
(`@pytest.mark.parametrize` / `it.each`) on a test that already exists. Reach for a new
test only when it carries intent the suite does not already cover — and when you do, name
it for the *behaviour*, not the function.

This is a judgement call — intent, setup cost, readability, failure isolation — and it is
easy to get wrong in the direction of "just add another test". The **`/tabit-test-review`**
skill holds the decision procedure; run it whenever you are about to add tests, and see the
mandatory review under *Definition of done*. (Fewer tests is a means, not the goal: don't
cram unrelated behaviours into one test to cut the count — a failure must still name its
cause.)

## Rules that bite (enforce in any chart/analysis change)

- A chart's total length must **never exceed the recording's duration**. `end_beat` is
  bounded by `total_beats(grid, duration)`, where `duration` is the *server-decoded*
  length (`Recording.duration_seconds`), not the browser-reported one.
- **Charts are beat-native.** Segments are stored as `start_beat`/`end_beat` on a beat
  grid; seconds are derived, never persisted. Positions snap to the **half-beat**
  (minimum segment 0.5 beats); derived times are **displayed to the centisecond**
  (`roundCs`/`formatTimeCs`). If you see "millisecond precision" in an older note, it is
  stale — `docs/TODO.md` #7 was superseded by Round 2 #5 (centisecond display) and then by
  the beat-native rewrite.
- **Beat↔time conversion lives in exactly one place per side** — `app/audio/beatgrid.py`
  (`time_for_beat`, `beat_for_time`, `total_beats`, `snap_half`) on the backend,
  `chart/beatMath.ts` / `chart/beatGrid.ts` on the frontend. Don't re-derive it inline, and
  don't reintroduce seconds-valued segment columns.
- **BPM is a whole number** everywhere it is detected, stored, sent or shown — a tempo is
  something a player counts, not a measurement. Round through `whole_bpm`
  (`app/audio/beatgrid.py`); the API rounds a fractional `PATCH .../tempo` rather than
  rejecting it, and rounds charts analysed before this rule on the way out. Timing accuracy
  lives in `beat_times`, never in this number, so rounding costs nothing.
- Chord boundaries must reflect the real change point; trim leading/trailing silence.
- **`Analysis` is immutable** — never mutate an existing analysis record; create a new one.
- Re-running analysis (`POST /api/recordings/{id}/analyze`, 202) **overwrites the user's
  manual chart edits** — call this out explicitly if your change touches that path.
- ffmpeg is required at runtime for analysis; don't assume it's present in code paths
  that can run without it.
- **Engine fallback is deliberate and asymmetric:** `chordino` **falls back** to librosa
  when the native plugin is missing; `btc` **must not** — a missing dep fails the recording
  rather than silently downgrading to a weaker engine. Don't "helpfully" add a fallback.
- **Heavy deps stay lazy.** torch/demucs/`vamp` are optional extras — import them inside
  the function that needs them, never at module top level, so the base app keeps installing
  and running without them.
- **New API fields land on both sides:** update `app/schemas.py` **and**
  `frontend/src/api/types.ts` together.

## Schema changes: the data is disposable

Tabit is in **early development and has no production data.** Data-breaking changes are
therefore **fine and expected** — schema is free to change shape whenever the design calls
for it. Don't contort a model to stay backward-compatible with rows already on disk.

- **Do not write migration scripts.** Not Alembic, not new additive `ALTER TABLE` steps in
  `app/migrations.py`. They are not required and not wanted at this stage.
- **The fix for a stale local DB is to delete it**, not to migrate it. Drop the SQLite file
  (`tabit.db`, per `TABIT_DATABASE_URL`) and restart — `Base.metadata.create_all()` in the
  `main.py` lifespan rebuilds the schema from `app/models.py`. Clear `TABIT_STORAGE_DIR`
  too if stored recordings would be orphaned by the change.
- **Say so in the change.** If your change breaks existing rows, state plainly that the dev
  DB must be dropped and recreated — don't let a teammate discover it as an ORM error.
- `app/migrations.py` still exists and still runs on startup; leave the migrations already
  in it alone. It is dormant until Tabit has real data to preserve, at which point this rule
  gets revisited (see `docs/multi-instrument-roadmap.md`).

## Definition of done

- The relevant test suite passes (`pytest` and/or `cd frontend && npm test`); frontend
  changes type-check (`npm run build`).
- New behavior has tests in the matching suite (backend `tests/`, frontend colocated
  `*.test.ts(x)`).
- **Every new test has been watched failing** — against the un-fixed code, or with the new
  behavior reverted. A test you have only reasoned about is not yet a test.
- **If the change adds or modifies tests, the `tabit-test-reviewer` subagent has reviewed
  them and its findings are addressed** — a new test that should have been a parametrized
  case or an added assertion is a finding, not a nit. See *Adding tests: enhance before you
  add*.
- The `tabit-reviewer` subagent has reviewed the change and its findings are addressed.
- Rebased on the base branch, conflict-free (see *Shipping a change*).
- Env/config changes are reflected in `app/config.py` and documented in `README.md`.
- **If you added or removed a module, endpoint, or `TABIT_` env var, run
  `/tabit-context-docs`** so CONTEXT.md and the generated half of this file stay true.
- Don't silently regress the open items in `docs/TODO.md`.

### Bug fixes specifically

A bug fix is **not done** until all of the following hold:

1. **Reproduced.** You can trigger the reported failure yourself and have identified the
   root cause — not just the symptom. State the root cause in the change. If you *cannot*
   reproduce it, stop and say so — do not fix a bug you have not seen.
2. **Failing test first.** A test in the matching suite reproduces the bug and *fails for
   the right reason* before the fix (watch it fail). The reproduction must exercise the
   real failing path, not a mock of it.
3. **Proven by that test.** The same test passes after the fix, and the full relevant
   suite still passes.
4. **Fixed at the root, not the symptom.** Patching one stale database or one call site
   is not a fix — make the code self-correct so the failure can't recur (e.g. the bug is
   fixed in the app, not by hand-editing data).
5. **Regression locked in.** The new test stays in the suite so the bug can't silently
   return.

> Schema gotcha that has bitten deletes before: `Base.metadata.create_all()` creates
> missing *tables* but never adds *columns* to existing ones, so a pre-existing SQLite DB
> keeps its old schema and the ORM fails on the new column. The remedy is to **delete the
> DB file and let it be recreated** (see *Schema changes: the data is disposable*) — not to
> write a migration. Note the distinction from rule 4 above: recreating a dev DB whose
> *schema* is stale is the intended workflow, but hand-editing *rows* to paper over a bug in
> the code is not a fix.

<!-- ═══════════════════════════════════════════════════════════════════════════════
     ▼▼▼ GENERATED BELOW — DO NOT HAND-EDIT ▼▼▼

     Everything from here down is regenerated from the code by `/tabit-context-docs`.
     Hand edits will be overwritten on the next run.

     This zone holds FACTS read off the code (commands, module map, env vars).
     If you want to add a durable RULE, put it in the policy zone above — that is the
     only part of this file that survives regeneration.
     ═══════════════════════════════════════════════════════════════════════════════ -->

## Prerequisites

- Python ≥ 3.12 and Node (for the frontend).
- **ffmpeg on `PATH`** — required for audio analysis. `brew install ffmpeg`
  (macOS) / `apt install ffmpeg` (Debian/Ubuntu). Without it, uploads work but analysis
  jobs fail with a clear error.

## Setup

    python -m venv .venv && . .venv/bin/activate
    pip install -e ".[dev]"
    cd frontend && npm install

In a worktree, run `bash scripts/setup-worktree.sh` instead — see *Working in a worktree*.

Optional extras — **not** needed for the base app, tests, or most changes:

    pip install --no-build-isolation -e ".[chordino]"  # Tier 2 engine; also needs the
                                                       # native nnls-chroma Vamp plugin
    pip install -e ".[ml]"                             # torch/demucs/mir_eval (Phase 0/1)

`[ml]` is heavy and its torch wheels are installed from the PyTorch index first — see the
comment in `pyproject.toml` and `docs/technical-plan-phase-0-1.md`.

## Run

- Backend: `uvicorn app.main:app --reload` — API docs at http://localhost:8000/docs
- Frontend: `cd frontend && npm run dev` — http://localhost:5173 (proxies `/api` → :8000)
- Run **both** for a working app: cookie auth needs the SPA and API to be same-origin,
  which the dev proxy provides.

## Test

- Backend: `pytest` — config in `pyproject.toml` (`testpaths = ["tests"]`, `-v`).
- Frontend: `cd frontend && npm test` — Vitest (jsdom) + Testing Library + MSW. Tests
  are colocated as `*.test.ts(x)` next to the source they cover.

## Build

- Frontend: `cd frontend && npm run build` — runs `tsc -b` (type-check) then emits
  static assets to `frontend/dist/`. Use this to verify TS changes type-check.

## Where code lives

- **Backend** — REST handlers in `app/routers/` (auth → `/api/auth`, recordings →
  `/api/recordings`, charts → `/api`); audio logic in `app/audio/`; Pydantic request/
  response shapes in `app/schemas.py`; ORM models in `app/models.py`.
- **Frontend** — data fetching through TanStack Query hooks (`useChart`, `useRecordings`).
  Beat math in `chart/beatMath.ts` (half-beat snap) / `chart/beatGrid.ts` (`totalBeats`,
  `timeForBeat` — the port of `beatgrid.py`); pixel↔time and time formatting in
  `chart/timeMath.ts`; segments+meter → bars/fragments in `chart/barLayout.ts`
  (`buildBars`); boundary-drag / resize patch math in `chart/chartLayout.ts`. Chart seeding
  (whole-beat snap with the bar-line pull) is backend-only: `app/chart_seed.py` +
  `snap_chart_beat` in `app/audio/beatgrid.py`. Shared UI components live in `ui/`
  (`Button`, `Stack`, `Card`, `Field`, `Panel`); light/dark theming in `theme/`
  (`ThemeContext`, `contrast.ts`). See `CONTEXT.md` for the chart page's three-zone layout
  (`ChartContextBar` / `Timeline` / `ControlDeck`) and the no-inline-style rule
  `ui/noInlineStyle.test.ts` enforces.

## Configuration

Config is env-driven, prefix `TABIT_` (`app/config.py`). Don't hardcode paths or secrets.

- Core: `TABIT_DATABASE_URL`, `TABIT_STORAGE_DIR`, `TABIT_COOKIE_SECURE` (`true` behind
  HTTPS), `TABIT_MAX_RECORDING_SECONDS` (600; uploads longer than this are rejected with
  `413`), `TABIT_ANALYSIS_SAMPLE_RATE` (22050), `TABIT_ANALYSIS_MAX_WORKERS` (1),
  `TABIT_ANALYSIS_MIN_SEGMENT_SECONDS` (0.75), `TABIT_ANALYSIS_CHANGE_PENALTY` (1.0),
  `TABIT_ANALYSIS_USE_HPSS` (true), `TABIT_ANALYSIS_ENGINE`
  (`chordino` | `librosa` | `btc`), `TABIT_CHART_BAR_PULL_BEATS` (0.75; seed-time
  bar-line pull; `snap_chart_beat` rejects values ≥ 1.0).
- Session: `TABIT_SESSION_COOKIE_NAME`, `TABIT_SESSION_MAX_AGE_SECONDS`.
- Guest: `TABIT_GUEST_COOKIE_NAME`, `TABIT_GUEST_TTL_SECONDS`.
- Multi-instrument: `TABIT_ANALYSIS_DEVICE` (`auto`), `TABIT_ENABLE_SEPARATION` (false),
  `TABIT_SEPARATION_MODEL`, `TABIT_SEPARATION_STEMS`, `TABIT_STEM_STORAGE`,
  `TABIT_STEM_FORMAT`.

## Chord-accuracy work (Phase 0/1)

Changing a chord engine? **Measure it, don't eyeball it.** The harness scores predictions
against hand-corrected MIREX `.lab` ground truth in `tests/eval/` using `mir_eval`
(needs the `[ml]` extra):

    # single engine vs baseline (spike 0.1)
    python scripts/eval_chords.py --dataset tests/eval --engine librosa --baseline chordino

    # A/B/C gate report (spike 0.3): deep on stem vs deep on mix vs chordino
    python scripts/eval_chords.py --dataset tests/eval-stems \
        --engines deep,chordino --baseline chordino --out gate-report.md

    python scripts/bootstrap_labels.py path/to/clip.m4a --engine chordino  # starter .lab
    python scripts/validate_labels.py --dataset tests/eval   # lint .lab files before scoring
    python scripts/separation_spike.py path/to/song.m4a --out-dir /tmp/stems
    # build a stem dataset for the deep-model stem condition (spike 0.3)
    python scripts/make_eval_stems.py --stem harmonic --out tests/eval-stems

Against `--baseline`, `eval_chords.py` reports the per-clip **win rate** and a bootstrap
CI on the duration-weighted majmin delta — the eval set is small enough that one or two
clips can swing the average — with a PASS verdict only once the CI's lower bound clears
`--gate-margin`. Record findings in `docs/phase-0-findings.md`; the plan and gate live in
`docs/technical-plan-phase-0-1.md` and `docs/multi-instrument-roadmap.md`.
