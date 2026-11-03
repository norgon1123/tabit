---
description: "Implement a task following project conventions"
---

# WayPoint: Implement Action

**Project**: tabit

## Before You Begin

1. **Read the manifest** at `waypoint.manifest.yaml` to understand:
   - Current project state and active documents
   - What specs, plans, and tasks exist
   - Document summaries for quick context

2. **Check document status** in the manifest:
   - `specs`: Feature specifications
   - `plans`: Technical designs
   - `tasks`: Implementation tasks with status

Load the **Developer Agent** from `.claude/agents/dev.md`.


## Before any code: the comprehension preamble

1. **Consume the briefing.** The task file's `briefing:` block lists required
   sids, ledger rows, flow slices, and artifact links. Open them. If the task
   has no briefing and touches a modeled context, that is a gap — note it.
2. **Teach-back (mandatory for agents).** Restate the task in the seam
   ledger's vocabulary — the objects touched, the flow step affected, the
   invariants in scope, and what "done" changes for the user — in at most 12
   lines. If your restatement conflicts with a ledger term, CTA row, or
   statechart transition, STOP and re-read before writing anything.
3. **Assumption ledger.** Record the assumptions you are making (rounding
   rules, ordering, permissions, defaults) BEFORE implementing. Review will
   check them; a wrong assumption recorded is a clarify item, a wrong
   assumption silent is a shipped bug.
4. **Comprehension debt.** A user-facing term missing from the ledger, a
   workflow with no flow slice, or a schema question the briefing cannot
   answer is recorded as a debt entry (`kind: comprehension` in
   `design/debt.yaml`) — never guessed through.
5. **Greenfield caution**: when the touched context's ledger is unratified or
   the project is young, these requirements escalate — they never relax.

Implement the assigned task:
1. Read the task file and understand requirements
2. Follow architecture patterns from the constitution
3. Write implementation code
4. Write tests for new functionality
5. Run lint and tests before completing

Mark task complete when all acceptance criteria pass. **The definition of
done includes briefing citations**: state which briefing items shaped which
decisions (one line each). Uncited briefings are unread briefings.

## After Completion

Update `waypoint.manifest.yaml` to reflect any documents you created or status changes.

---

## Arguments

$ARGUMENTS

---

_WayPoint Implement command for FastAPI + Domain-Driven Design_