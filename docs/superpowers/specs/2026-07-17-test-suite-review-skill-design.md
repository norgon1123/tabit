# Test-suite review: skill + reviewer agent

**Date:** 2026-07-17
**Status:** approved, ready to implement

## Problem

Agents reflexively add a *new* test for every change. The suite grows until it is
expensive to maintain and — worse — until no one can read a unit's job off its tests,
because the signal is buried under near-duplicate cases. Often the right move is not a new
test but a stronger existing one: another assertion, or another run under a different
starting condition (`@pytest.mark.parametrize` / vitest `it.each`). Nothing in the repo
forces that judgment today, and the repo already distrusts self-review ("you cannot
reliably review your own work").

## Goal

Make "enhance an existing test vs. add a new one" a deliberate, reviewed decision — both
when an agent writes tests during a change, and on demand across the whole suite.

## Non-goals

- No auto-run hook. Dispatch stays agent-driven, exactly like `tabit-reviewer`.
- No rewriting of existing tests by the tooling. The reviewer proposes; humans/implementers act.
- No changes to the generated zone of AGENTS.md (below the marker).

## Design

Three artifacts.

### 1. Skill — `.claude/skills/tabit-test-review/SKILL.md`

Holds the judgment and runs standalone (`/tabit-test-review`). Sections:

- **Core principle:** the default is consolidation, not addition. Before a new test earns
  its place, prove it cannot be an assertion or a parametrized case on an existing test.
- **Decision procedure** keyed to observable predicates: does an existing test already
  exercise this code path? under the same setup? for the same intent? → routes to
  *add-assertion*, *parametrize*, or *new test*.
- **Deciding factors** (from the brief, made concrete): distinct intent; setup
  cost/complexity; readability; and whether the test's name + body still document what the
  code *should do* (a name that no longer matches its assertions is a smell).
- **Standalone modes:** audit the whole suite (backend `tests/` + frontend colocated
  `*.test.ts(x)`) for redundancy/consolidation, or a named subset from the prompt.
  Read-only: it reports opportunities, it does not rewrite.
- **Boundary vs. `tabit-reviewer`:** that agent hunts correctness and tests-that-cannot-fail;
  this one judges suite economy and test-as-documentation. No overlap.

### 2. Agent — `.claude/agents/tabit-test-reviewer.md`

Mirrors `tabit-reviewer`: read-only (Read, Grep, Glob, Bash), adversarial, reports and does
not fix. Dispatched after a change adds/modifies tests, before the PR. It reads the diff's
new/changed tests, applies the skill's criteria, and reports — per new test — whether it
earns standalone existence or should fold into an existing test, plus any redundant
coverage introduced.

### 3. AGENTS.md policy-zone edits (above the marker, hand-edited)

- A new doctrine section: enhance before you add, pointing at `/tabit-test-review`.
- `tabit-test-reviewer` wired into "Review before you ship" alongside `tabit-reviewer`.
- Definition of done gains a **mandatory** bullet: a change that adds/modifies tests has
  been through `tabit-test-reviewer` and its findings addressed, before the PR.

## Validation

Dispatch the finished `tabit-test-reviewer` against real test files in the suite
(standalone audit mode) and confirm it produces a sensible, specific verdict rather than
generic praise. Record what it found in the PR body.

## Process note

The design is fully concrete and the deliverables are three documentation files with no
interdependencies, so this goes straight to implementation rather than through a separate
written plan — a plan would add process without de-risking anything.
