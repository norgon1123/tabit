# DESIGN.md

> Restraint is the doctrine: less, but better. Structure comes from the seam ledger and the object map; taste comes from budgets, not judgment.

> Generated projection — override upstream, not here. Full doctrine: `.claude/rules/design-constitution.md`.

## The cadence

Propose → direct → record → confirm → approve → build. Every design decision
is presented as a picture (ASCII wireframe, object/ER diagram, nav tree) —
≥2 alternatives with plain-language trade-offs at divergence points. YAML is
the record of a decision, never its presentation. Agents end their turn at
every proposal point (at most one unreviewed proposal per context), never
pick an alternative, never stamp ratified, never approve a mockup; unable to
present to a human this turn = unattended: stop at proposed/provisional.
Skipping a pause requires explicit developer direction and writes debt.

## Presentation ladder

Pauses (proposal required): the trigger list, plus tab organization ·
list-view structure (columns, card fields, filters, sort) · detail-view
layout · CTA placement and grouping · navigation changes · token changes.
Proceeds without a pause: changes inside an already-approved wireframe using
already-approved patterns.
Mockup gate: code for a new or structurally changed screen exists only after
a human approves its static HTML mockup (registry + tokens + fixtures, no
logic); approval is content-hashed across the screen and its slices. Comments
are excluded — editing a note is not a design change (QOC-design-007).

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

## Language

Every user-facing noun comes from the seam ledger's shared or ui-only zones;
domain-only terms (internal identifiers, infrastructure vocabulary such as
"tenant") never appear in UI strings. Sentence case everywhere. Banned
constructions: "please", "click here", "Are you sure?", negative contractions
("can't" → "cannot"), permissive "you can". Vale rules are generated from the
ledger — a banned synonym in a UI string fails the build.

## Budgets (per screen, lint-enforced)

- Primary actions per view: exactly 1
- Top-level actions per view: ≤ 5 (the rest behind explicit disclosure)
- Font weights: ≤ 2 · Type sizes: from the token scale only
- Elevation levels: ≤ 2 · Corner radii: from the token scale only
- Spacing: token scale only — no arbitrary px/rem values
- Color: 60% dominant neutral / 30% secondary / 10% accent; ONE accent hue;
  semantic colors (good/warn/critical) are not accents
- Every color, in every state, from semantic tokens — raw hex fails the build

## Surface selection (decision table — no judgment)

| Task shape | Surface |
|---|---|
| Single-field, in-context change | Inline edit — no overlay |
| Short (≤ ~30s), user-initiated, must complete before continuing | Dialog |
| Multi-field but needs background visible for reference | Drawer |
| Many fields, multi-step, or navigable as a destination | Page |

The surface for a CTA is recorded in the CTA matrix at design time. Screens
implement the recorded surface; choosing at build time is a review failure.

## Destructive actions (severity ladder)

| Severity (from the CTA matrix) | Mandated pattern |
|---|---|
| recoverable | Act immediately + undo toast (no confirmation) |
| irreversible | Confirm dialog titled as the concrete question ("Delete this project?") with the explicit verb pair — "Are you sure?" is banned |
| irreversible-high-value | Type-to-confirm (resource name), explicit verb |

Confirmation dialogs on recoverable actions are a review failure (they train
dismissal). Severity is assigned in the CTA matrix, never at build time.

## Feedback grammars

- Success toast: past participle of the CTA verb + ledger noun ("Statement
  archived"), top-right, ≤ 3 lines, 5s timeout. Timed dismissal of critical
  messages is banned.
- Correction needed: actionable inline notification at the point of error,
  no timeout.
- Error message template: [what happened] + [how to fix it]. Adjacent to the
  field. No error codes, no blame, no apologies, no "please".
- Empty states: header + one primary action toward populating the view, with
  distinct variants for first-use / no-results / error / no-permission.
  A silent blank region is a review failure.

## Banned defaults

Inter/Roboto/Open Sans as display faces · purple→blue gradient heroes ·
glassmorphism cards · emoji as section markers or bullet decoration ·
three-icon feature-card rows · bounce/translate on hover · center-aligned
body text · uniform rounded-lg on every element · decorative animation
without a reduced-motion path. Any of these in a diff fails review unless the
constitution of THIS project explicitly opts one in.

