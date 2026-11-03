---
name: tabit-test-review
description: Use when about to add a test in Tabit, when an agent has just written or changed tests, or when asked to review/audit the test suite (or a named set of tests) for redundancy and consolidation. Triggers include "should this be a new test", "review the tests", "audit the suite", "too many tests", or reaching for a new test file/case during a change.
---

# Tabit test review

A test suite is documentation: it should let a reader learn what each unit is *supposed to
do* by reading the tests that cover it. Every redundant test dilutes that signal and adds
maintenance weight. So the governing question when tests change is not "is this test
correct?" (that is `tabit-reviewer`'s job) but **"does this test earn its place, or does it
belong inside a test that already exists?"**

## The default is enhance, not add

Before you write a new test, the burden is on proving it *cannot* be an extra assertion or
an extra case on a test that already exists. Reach for a new test only when it carries
intent the existing suite does not.

## Deciding where a check belongs

Walk these in order for the behaviour you want to cover. Stop at the first match.

1. **No existing test touches this code path** (function, endpoint, component)?
   → New test is right. Name it for the *behaviour*, not the function
   (`rejects_upload_longer_than_max`, not `test_upload`).
2. **A test exists with the same setup, differing only in inputs and expected outputs?**
   → Parametrize it — `@pytest.mark.parametrize` (backend) or `it.each` (frontend). Do not
   clone the test and change one value; that is copy-paste the reader has to diff by eye.
3. **A test already reaches the exact state you care about, and you want to check one more
   property of that same result?**
   → Add an assertion to it. A second assertion on an existing arrangement is nearly free
   and keeps the behaviour's full contract in one readable place.
4. **The check has genuinely distinct intent** — a different contract, or a failure mode
   that would make an existing test unreadable if folded in?
   → New test. This is the legitimate case; the first three just have to fail first.

## Close calls: the deciding factors

When more than one option is defensible, weigh:

- **Intent.** One behaviour per test. If a single sentence can't name what the test proves,
  it is two tests.
- **Setup cost.** If reusing a test means duplicating a large fixture, a shared/parametrized
  test wins. If it means bending an unrelated fixture into a shape it wasn't built for, a
  new test with its own clear arrangement wins.
- **Readability as documentation.** After your change, can a reader still read the unit's
  job off its tests? Prefer the layout that keeps that legible.
- **Failure isolation.** A failing test should name its own cause. This is the counterweight
  to over-consolidation — do not merge two behaviours just to cut a test if a failure would
  then leave you guessing which behaviour broke.

## Don't over-consolidate

Fewer tests is a means, not the goal — legibility is the goal. Smells of a merge gone too
far:

- A parametrized case that needs `if input == X` branching in the test body — that is two
  tests wearing one name; split them.
- A test whose name stops describing what its assertions check.
- One test asserting on several unrelated behaviours, so a failure doesn't tell you which.

**"Same call shape" is not "same behaviour."** Step 2 above is a trap when several tests
call the *same function* but each pins a *different rule*. Example: four tests all calling
`roman_numeral(...)` that separately prove diatonic mapping, seventh-suffix formation, the
non-diatonic accidental prefix, and minor-key mode. Mechanically they "differ only by input
and expected output" — but folding them into one parametrized test tangles four contracts
under one name and destroys failure isolation. Parametrize when the cases prove the *same*
rule over a range of inputs (`whole_bpm` over `[143.6, 0, None, …]`); keep them separate
when each input pins a *distinct* rule.

**A regression test is not redundant with the structural test it follows from.** A test
that asserts the observable *consequence* of a bug (e.g. "intro chords land on distinct
positive beats") earns its place even when a neighbouring test proves the underlying
property *structurally* (e.g. "the grid backfills beats before the first onset"). The
consequence test names the symptom a human reported; that is documentation the structural
test doesn't carry. Keep it — at most, move its rationale comment onto the structural test
if the team decides the symptom is fully covered.

## Running a standalone review

Given no target, review the whole suite: backend `tests/*.py` and frontend colocated
`*.test.ts(x)`. Given a named set in the prompt, review just those files. In both cases:

- Group tests by the unit under test. Within each group, look for near-duplicates that
  differ only by input (→ parametrize), tests that re-assert what another already covers
  (→ drop or merge), and names that no longer match their assertions.
- Report opportunities as concrete proposals — *"`test_x` and `test_y` differ only in the
  BPM value; parametrize over `[120, 90, 200]`"* — with `file:line`. **Propose; do not
  rewrite.** Consolidation changes behaviour coverage and needs the implementer's judgment.
- If the suite is already lean, say so plainly. Do not manufacture merges to look useful —
  a bad merge costs more than a redundant test.

## Reviewing tests an agent just wrote

Dispatch the **`tabit-test-reviewer`** subagent (read-only, adversarial) on the diff. It
applies this skill's criteria to each new/changed test and reports whether it should fold
into an existing test. This is required before opening a PR — see AGENTS.md.

## Red flags — stop and reconsider

- Creating a new test *file* for a single case that belongs in an existing file.
- Copy-pasting a test and changing one literal → parametrize instead.
- A test named after the function, not the behaviour it proves.
- An assertion that only re-checks the setup or a mock configured two lines above.
- A test that proves several unrelated things at once (over-consolidation).
