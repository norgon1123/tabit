---
description: "Break down a plan into executable tasks"
---

# WayPoint: Plan Action

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

3. **Check for in-progress workflows** in the manifest under `workflows.active`
   - If resuming, continue from the current step
   - If starting fresh, begin at Step 1

## Workflow: Step-by-Step

This action uses a **step-file workflow** for better control and checkpointing.

**Flow file**: `.waypoint/workflows/plan/_flow.yaml`
**Steps**: 4

### Step Overview

   1. **Review Plan** - Understand implementation scope and dependencies
   2. **Identify Tasks** - Break plan into atomic, completable tasks
   3. **Sequence Tasks** - Order tasks respecting dependencies
   4. **Write Task Files** - Create detailed, self-contained task files

### How to Execute

**Option A: Follow steps interactively**
1. Read each step file in `.waypoint/workflows/plan/`
2. Complete the step's objective
3. Confirm the checkpoint before proceeding
4. Move to the next step

**Option B: Quick reference (experienced users)**
- Step 1: `.waypoint/workflows/plan/review-plan.md`
- Step 2: `.waypoint/workflows/plan/identify-tasks.md`
- Step 3: `.waypoint/workflows/plan/sequence-tasks.md`
- Step 4: `.waypoint/workflows/plan/write-tasks.md`

### Checkpoints

Each step has a checkpoint question. Only proceed when you can answer "yes":

- **Step 1**: Understand implementation scope and dependencies
- **Step 2**: Break plan into atomic, completable tasks
- **Step 3**: Order tasks respecting dependencies
- **Step 4**: Create detailed, self-contained task files

### Entry Conditions

- Approved technical plan from /waypoint.architect

### Final Outputs

- .waypoint/tasks/{feature}/task-*.md

Load the **Scrum Master Agent** from `.claude/agents/sm.md`.


Break down the technical plan into tasks:
1. Review the architecture plan
2. Identify atomic, completable tasks
3. Sequence tasks respecting dependencies
4. Write detailed task files with acceptance criteria

## Briefing blocks (every task file)

Each task file carries a `## Briefing` section — the comprehension contract
the implementer is verified against:
- **sids**: required concepts/commands/read-models (seed with
  `memory_resolve` on the task description)
- **ledger**: the seam-ledger rows in scope (terms + banned synonyms that
  matter here)
- **flow/machine**: the governing flow slice and statechart, if the task
  touches a flow
- **artifacts**: diagram/mockup links (published URLs when available)
- **risks/read-first**: the plan sections and known risks this task inherits

Briefings LINK — never inline bulk content; at most ~40 lines. When the
artifact publish path is available, publish each briefing as a BRIEFING,
including `taskStatus` (the task's status at this moment) in the payload —
the Atlas renders it as "{status} at publish" beside the briefing title, and
omits the chip entirely when unstamped
artifact tagged with the task id (the Atlas briefing view and the agent
packet render from that one document).

Output to `.waypoint/tasks/{feature}/task-*.md`.

## After Completion

Update `waypoint.manifest.yaml` to reflect any documents you created or status changes.

---

## Arguments

$ARGUMENTS

---

_WayPoint Plan command for FastAPI + Domain-Driven Design_