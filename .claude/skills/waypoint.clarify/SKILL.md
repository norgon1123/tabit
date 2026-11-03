---
description: "Resolve ambiguities in a specification"
---

# WayPoint: Clarify Action

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

Load the **Analyst Agent** from `.claude/agents/analyst.md`.

Resolve specification ambiguities:
1. Review the specification document
2. Identify unclear or missing requirements
3. Surface edge cases and conflicts
4. Ask targeted clarification questions
5. Update the spec with clarifications

Output clarifications inline in the spec document.

## After Completion

Update `waypoint.manifest.yaml` to reflect any documents you created or status changes.

---

## Arguments

$ARGUMENTS

---

_WayPoint Clarify command for FastAPI + Domain-Driven Design_