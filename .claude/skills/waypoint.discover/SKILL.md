---
description: "Analyze existing codebase or explore problem space"
---

# WayPoint: Discover Action

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

**Flow file**: `.waypoint/workflows/discover/_flow.yaml`
**Steps**: 4

### Step Overview

   1. **Understand Context** - Understand scope and goals of the discovery session
   2. **Explore Landscape** - Build a mental map of the territory being explored
   3. **Identify Risks** - Uncover potential problems before they become blockers
   4. **Document Findings** - Compile discovery into an actionable document

### How to Execute

**Option A: Follow steps interactively**
1. Read each step file in `.waypoint/workflows/discover/`
2. Complete the step's objective
3. Confirm the checkpoint before proceeding
4. Move to the next step

**Option B: Quick reference (experienced users)**
- Step 1: `.waypoint/workflows/discover/understand-context.md`
- Step 2: `.waypoint/workflows/discover/explore-landscape.md`
- Step 3: `.waypoint/workflows/discover/identify-risks.md`
- Step 4: `.waypoint/workflows/discover/document-findings.md`

### Checkpoints

Each step has a checkpoint question. Only proceed when you can answer "yes":

- **Step 1**: Understand scope and goals of the discovery session
- **Step 2**: Build a mental map of the territory being explored
- **Step 3**: Uncover potential problems before they become blockers
- **Step 4**: Compile discovery into an actionable document

### Entry Conditions

- New project or feature area to explore

### Final Outputs

- .waypoint/specs/discovery.md

Load the **Analyst Agent** from `.claude/agents/analyst.md`.


If the project appears to be brownfield (existing codebase):
- Analyze the architecture, patterns, and tech debt
- Map domain boundaries and dependencies
- Identify risks and constraints

If greenfield (new project):
- Explore the problem space
- Identify constraints and assumptions
- Research similar solutions

Output discovery findings to `.waypoint/specs/discovery.md`.

## After Completion

Update `waypoint.manifest.yaml` to reflect any documents you created or status changes.

---

## Arguments

$ARGUMENTS

---

_WayPoint Discover command for FastAPI + Domain-Driven Design_