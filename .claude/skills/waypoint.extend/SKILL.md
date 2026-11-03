---
description: "Add new stacks, architectures, or modules to WayPoint"
---

# WayPoint: Extend Action

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

Load the **Module Architect Agent** from `.claude/agents/modarch.md`.

Extend WayPoint with new modules:
1. Understand what needs to be added (stack, architecture, etc.)
2. Create module definition with required fields
3. Add few-shot code examples
4. Document conventions and anti-patterns
5. Validate integration with existing modules.

## After Completion

Update `waypoint.manifest.yaml` to reflect any documents you created or status changes.

---

## Arguments

$ARGUMENTS

---

_WayPoint Extend command for FastAPI + Domain-Driven Design_