# Design constitution

> Restraint is the doctrine: less, but better. Structure comes from the seam ledger and the object map; taste comes from budgets, not judgment.

> This file is a projection of governed doctrine. Do not edit here — override via a project-tier Design principle.

## First principles

Every rule in this document descends from one of these six. Each is an
opinion; each states what it buys, so you can tell when it applies.

**FP-1 — Drift in language is drift in the system.**
When the same thing has two names, the two names grow two behaviours. Holding
one word per concept is cheaper than reconciling the code that grew under the
second. This is why a seam ledger exists at all, and why a banned synonym
fails a build rather than raising a comment.

**FP-2 — Objects come before actions.**
Users recognize things before they choose verbs. A design that starts from
screens produces objects nobody agreed on; a design that starts from objects
produces screens that compose. So the object map is ratified before a
wireframe is drawn, and every CTA names an object that already exists.

**FP-3 — Translate in exactly one place.**
Vocabulary that converts in many places converts differently in each, and the
differences are invisible until they contradict. One bilingual seam means a
rename has one site and a disagreement has one address. Layers above and below
it stay monolingual, which is what makes them checkable.

**FP-4 — Budgets beat taste.**
"Looks right" is not reviewable and does not survive a second author. A budget
— one primary action, two font weights, colour only from tokens — is a
constraint anyone can check and nobody has to win an argument about. The
budgets are deliberately tighter than taste would require, because the cost of
a rule that is sometimes ignored is higher than the cost of a rule that is
occasionally inconvenient.

**FP-5 — Nothing is owned until it is seen.**
A decision recorded in YAML the developer never read is a decision the
developer will contradict. Presenting every choice as a picture, with real
alternatives, is what makes the record binding rather than merely present.
This is why agents end their turn at a proposal: a choice made unattended has
not been made.

**FP-6 — The machine verifies; the human decides.**
Anything mechanically checkable belongs in a gate, because gates do not get
tired or agreeable. Anything requiring judgment — which alternative, which
word, whether this is good enough — belongs to a person, because a machine
that decides those produces plausible answers nobody agreed to. Ratification
and mockup approval carry a human name for exactly this reason.

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

## At every pause, teach

Every gate in the presentation ladder carries ONE sentence of rationale and a
shelf citation with its reading time. On the first contact with a gate class in
a project, add its primer — at most five lines: the principle, the failure it
prevents, one example. Afterwards the why-line stands alone. Ladder membership
decides which decisions are non-trivial; that is never judged in the moment.

Every gate's option set includes "I need more context". Taking it is NOT a
decision: no state advances, no debt is written, nothing is recorded as chosen,
and the gate is presented again afterwards.

A learn answer draws only on the principle, the primer, and the shelf — all
written before any concrete gate existed. It never names, summarizes, or
compares the options in front of the developer. An explanation that argues for
one of them is a persuasion device with a books icon, and it fails review.

| Gate | Principle | What it controls |
|---|---|---|
| alternative-selection | FP-5 | Which alternative you pick decides the screen's structure, and structure is the part that is expensive to change later. |
| list-view-structure | FP-2 | Columns and sort come from the object map's card fields and metadata attributes, so this decides what the object map must say. |
| detail-view-layout | FP-2 | A detail view's sections come from the object's relationships, so this decides which related objects are reachable at all. |
| cta-placement | FP-4 | Every view gets exactly one primary action and at most five top-level ones, so this decides what goes behind disclosure. |
| tab-organization | FP-2 | Tabs are navigation between object groupings, so this decides what a reader believes belongs together. |
| navigation-change | FP-2 | Navigation is recorded in the object map's reachability, so this decides which objects have a route to them. |
| token-change | FP-4 | Tokens are the only legal source of colour, spacing, and type size, so this changes every surface at once. |
| surface-selection | FP-6 | The surface for an action is decided by a table at design time and recorded, so this is settled once rather than per screen. |
| noun-adjudication | FP-1 | One word per concept is enforced by the build, so this decides what every future surface is allowed to say. |
| mockup-approval | FP-6 | Approval is content-hashed across the screen and its slices, so it is the moment the design stops moving. |
| ratification | FP-6 | Ratification stamps a human name on a ledger or object map, and review fails on artifacts that carry none. |

