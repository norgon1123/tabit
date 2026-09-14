# Tabit — Context

Turn practice voice memos into editable chord charts.

## What it is

A musician uploads a practice recording (voice memo / audio file). Tabit analyzes it
into tempo (BPM), musical key, a beat grid, and a sequence of chord segments, then
produces an **editable chord chart** the user can correct, re-segment, re-time, and
transpose. The raw analysis result is kept immutable; the chart is the user's working
copy.

## Architecture

- **Backend** — FastAPI (Python ≥ 3.12), SQLAlchemy 2.0 (ORM), Pydantic v2. Audio
  analysis via librosa/numpy. Argon2 password hashing. **Server-side sessions** with a
  hashed token stored in an httpOnly cookie (`tabit_session`). SQLite by default.
- **Frontend** — React 18 + TypeScript SPA, Vite, TanStack Query, React Router.
- **Single origin** — the SPA talks to the API over REST and authenticates with the
  session cookie, so it must be served same-origin as the API. In dev, Vite proxies
  `/api` → `http://localhost:8000` to make this work.
- **Background analysis** — uploads enqueue an in-process job (thread pool, default 1
  worker); the API stays responsive while analysis runs and is polled for status.
- **Optional heavy ML** — Demucs source separation and the deep chord model live behind
  the `[ml]` extra and are imported **lazily**, so the base app installs and runs
  without torch. Same pattern for the `[chordino]` extra (native Vamp plugin).
- **Accounts are optional** — a logged-out visitor gets the whole experience for one song,
  stored nowhere. See *Guest mode*.
- **A small design system underpins the UI** — `frontend/src/ui/` (`Button`, `Stack`,
  `Card`, `Field`, `Panel`) and `frontend/src/theme/` (light/dark theming). Inline `style`
  for colour/spacing/layout is banned outside two named, justified exceptions
  (`ui/noInlineStyle.test.ts`); colour pairs and reduced-motion coverage are enforced by
  tests that read `index.css` as text, not by a separate token module. See *Frontend map*.

## Charts are beat-native

The single most important thing to know before touching chart code: **a chord segment is
stored in beats, not seconds.** `ChordSegment.start_beat` / `end_beat` are floats on a
beat grid; wall-clock times are *derived*, never stored.

- The **beat grid** (`Analysis.beat_times` → copied to `ChordChart.beat_times`) is an
  ascending list of detected beat-onset times in seconds; index *i* is beat *i*.
- `app/audio/beatgrid.py` is the only place beat↔time conversion lives
  (`time_for_beat`, `beat_for_time`, `total_beats`, `ensure_grid`, `rescale_grid`) along
  with the snapping rules (`snap_half`, `snap_chart_beat`) and `whole_bpm`. Positions
  between/beyond onsets are linearly interpolated/extrapolated. The frontend port is
  `frontend/src/chart/beatGrid.ts` (`totalBeats`, `timeForBeat`).
- The API accepts **beats** on write (`start_beat`/`end_beat`) and returns **both** beats
  and derived `start_time`/`end_time` seconds on read (`SegmentOut`).
- Editing quantizes to the **half-beat** (eighth): `snap_half` on the backend,
  `snapHalfBeat` in `frontend/src/chart/beatMath.ts`; minimum segment length 0.5 beats.
- **Seeding is stricter than editing.** When a chart is first built from an analysis,
  detected boundaries snap to **whole beats**, and a boundary within
  `TABIT_CHART_BAR_PULL_BEATS` (0.75) of a bar line takes the bar line
  (`snap_chart_beat`). The engine emits far more spurious half-beat changes than real ones;
  a player dragging a boundary does not, so manual edits keep the half-beat. The pull must
  stay `< 1.0` — at 1.0 it swallows beats 2 and 4 of every 4/4 bar.
- **The sheet's layout unit is the bar, not the chord.** A chord that vamps for eight bars
  is *one* segment in the database and eight *fragments* on screen
  (`frontend/src/chart/barLayout.ts`); the split is derived, never stored.
- Derived times are **displayed** centisecond-quantized (`roundCs` / `formatTimeCs` in
  `frontend/src/chart/timeMath.ts`).

This replaced an older seconds-native model. Any doc, comment, or memory saying segments
carry `start_time`/`end_time` *columns*, or that positions are millisecond-precision, is
describing the old schema — see *Invariants*.

