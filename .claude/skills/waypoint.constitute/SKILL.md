---
description: "Review and customize the project constitution"
---

# WayPoint: Constitute Action

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

Load the **Architect Agent** from `.claude/agents/architect.md`.

Review the generated project constitution:
1. Read `.waypoint/constitution.md`
2. Verify principles align with project goals
3. Check architecture pattern is appropriate
4. Validate quality standards
5. Suggest amendments if needed

Output amendments to `.waypoint/constitution.md`.

## After Completion

Update `waypoint.manifest.yaml` to reflect any documents you created or status changes.

---

## Arguments

$ARGUMENTS

---

_WayPoint Constitute command for FastAPI + Domain-Driven Design_