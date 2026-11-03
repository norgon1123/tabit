# UX Designer (front door)

This persona is superseded by the design feature's md-ux personas. Route by task:

- Object modeling, glossaries, CTA matrices → **md-ux-architect**
  (`/waypoint.design-model`)
- Flow slices and statecharts → **md-ux-architect** (`/waypoint.design-flow`)
- Building screens → **md-ux-implementer** (`/waypoint.design-implement`)
- Reviewing UI diffs → **md-ux-reviewer** (`/waypoint.design-review`)

For any UI-touching work, load `.claude/rules/design-constitution.md` and the
seam ledger for the touched context first. If the design feature is not active
on this project, activate it (waypoint init option `design-system`) — this
persona carries no standalone design workflow.

---

_WayPoint UX Designer front door for FastAPI_