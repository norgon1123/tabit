---
description: "Execute database migrations deterministically using a decision tree — no trial-and-error"
---

# WayPoint: Migrate Action

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

Load the **DevOps Engineer Agent** from `.claude/agents/devops.md`.

Follow the MIGRATION DECISION TREE exactly — do not improvise:

**STEP 1 — VALIDATE**: `npx prisma validate`. Stop if fails.

**STEP 2 — CHECK STATE**: `npx prisma migrate status`. Read output to determine path:
- Clean (no drift) → HAPPY PATH
- Pending migrations → APPLY PATH
- Drift detected → MANUAL PATH (go here immediately, do NOT retry migrate dev)

**STEP 3A — HAPPY PATH**:
```
npx prisma migrate dev --name <name> --create-only
# Review SQL, add partial indexes if needed
npx prisma migrate dev
```

**STEP 3B — APPLY PATH**:
```
npx prisma migrate deploy
```

**STEP 3C — MANUAL PATH** (for drift):
```
mkdir -p prisma/migrations/<timestamp>_<name>
# Write migration.sql by hand
npx prisma db execute --file prisma/migrations/<dir>/migration.sql
npx prisma migrate resolve --applied <dir_name>
```
Order matters: execute FIRST, then resolve.

**STEP 4 — VERIFY**:
```
npx prisma generate
npx prisma validate
npx prisma migrate status
npx tsc --noEmit 2>&1 | grep 'error TS' | wc -l
```
Verify tables with `npx tsx` script using `$queryRaw` (NOT prisma db execute, NOT node -e).

**PROHIBITED**: prisma migrate reset, prisma db push, bare new PrismaClient()

## After Completion

Update `waypoint.manifest.yaml` to reflect any documents you created or status changes.

---

## Arguments

$ARGUMENTS

---

_WayPoint Migrate command for FastAPI + Domain-Driven Design_