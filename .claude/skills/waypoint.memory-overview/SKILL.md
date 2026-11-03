---
description: "Show an ASCII dashboard of the project's knowledge graph state"
---

# WayPoint: Memory Overview Action

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

Display an aggregate dashboard of everything stored in the Graphiti knowledge graph for this project.

1. Call the `get_memory_overview` MCP tool:
   - If the user provided arguments, pass them as the `group_id` parameter
   - If no arguments, omit `group_id` to use the server default

2. Check the `status` field in the response:
   - If it starts with `error:`, display the error and suggest checking that waypoint-memory is running and FalkorDB is accessible
   - If all counts are zero, display: "No knowledge stored yet for this project. Run `/waypoint.memory-seed` to populate the graph."
   - Otherwise, render the dashboard below.

3. Render the response as an ASCII dashboard using box-drawing characters with these sections:
   - **Header**: Project name, group_id, connection status
   - **Episodes**: Total + breakdown by type with `█` bar chart (scale so largest type uses ~30 blocks)
   - **Recent Episodes**: Last 5 with name (truncated to 40 chars), date (YYYY-MM-DD), source persona
   - **Entities**: Total + breakdown by label
   - **Edges**: Total fact count
   - **Communities**: Top 5 by member count, or "Not built — run `build_communities` to enable"
   - **Sources**: Episode counts per persona

**Rendering rules**:
- Use `├─` for all list entries except the last, which uses `└─`
- Right-align counts in each section for readability
- If `communities.total` is 0 and `episodes.total` > 0, show the "not built" message

## After Completion

Update `waypoint.manifest.yaml` to reflect any documents you created or status changes.

---

## Arguments

$ARGUMENTS

---

_WayPoint Memory Overview command for FastAPI + Domain-Driven Design_