Citations name a shelf entry; an improvised link fails review.

## Reference shelf

Agents cite entries from this shelf. An improvised link fails review:
a citation nobody curated is a claim nobody checked.

### From this project
- fp — the six opinions every design rule descends from (3 min)
  .claude/rules/design-constitution.md § First principles
- ladder — which decisions pause for a person and which proceed (1 min)
  .claude/rules/design-constitution.md § Presentation ladder
- archetypes — the five screen shapes and what each one contracts to (2 min)
  .claude/rules/design-constitution.md § Screen archetypes
- budgets — the countable limits that replace taste arguments (1 min)
  .claude/rules/design-constitution.md § Budgets
- surfaces — the table that picks dialog, drawer, inline or page (1 min)
  .claude/rules/design-constitution.md § Surface selection
- representation — how a relationship between objects gets shown (1 min)
  .claude/rules/design-constitution.md § Relationship representation
- cadence — why a decision is presented as a picture before it is recorded (2 min)
  .claude/rules/design-constitution.md § The cadence
- ledger — what a seam ledger holds and why one word per concept is enforced (2 min)
  design/glossary/_method.yaml

### Outside reading
- comprehension-debt — why understanding falls behind generated code, and why that gap stays quiet (8 min)
  Osmani, Comprehension Debt — research/cadence-validation/sources/osmani-comprehension-debt.html
  Verified: local-copy
- scaffolding-rct — the measured cost of unscaffolded generation, and that scaffolding removed most of it for free (9 min)
  DevToolLab, Cognitive Debt — research/cadence-validation/sources/devtoollab-cognitive-debt.html
  Verified: local-copy
  Does not support: secondary reporting of the Anthropic RCT and the Sankaranarayanan study, not the primary papers
- knowledge-debt — that incidental learning does not return on its own and has to be designed back in (2 min)
  Agents That Teach, arXiv 2607.06101 — abstract
  Verified: abstract-only
  Does not support: the abstract only; the full paper was not read
- review-bottleneck — that specification discipline, not model capability, is the binding constraint (2 min)
  Productivity-Reliability Paradox, arXiv 2605.01160 — abstract
  Verified: abstract-only
  Does not support: the abstract only; the full paper was not read
- theory-building — why a mental model built through an agent is thinner than one built by hand (10 min)
  Goedecke, Programming (with AI agents) as theory building — research/cadence-validation/sources/goedecke-theory-building.html
  Verified: local-copy
- design-ownership — what drift looks like in an interface when no one owns it at the system level (6 min)
  Managed Code, AI Slop in Design — research/cadence-validation/sources/managedcode-ai-slop-design.html
  Verified: local-copy
- gate-placement — that the question is where a gate belongs, not how many gates there are (7 min)
  Port.io, Human in the Loop for AI Coding Agents
  Verified: live-page
  Does not support: the saved copy is a JavaScript shell; quotes were checked against the live page, so this entry depends on a URL that may change
- automation-bias — how readily people accept faulty machine reasoning rather than overrule it (5 min)
  Wharton cognitive-surrender experiments, via Slashdot and byteiota coverage
  Verified: coverage-only
  Does not support: the primary paper was never retrieved, and the participants were general AI users rather than developers — evidence about automation bias, never a developer statistic
- counterpoint — the strongest argument against this whole approach, kept on the shelf on purpose (6 min)
  Kindred, Same Patterns, New Hype — research/cadence-validation/sources/devto-sdd-2026.html
  Verified: local-copy
  Does not support: argues the value is the thinking, not the tooling — an answer to this framework rather than support for it; a shelf citing only agreement is a reading list for a conclusion already reached

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

## Relationship representation (decision table — no judgment)

| Relationship | Representation |
|---|---|
| 1:1 / N:1 to a primary object | link |
| 1:N ranked in the owner's top 3 | embedded-list |
| 1:N below top-3 rank | count + link |
| N:M or cross-context | inline-card on detail only |

Recorded per relationship in the object map at design time; an object
reachable through no representation fails review.

## Screen archetypes

