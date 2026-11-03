---
description: "Pulls the latest bundle from WayPoint Web: Agents, Actions, Standards, Templates, etc. using the original preferences given in waypoint init."
---

# WayPoint: refresh-bundle Action

**Project**: Sample Project

## Before You Begin

1. **Read the manifest** at `waypoint.manifest.yaml` to understand:
   - Current project state and active documents
   - What specs, plans, and tasks exist
   - Document summaries for quick context

2. **Check document status** in the manifest:
   - `specs`: Feature specifications
   - `plans`: Technical designs
   - `tasks`: Implementation tasks with status

## Instructions

This action synchronizes your local WayPoint configuration with the latest bundle from WayPoint Web.

### Step 1: Execute the Refresh Command

Run the following command to pull the latest bundle:

```bash
waypoint refresh -y
```

The `-y` flag auto-confirms the refresh operation.

### Step 2: What Gets Updated

The refresh operation updates:

- **Agents**: Latest agent definitions and configurations
- **Actions**: New or updated action templates
- **Standards**: Coding standards and best practices
- **Templates**: Document and file templates
- **Workflows**: Predefined workflow sequences

All updates respect your original preferences from `waypoint init`.

### Step 3: Review Changes

After the refresh completes:

1. Check the console output for a summary of updated items
2. Review any new actions or agents that were added
3. Verify that your project-specific customizations remain intact

### Step 4: Test Configuration

Optionally verify the refresh succeeded:

```bash
waypoint status
```

This shows your current WayPoint configuration and available commands.

## After Completion

Update `waypoint.manifest.yaml` to reflect any documents you created or status changes.

The manifest does not need updating for bundle refresh operations, as this is a configuration-level change rather than a project document change.

---

## Arguments

$ARGUMENTS

---

_WayPoint refresh-bundle command for FastAPI + Domain-Driven Design_