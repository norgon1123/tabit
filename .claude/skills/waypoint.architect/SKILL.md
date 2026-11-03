---
description: "Create a technical plan for a specification"
---

# WayPoint: Architect Action

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

**Flow file**: `.waypoint/workflows/architect/_flow.yaml`
**Steps**: 5

### Step Overview

   1. **Review Specification** - Understand requirements from an architect's perspective
   2. **Design Components** - Break feature into components following architecture pattern
   3. **Define Data Models** - Design entities, value objects, and their relationships
   4. **Define APIs** - Design component interfaces and API contracts
   5. **Finalize Plan** - Compile architecture decisions into the technical plan

### How to Execute

**Option A: Follow steps interactively**
1. Read each step file in `.waypoint/workflows/architect/`
2. Complete the step's objective
3. Confirm the checkpoint before proceeding
4. Move to the next step

**Option B: Quick reference (experienced users)**
- Step 1: `.waypoint/workflows/architect/review-spec.md`
- Step 2: `.waypoint/workflows/architect/design-components.md`
- Step 3: `.waypoint/workflows/architect/define-data-models.md`
- Step 4: `.waypoint/workflows/architect/define-apis.md`
- Step 5: `.waypoint/workflows/architect/finalize-plan.md`

### Checkpoints

Each step has a checkpoint question. Only proceed when you can answer "yes":

- **Step 1**: Understand requirements from an architect's perspective
- **Step 2**: Break feature into components following architecture pattern
- **Step 3**: Design entities, value objects, and their relationships
- **Step 4**: Design component interfaces and API contracts
- **Step 5**: Compile architecture decisions into the technical plan

### Entry Conditions

- Approved specification from /waypoint.specify

### Final Outputs

- .waypoint/plans/{feature}.md

Load the **Architect Agent** from `.claude/agents/architect.md`.


Create a technical plan:
1. Review the specification
2. Design components following the architecture pattern
3. Define data models (entities, value objects)
4. Design API contracts and interfaces
5. Plan implementation phases

Output to `.waypoint/plans/{feature}.md`.



## After Completion

Update `waypoint.manifest.yaml` to reflect any documents you created or status changes.

---

## Arguments

$ARGUMENTS

---

_WayPoint Architect command for FastAPI + Domain-Driven Design_