| Archetype | Contract (primary-action home in bold) |
|---|---|
| list | toolbar (search·filter·sort) → ranked card_fields rows; **toolbar** |
| detail | identity header → core content → related per representation; **header** |
| form | one column, grouped fields, Save/Cancel pinned; **Save** |
| dashboard | stats strip → prioritized panels; navigation only; **none** |
| wizard | one decision per step, visible progress, safe back; **continue** |

A slice names its archetype at design time; mixing or choosing at build time
fails review. Extending the set requires org-tier QOC ratification, like verbs.

## Design approval states

`proposed` → `approved` | `rejected` → (any contributing edit) → `stale`

Approving and rejecting are human acts: an agent never writes `approved` or
`rejected`, and stops at the proposal. A rejection records who, when, why, and
a `scope` — `layout` returns to design.flow and the refused shape may not be
re-offered without naming what changed; `rendering` re-renders against the
standing wireframe. Rejected mockups are retained as the evidence the next
proposal is reviewed against.

Approval is hashed over the screen plus every slice that contributes to it, so
editing any of them moves that screen — and only that screen — to `stale`.
Staleness follows contribution and stops there.

## Mockup annotations (derived, never authored)

| Attribute | Carries |
|---|---|
| `data-wp-screen` | the screen id, on the root element, once |
| `data-wp-object` | the ledger noun the region binds |
| `data-wp-cta` | the canonical verb the control invokes |
| `data-wp-command` | that CTA's command sid |
| `data-wp-severity` | recoverable · irreversible · irreversible-high-value |
| `data-wp-surface` | inline · dialog · drawer · page |
| `data-wp-field` | the rendered field name |
| `data-wp-reads-from` | that field's read-model sid |

Every value is read from the screen, slice, ledger, and object map — a mockup
that asserts a binding the artifacts do not contain fails review. The
human-visible overlay renders from these same attributes via CSS selectors;
a mockup carries no script, so the two cannot disagree. Gate check: every CTA
reachable on the screen appears as an annotated control, and every annotated
control traces to a CTA row.

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

## Heuristic review (advisory — never changes the gate verdict)

Per touched screen, each item answered with evidence or N/A: (1) status
visible; (2) recognition over recall — no memorized codes; (3) every error
names its fix; (4) sibling object-views behave identically; (5) every
walkthrough finding resolved or ticketed.

## Diagrams (offer protocol)

Derived diagrams regenerate from existing sources and are never asked for:
state (from the statechart machine), ERD (from aggregates + code_mapping),
OOUX map (from the object map), system (from the architecture graph).
Authored diagrams are OFFERED once per type+scope per task:

| Trigger | Offer |
|---|---|
| Spec or task introduces a multi-actor / multi-step flow | sequence diagram |
| A new bounded context enters the architecture | system diagram |
| Task touches many entities or a new aggregate | class/ERD slice |

Declines are recorded — do not re-offer. On demand: /waypoint.diagram
{type} {scope}. Published diagrams are template-rendered HTML/SVG from a
sid-anchored data file — never Mermaid, never hand-drawn markup.

## Banned defaults

Inter/Roboto/Open Sans as display faces · purple→blue gradient heroes ·
glassmorphism cards · emoji as section markers or bullet decoration ·
three-icon feature-card rows · bounce/translate on hover · center-aligned
body text · uniform rounded-lg on every element · decorative animation
without a reduced-motion path. Any of these in a diff fails review unless the
constitution of THIS project explicitly opts one in.

## Register

Doctrine is written for a developer reading it under deadline.

- Prose explains; it never merely asserts. A rule states what it prevents.
- Every framework term carries a one-line gloss at its first use on each
  surface. A reader who arrives mid-document is the normal case.
- Internal-only vocabulary stays out of anything a developer reads: gate
  findings, command prompts, and error text name the thing, not its
  implementation.
- Jargon whose meaning is not recoverable from the sentence around it is
  banned. An aphorism that explains itself — "budgets beat taste" — is kept,
  because it compresses a rule a reader already met.
- Terms and their glosses live in `design/glossary/_method.yaml`, zoned
  developer-facing or internal-only. The register lint reads that ledger.

