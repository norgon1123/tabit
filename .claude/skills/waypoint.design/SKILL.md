---
description: "Create UX/UI design from a specification"
---

# WayPoint: Design Action

**Project**: tabit

> **Superseded.** This action is a front door to the design feature (md-ux).

Route by task:
- Object modeling, glossaries, CTA matrices → `/waypoint.design-model`
- Flow slices and statecharts → `/waypoint.design-flow`
- Building screens → `/waypoint.design-implement`
- Reviewing UI diffs → `/waypoint.design-review`
- Token maintenance → `/waypoint.design-tokens`

If the design feature is not active on this project, activate it via the
`design-system` option (waypoint init) or project settings. For any
UI-touching work, load `.claude/rules/design-constitution.md` and the seam
ledger `design/glossary/{context}.yaml` for the touched context first.

---

## Arguments

$ARGUMENTS

---

_WayPoint Design command for FastAPI + Domain-Driven Design_