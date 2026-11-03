---
description: "Query the Graphiti knowledge graph for project context"
---

# WayPoint: Memory Query Action

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

Query the Graphiti knowledge graph for decisions, entities, and patterns related to this project.

1. Run the following command to query the graph, replacing the query with the user's arguments:

```
waypoint memory hook pre-task "$ARGUMENTS" --project agentic-memory --json
```

2. Parse the JSON output. The response has this structure:
   - `context`: XML-tagged block with `<DECISIONS>` and `<ENTITIES>` sections
   - `source`: Where the results came from (`graph`, `api`, or `local`)
   - `searchTimeMs`: How long the search took
   - `itemCount`: Number of local memory items found (0 if graph source)

3. Present the results clearly:
   - List each **decision** as a bullet point with its date range
   - List each **entity** with its name and summary
   - Note the source and search time
   - If the context is empty, say "No relevant knowledge found in the graph for that query."

4. If the user didn't provide a query, ask what they'd like to search for. Example queries:
   - "architecture decisions"
   - "how does context assembly work"
   - "what domain models exist"
   - "methodology bundle API"

## After Completion

Update `waypoint.manifest.yaml` to reflect any documents you created or status changes.

---

## Arguments

$ARGUMENTS

---

_WayPoint Memory Query command for FastAPI + Domain-Driven Design_