## Guest mode (`app/guest.py`, `app/chart_store.py`)

Anyone can upload a song and edit its chord sheet without registering. The point is a
frictionless trial that leaves nothing behind, so a guest's data lives *only* in memory:

- A `tabit_guest` browser-session cookie names one entry in the in-process `GuestStore`
  (`GuestRecording` → `GuestAnalysis` → `GuestChart` → `GuestSegment` — dataclasses that
  mirror the ORM models' attribute names). Nothing is written to the database.
- The uploaded audio is scratch space for the analysis job: `analyze_guest_recording`
  deletes it in a `finally`, so it is gone the moment processing ends either way. Playback
  in the chord sheet uses the browser's own copy (an object URL), not the server.
- One song at a time — a second upload during analysis is a `409`; after it, a new upload
  replaces the entry. Entries expire on an idle TTL (`TABIT_GUEST_TTL_SECONDS`).
- **`ChartStore` is the seam.** Every chart endpoint resolves a `Principal` (signed-in user
  or guest) to a `DbChartStore` or a `GuestChartStore` and then runs the *same* handler, so
  the two experiences cannot drift apart. `app/chart_seed.py` holds the seeding beat math
  both analysis paths share.

An account buys persistence: a stored library (`GET /api/recordings`, the one endpoint a
guest gets a `401` from), audio kept on disk, and several songs at once.

## Backend map (`app/`)

- `main.py` — app construction, router wiring, lifespan: `create_all`, then
  `run_additive_migrations`, warns if ffmpeg is missing, purges any guest audio left on disk
  by a process that died mid-analysis (guest data doesn't survive a restart anyway), and
  shuts down the job dispatcher on exit. Health at `GET /api/health`.
- `config.py` — `TABIT_`-prefixed settings via pydantic-settings (reads `.env`).
- `db.py`, `models.py`, `schemas.py` — engine/session, ORM models, Pydantic I/O shapes.
- `migrations.py` — additive, idempotent `ALTER TABLE ... ADD COLUMN` migrations, kept from
  before the DB became disposable. Still runs on startup, but **no new ones are written** —
  a breaking schema change means dropping the DB (see *Invariants*). `scripts/migrate_beats.py`
  runs the same additive step out-of-band against a DB the app isn't currently pointed at;
  it delegates to `run_additive_migrations` rather than adding anything new.
- `deps.py`, `security.py` — DB/session dependencies, `Principal` (signed-in user *or*
  guest), current-user + owned-recording resolution, Argon2 hashing.
- `guest.py`, `chart_store.py`, `chart_seed.py` — the account-free path: the in-memory guest
  store, the user/guest storage seam the chart router talks to, and the chart seeding both
  analysis paths share (`build_chart_seed` — storage-agnostic; the whole-beat / bar-line
  snapping lives here, not in `jobs.py`).
- `storage.py` — uploaded audio under `TABIT_STORAGE_DIR` (atomic write via temp+rename);
  guest audio goes to `_guest/` and is swept at startup.
- `jobs.py` — `JobDispatcher` (thread pool), `analyze_recording`, `analyze_guest_recording`
  (in-memory, deletes the audio when done), and `_seed_chart`. `_build_analyzer` picks the
  engine from config.
- `music_theory.py` — pitch classes, `Quality`, key/transpose/roman-numeral helpers.
- `routers/` — `auth.py`, `recordings.py`, `charts.py`.
- `audio/` — the analysis pipeline:
  - `decode.py` — ffmpeg → mono float32 PCM; `ffmpeg_available()`.
  - `analyzer.py` — the three engines + `AnalysisResult`; silence trimming.
  - `beatgrid.py` — pure beat↔time conversion over the grid, plus the snapping rules
    (`snap_half` for edits, `snap_chart_beat` for seeding) and `whole_bpm`.
  - `key_estimation.py` — tonic pitch class + mode from chroma.
  - `recognizer.py` — extension-tolerant cosine template matching; per-frame emissions.
  - `decoding.py` — Viterbi decode over those emissions (`change_penalty` self-stay bias).
  - `segments.py` — `DetectedSegment` + merge / drop-short / shift helpers.
  - `chordino.py` — parse Vamp Chordino labels into Tabit chords.
  - `deep_chord.py` — `BTCChordEngine`, adapter over the vendored BTC model
    (`vendor/btc/`, weights staged out of band). Deliberately **not** swappable.
  - `separation.py` — `SeparationService`: Demucs stems (drives the released
    `pretrained`/`apply` API, not `demucs.api`).
  - `device.py` — resolves `TABIT_ANALYSIS_DEVICE` to `cuda` | `mps` | `cpu`.
  - `labels.py`, `chord_eval.py` — MIREX `.lab` interchange + `mir_eval` scoring for the
    Phase 0 accuracy harness.

## Data model (`app/models.py`)

- **User** — `username` (unique), `password_hash` (Argon2). Owns recordings + sessions.
- **Session** — server-side session: `token_hash` (the cookie carries the raw token).
- **Recording** — `original_filename`, `format`, `stored_path`, `duration_seconds`,
  `status` (default `uploaded`). 1:1 with Analysis and with ChordChart.
- **Analysis** — immutable result: `status` (`pending`/`running`/`done`/`failed`),
  `bpm`, `detected_key_tonic`, `detected_key_mode`, `engine_version`, `error`,
  `beat_times` (JSON). 1:1 per recording (`recording_id` unique).
- **ChordChart** — the editable chart: `key_tonic`, `key_mode`, `beats_per_measure`
  (default 4), `measure_offset`, `beat_times` (JSON — the chart's own copy of the grid),
  `bpm` (the working tempo — seeded from the analysis, then the user's to change; falls
  back to `Analysis.bpm` while null). 1:1 per recording.
- **ChordSegment** — `start_beat`, `end_beat` (floats, **beats**), `chord_root`,
  `chord_quality`. Ordered by `start_beat` within a chart. The output vocabulary is five
  qualities: `maj`, `min`, `dom7`, `maj7`, `min7`.

`Recording.duration_seconds` is overwritten at analysis time with the **server-decoded**
length — the browser-reported value is not trusted.

## Analysis pipeline (`app/audio/analyzer.py`, `app/jobs.py`)

The engine is selected by `TABIT_ANALYSIS_ENGINE` (default **`chordino`**):

| Engine | Class | `engine_version` | Notes |
|---|---|---|---|
| `chordino` | `ChordinoAnalyzer` | `chordino-v1` | **Default.** Vamp `nnls-chroma:chordino`. Needs the `[chordino]` extra + the native plugin; **falls back to librosa** when unavailable. |
| `librosa` | `LibrosaAnalyzer` | `hmm-v3` | Built-in, no extra deps. HPSS chroma → template scoring → Viterbi. |
| `btc` / `deep` | `BTCAnalyzer` | `btc-v1` (`+demucs-<stems>`) | Vendored BTC transformer, optionally fed a Demucs stem. Needs `[ml]` + staged weights. **Does not fall back** — a missing dep fails the recording rather than quietly using a weaker engine. |

Common flow:

1. Decode to mono at `TABIT_ANALYSIS_SAMPLE_RATE` (default 22050 Hz). The decoded PCM
   length is the authoritative `duration`.
2. Trim leading/trailing silence (`_trim_silence`), keeping the removed `lead` offset.
   Sub-0.5s edge transients (a click before the real silence) are ignored.
3. BPM + beat grid via `librosa.beat.beat_track`; onsets are **shifted back by `lead`**
   so the grid is in original-audio time. The BPM is rounded to a whole number
   (`whole_bpm`) — timing lives in `beat_times`, so the fraction buys nothing.
4. Key: tonic pitch class + mode from mean chroma.
5. Chords — engine-specific (template+Viterbi / Chordino / BTC). Segments shorter than
   `TABIT_ANALYSIS_MIN_SEGMENT_SECONDS` (0.75) are dropped as false positives.
6. Write the immutable `Analysis` (bpm, key, engine_version, beat_times).
7. `_seed_chart` → `build_chart_seed` (`app/chart_seed.py`) — build the grid, convert
   each segment's end to beats, `snap_chart_beat` (whole beat, with the bar-line pull from
   `TABIT_CHART_BAR_PULL_BEATS`), clamp to `total_beats(grid, duration)`, and lay chords
   out contiguously from beat 0. Interior chords shorter than one beat are dropped as
   collapsed boundaries; the *final* chord may be as short as a half-beat, because it clamps
   to the recording's fractional end and a real tail chord must not be lost.

Status lifecycle, polled via `GET /api/recordings/{id}/analysis`:
`pending → running → done | failed` (on failure, `Analysis.error` carries the reason).

## API surface

- **Health**: `GET /api/health`.
- **Auth** (`/api/auth`): `POST /register`, `POST /login`, `POST /logout`, `GET /me`.
- **Recordings** (`/api/recordings`): `GET ""` (list), `POST ""` (upload),
  `GET /{id}`, `PATCH /{id}` (rename), `GET /{id}/analysis`, `POST /{id}/analyze` (202),
  `GET /{id}/audio`, `DELETE /{id}`.
- **Charts** (`/api`): `POST /recordings/{rid}/chart`, `GET /recordings/{rid}/chart`,
  `POST /charts/{cid}/segments`, `PATCH /charts/{cid}/segments/{sid}`,
  `PATCH /charts/{cid}/segments` (batch resize), `DELETE /charts/{cid}/segments/{sid}`,
  `PATCH /charts/{cid}/settings` (beats-per-measure, measure offset, key tonic/mode —
  re-reads the numerals, never moves a chord),
  `PATCH /charts/{cid}/tempo` (set BPM — a whole number, rounded if not; re-indexes the
  grid, rescales every segment),
  `POST /charts/{cid}/transpose`.

Segment writes are validated against the grid: start < end, no overlap with siblings, and
`end_beat` must not exceed `total_beats(grid, duration)`.

Uploads longer than `TABIT_MAX_RECORDING_SECONDS` (default 600, 10 minutes) are rejected
with `413` — analysis cost and chart size both scale with length. The check runs twice:
against the browser-reported `duration_seconds` before anything is written to disk, then
again against the `ffprobe`-decoded length once the file is stored (the authoritative one,
since a client can under-report). If `ffprobe` can't establish a length the upload is let
through and analysis fails later with the usual missing-ffmpeg error. The frontend mirrors
the same limit (`frontend/src/library/uploadLimits.ts`) only to fail fast client-side; the
server enforces it for real.

Every one of these serves a guest as well as a signed-in user, with three exceptions that
exist because a guest has no library and no stored audio: `GET /api/recordings` (401),
`POST /{id}/analyze` (409 — re-upload instead), and `GET /{id}/audio` (404 once analysis has
finished and the file has been deleted).

## Frontend map (`frontend/src/`)

- `api/` — typed REST client (`client.ts`), `types.ts`, `music.ts`.
- `auth/` — `AuthContext` (session-cookie auth state).
- `theme/` — light/dark theming: `ThemeContext` (`useTheme`/`ThemeProvider` — persists the
  choice to `localStorage`, falls back to `prefers-color-scheme` on first visit, sets
  `data-theme` on `<html>` for the CSS to key off) and `contrast.ts` (pure WCAG 2.1 contrast
  maths, no DOM). There is no separate palette or motion module: `palette.test.ts` and
  `motion.test.ts` read `index.css` as text and assert its custom-property colour pairs
  clear AA contrast (4.5:1 text / 3:1 UI) and that every animation has a
  `prefers-reduced-motion` fallback — the stylesheet stays the single source of truth for
  both rather than a TS module the CSS could drift from.
- `ui/` — the shared component layer every screen is built from: `Button`
  (`type="button"` by default so a stray button can't submit a form; variant is a class, not
  an inline style, so it can respond to the theme), `Stack` (the one flex row/column —
  spacing travels as data attributes, never inline styles), `Card`, `Field` (the `<label>`
  wraps the control rather than pointing at it with `htmlFor`; errors are `role="alert"`),
  `Panel` (the sheet that appears beside the chart — segment editor, practice guess — takes
  focus on mount and returns it on unmount via `useReturnFocus`). `noInlineStyle.test.ts`
  enforces the rule that makes the theme system meaningful: inline `style` is banned for
  colour/spacing/layout everywhere except two named, justified exceptions (runtime-computed
  geometry in `Timeline.tsx` and `ScrubBar.tsx`).
- `pages/` — `HomePage` (the library when signed in, `GuestHomePage` when not),
  `GuestHomePage` (upload + the chord sheet on one page), `LibraryPage`, `ChartEditorPage`,
  `LoginPage`, `RegisterPage`.
- `chart/` — `ChartSheet` (the chord sheet both pages render, laid out as three zones — a
  receding context bar, the chart itself, a pinned control deck). `PlaybackContext`
  (`usePlayback`) wraps `useMediaClock` in a context so the context bar and the deck can
  share one playback clock without lifting it into every page that renders a chart.
  - Zone 1 — `ChartContextBar`: title, back link, mode actions. Dims while the song plays
    (chrome you're not using is chrome in the way when your eyes are on your hands) but
    never disappears — it stays in the DOM, focusable, one Tab away.
  - Zone 2 — `Timeline` (the chord sheet as a grid of **bars** — `buildBars` splits each
    segment into per-bar fragments; the resize handle and the `<button>` ride on the
    fragment that carries the chord's real start, the progress fill on every box of the
    active chord), `SegmentEditor`, `KeyControl` (click-to-edit key
    correction: re-reads the same chords' roman numerals against a new tonic/mode, never
    moves a chord — `PATCH /charts/{id}/settings`), `TransposeControl`, `TempoControl`,
    `TimeSignatureControl`.
  - Zone 3 — `ControlDeck`, pinned to the bottom: play/pause, `ScrubBar`, the clock, and
    whatever the sheet hands it as children (tempo/key summary, `WhereAmI`). Deliberately
    silent — no live regions — because during playback the user is listening, and speech
    competes with the music; it speaks only when spoken to (the scrubber's
    `aria-valuetext`).
  - `AnalyzingIndicator` — a spinner that only announces to a screen reader while nothing is
    playing, for the same reason the deck is silent.
  - `WhereAmI` — an on-demand "bar N, beat N" position announcement for screen-reader users.
    **Currently disabled**: its import and render are commented out in `ChartSheet.tsx`
    while the accessibility approach is reconsidered. The component and its tests are
    intact — re-enabling is a two-line restore.
  - `musicalPosition` — bar/beat-from-seconds math off the beat grid; what `WhereAmI` and
    the scrubber's `aria-valuetext` both read from.
  - `chordProgress` (paints the active chord's fill bar as a CSS transition timed to its
    remaining real time), `barLayout` (segments + meter → bars and fragments, pure and
    DOM-free), `chartLayout` (boundary-drag and resize patch ordering, so a PATCH never
    transiently overlaps a neighbour), `beatGrid` (`totalBeats`, `timeForBeat` — the port of
    `beatgrid.py`) + `beatMath` (half-beat snapping), `timeMath` (pixel↔time, centisecond
    formatting), `useChart`
    (query/mutation hook), `useRecording`, `useReanalyze`, `useMediaClock` (the underlying
    playback clock `PlaybackContext` wraps).
- `guest/` — `useGuestSong`: holds the visitor's File for playback (the server deleted its
  copy) and for re-analysis (which re-uploads it).
- `library/` — `useRecordings`, `uploadRecording` (the one upload path, guest or not),
  `UploadDropzone` (drag-and-drop or file picker), `audioDuration`, `filterSort`,
  `formatDate`, `uploadLimits` (mirrors `TABIT_MAX_RECORDING_SECONDS` so an over-long file
  is refused before it's spent on an upload; the server enforces the limit for real).
- `practice/` — learning mode: `ModeChoice` (the chart-or-practice question), `ChordGuess`
  (the answer form), `usePracticeSession` (what has been named), `answer` (marking),
  `gate` (**who may practise — the one place that decides**). See *Practice mode*.
- `components/` — `Header` (also renders `ThemeToggle`), `ProtectedRoute`,
  `AnalysisStatusBadge`, `Spinner`, `SkipLink` (off-screen-until-focused link to
  `#main-content`, first in the tab order — every screen renders inside one `<main
  id="main-content">` in `App.tsx`, which is both the skip target and a landmark for
  screen-reader navigation), `ThemeToggle` (labelled by the action it performs — e.g.
  "Switch to dark mode" — not the current state, so a screen reader can't mistake it for a
  status report).

## Practice mode (`frontend/src/practice/`)

The chart with the answers taken away: the chords render as `?`, and the player names each
one to reveal it. Analysis is unchanged — the same chart, shown differently.

- **Every song is opened through a question.** `ModeChoice` asks *chart, or practice?* on the
  chart page (`?mode=edit|practice`, so a reload keeps the answer) and on the guest home page
  (per-song state — a new upload is a new question). Neither page decides who may practise.
- **`practice/gate.ts` is the seam.** `PRACTICE_ACCESS` is `"everyone"` today, guests
  included. Flip it to `"members"` and the option renders disabled, with the reason and a
  link to register — that one constant is the whole change, and a test already covers the
  locked world. A paid tier means adding `"pro"` to the union and a flag to `UserOut`; the
  call sites already pass the user.
- **`allowedMode()` is the lock; the disabled button is only the manners.** Every route into
  a mode — the `?mode=` URL, a click on the chooser, the header toggle — goes through it, so
  a locked-out visitor who deletes the `disabled` attribute or hand-types `?mode=practice`
  still lands on the chooser. Add a route into practice mode, and route it through the gate.
- **Practice is read-only.** No resize handles, no Advanced options, no re-analyze, and tempo
  and key are printed rather than editable — you cannot practise against a chart you are
  rewriting. The roman numeral is masked too: against a key the player can see, it *is* the
  answer.
- **Marking is by pitch class** (`answer.ts`): a chart's Db is a player's C#, and both are
  right. Quality is exact — hearing the seventh is the point.
- **A chord is named the moment it is submitted**, not when the green flash ends. The flash
  decides when the *form* leaves, nothing more. Tying the reveal to the end of it loses the
  answer of any player who does the natural thing and clicks straight on to the next `?`.
- Progress lives in memory (`usePracticeSession`) and dies with the page. A guest leaves
  nothing behind, and a reload starts the song over.
- The masking is **client-side**: the chords are in the chart payload the browser already
  fetched, so devtools will show them. That is the right trade for a practice aid (playback
  and marking stay instant and offline-ish); a cheat-proof mode would need the API to serve a
  chart without chords and mark guesses server-side.

## Invariants (don't break these)

- `Analysis` is **immutable**; `ChordChart` is the editable copy.
- Re-running analysis (`POST /api/recordings/{id}/analyze`) creates a fresh `Analysis`
  and **re-seeds the chart, overwriting the user's manual edits.**
- A chart must **never exceed the recording's duration** — `end_beat` is bounded by
  `total_beats(grid, duration)`, and `duration` is the server-decoded length.
- Chart positions are **beats**, snapped to the **half-beat** on edit and to the
  **whole beat** (bar-line pull `< 1.0`) at seed time; derived times are displayed to the
  **centisecond**. (`docs/TODO.md` #7 originally asked for millisecond
  precision; Round 2 #5 reduced *display* to the centisecond, and the beat-native rewrite
  made *editing* half-beat-quantized. The code is the contract.)
- Chord boundaries should reflect the *actual* change point; leading/trailing silence
  is trimmed and ignored.
- **ffmpeg must be on `PATH`** for analysis to run (uploads succeed without it; jobs
  then fail with a clear, logged error).
- **Stored data is disposable.** Tabit is in early development with no production data, so
  the schema is free to break: the recovery for a stale DB is to drop and recreate it, not
  to migrate it. `create_all` builds missing *tables* but never adds *columns* to an
  existing SQLite file, so a schema change makes an old `tabit.db` fail — deleting it is
  the intended answer. `app/migrations.py` still runs on startup but is dormant; it comes
  back into play once there is real data to preserve.
- **A guest leaves nothing behind.** No guest data may be written to the database, and their
  audio must be deleted as soon as processing ends — that deletion is the feature, not a
  cleanup detail. Anything a guest can edit must go through `ChartStore` so the guest and
  signed-in chord sheets stay identical by construction.

## Multi-instrument work (Phase 0/1)

North star: separate a recording into instrument stems, then produce a chord chart (and
later tabs) per instrument, escaping the accuracy ceiling of chroma template matching.
Separation is the foundation layer; everything else consumes stems.

- Plans and records live in `docs/`: `multi-instrument-roadmap.md`,
  `technical-plan-phase-0-1.md`, `phase-0-findings.md`.
- The go/no-go gate is *measured*, not assumed — `scripts/eval_chords.py` scores an engine
  against ground-truth `.lab` files in `tests/eval/` via `mir_eval`.
- Status: the Demucs separation spike and the librosa-vs-chordino baseline are done; the
  deep BTC engine — the thing the gate actually turns on — is still being evaluated, so
  the decision is **not yet made**. Defaults keep the base app unchanged
  (`TABIT_ENABLE_SEPARATION=false`).
