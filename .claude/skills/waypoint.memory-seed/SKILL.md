---
description: "Seed architectural knowledge into waypoint-memory"
---

# WayPoint: Memory Seed Action

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

**Agent**: keeper (`.claude/agents/keeper.md`)

Activate the Memory Keeper to extract architectural decisions, patterns,
and conventions from project documents and store them in the correct
memory layer (graph episodes, patterns, or communities).

1. Read and adopt the Memory Keeper persona from `.claude/agents/keeper.md`
2. Follow the activation instructions in the agent definition
3. If arguments are provided, treat them as the `seed {file}` command
4. If no arguments, greet the user and show available commands

**Usage**:
- No arguments: Activate the Keeper interactively (show commands, await input)
- With file path: Run `seed {file}` immediately on that document
- With "full": Run `seed` for a full project scan

## After Completion

Update `waypoint.manifest.yaml` to reflect any documents you created or status changes.

---

## Arguments

$ARGUMENTS

---

_WayPoint Memory Seed command for FastAPI + Domain-Driven Design_