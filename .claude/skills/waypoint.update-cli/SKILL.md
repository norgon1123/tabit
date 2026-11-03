---
description: "Update the WayPoint CLI to the latest version"
---

# WayPoint: Update CLI Action

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

## Instructions

This action updates the WayPoint CLI package to ensure you have the latest features, bug fixes, and improvements.

### Step 1: Check Current Version

First, verify your current WayPoint CLI version:

```bash
npx @copoint-ai/waypoint-cli --version
```

### Step 2: Update the Package

Update to the latest version using npm:

```bash
npm install -g @copoint-ai/waypoint-cli@latest
```

**Alternative**: If you prefer using npx without global installation, simply clear the npx cache:

```bash
npx clear-npx-cache
```

The next time you run `npx @copoint-ai/waypoint-cli`, it will automatically download the latest version.

### Step 3: Verify the Update

Confirm the update was successful:

```bash
npx @copoint-ai/waypoint-cli --version
```

Compare this version number with the one from Step 1 to ensure it has been updated.

### Step 4: Test the CLI

Run a simple command to ensure everything is working:

```bash
npx @copoint-ai/waypoint-cli --help
```

This should display the help menu with all available commands.

### Common Issues

**Permission errors during global install?**
- Use `sudo` on macOS/Linux: `sudo npm install -g @copoint-ai/waypoint-cli@latest`
- Or install without `-g` flag and use `npx` instead

**Old version still showing?**
- Clear npm cache: `npm cache clean --force`
- Clear npx cache: `npx clear-npx-cache`
- Try running with `npx` explicitly: `npx @copoint-ai/waypoint-cli@latest --version`

## After Completion

Update `waypoint.manifest.yaml` to reflect any documents you created or status changes.

No manifest updates are needed for CLI updates. The CLI will continue to work with your existing `waypoint.manifest.yaml` file.

---

## Arguments

$ARGUMENTS

---

_WayPoint update-cli command for FastAPI + Domain-Driven Design_