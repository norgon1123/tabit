---
description: "Review implementation for quality and compliance"
---

# WayPoint: Review Action

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

Load the **QA Agent** from `.claude/agents/qa.md`.


Review the implementation:
1. Check code against acceptance criteria
2. Verify architecture pattern compliance
3. Review for security vulnerabilities (OWASP Top 10)
4. Ensure adequate test coverage
5. Validate lint and type checks pass

Output review findings with pass/fail status.

## After Completion

Update `waypoint.manifest.yaml` to reflect any documents you created or status changes.

---

## Arguments

$ARGUMENTS

---

_WayPoint Review command for FastAPI + Domain-Driven Design_