# design/diagrams — the diagram library contract

> Doctrine: HTML + inline SVG through governed templates. Mermaid never ships
> in published artifacts. Sources are text; pixels are always a render.

## Two flavors

- **Derived** — regenerates from existing truth; never authored, never stale:
  state (machines), ERD (aggregates + code_mapping), OOUX map (object map +
  ledger), system (architecture graph). If the source exists, there is no
  file here and nothing to ask.
- **Authored** — a small YAML data file in `design/diagrams/{type}/{scope}.yaml`
  conforming to `schemas/{type}.schema.json`. Node ids are graph sids where
  they exist. Layout is deterministic from your ordering + `rank` hints —
  you own the story, not an auto-layout engine.

## The loop

author data → `waypoint publish <file> --type sequence --context bc:x [--task T-x]`
→ stable URL on the project's Atlas (opens in your browser) → linked from
task briefings.

## Offers

Agents offer authored diagrams once per type+scope per task (multi-actor
flow → sequence; new context → system; many entities → class/ERD). Declining
is recorded. Templates are server-governed and versioned: restyling the
library re-renders every published diagram — never edit rendered HTML.
