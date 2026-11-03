/**
 * /waypoint.design-audit — the runner.
 *
 * One orchestrating action (D-1). Stages run in order and each one is a pure
 * function of a context plus the filesystem:
 *
 *   detect -> inventory -> capture -> harvest -> derive -> validate
 *
 * Everything it writes lands under design/survey/ (rule:design.audit-observes
 * -only, enforced in survey-io, not by review). Everything it writes carries
 * Provenance including its tier (rule:design.survey-provenance), because the
 * whole value of the artifact depends on a reader knowing whether it was
 * measured or merely declared.
 *
 * Resumability is routes.yaml: no run state, no cache, no lockfile. A sweep
 * interrupted after nine screens resumes at the tenth because row ten still
 * says `todo` (D-1).
 *
 * Usage:
 *   node run.mjs                       full pipeline, resuming
 *   node run.mjs --stage capture       one stage
 *   node run.mjs --force               re-capture rows already done at HEAD
 *   node run.mjs --repo <path>         audit another checkout
 *   node run.mjs --context studio      scope validation to one context
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ENV_CONTRACT_FILE, parseEnvContract, tierFor } from "./env-contract.mjs";
import { provenance } from "./provenance.mjs";
import { isDryRun, readSurvey, setDryRun } from "./survey-io.mjs";

export const STAGE_ORDER = [
  "detect",
  "inventory",
  "capture",
  "harvest",
  // Objects before actions (FP-2, D-6): derive-objects proposes the nouns,
  // then derive attaches verbs to them.
  "derive-objects",
  "derive",
  // The current model is a fold over what the stages above measured, so it runs
  // after them and before validate — which compares it to the record (ADR-MP-2).
  "normalise-model",
  "validate",
];

/** argv -> options. Unknown flags are an error, not a shrug. */
export function parseArgs(argv) {
  const opts = {
    stage: null,
    force: false,
    repoRoot: process.cwd(),
    context: null,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    switch (a) {
      case "--stage":
        opts.stage = next();
        if (!STAGE_ORDER.includes(opts.stage))
          throw new Error(
            `unknown stage: ${opts.stage} (have: ${STAGE_ORDER.join(", ")})`,
          );
        break;
      case "--force":
        opts.force = true;
        break;
      case "--resume":
        opts.force = false; // the default; accepted so the intent can be explicit
        break;
      case "--repo":
        opts.repoRoot = resolve(next());
        break;
      case "--context":
        opts.context = next();
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--help":
      case "-h":
        opts.help = true;
        break;
      default:
        throw new Error(`unknown option: ${a}`);
    }
  }
  return opts;
}

export function headCommit(repoRoot) {
  try {
    return execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    // A directory that is not a git checkout can still be audited; the
    // artifacts then say so rather than carrying a fabricated commit.
    return "unversioned";
  }
}

/**
 * Is Playwright importable FROM THE AUDITED REPO?
 *
 * Module resolution follows the importing file's location, and the runner is
 * bundle-copied into the target repo — the pilot lost twenty minutes to
 * exactly this. Resolving against repoRoot is what makes T1 available without
 * the audit shipping a browser of its own.
 */
export function playwrightAvailable(repoRoot) {
  for (const dir of candidateModuleDirs(repoRoot)) {
    if (existsSync(join(dir, "node_modules", "playwright"))) return true;
    if (existsSync(join(dir, "node_modules", "@playwright", "test")))
      return true;
  }
  return false;
}

/**
 * repoRoot plus its nested app dirs.
 *
 * Three levels deep, because that is where monorepos actually put it:
 * `frontend/apps/paperwork/node_modules`. The pilot's first full run reported
 * "playwright unavailable" on a repo that had it installed — the walk stopped
 * at `frontend/apps` and never looked inside the app itself, which is the
 * same resolution trap as the one this function exists to solve.
 */
export function candidateModuleDirs(repoRoot) {
  const dirs = [repoRoot];
  const subdirs = (dir) => {
    try {
      return readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .map((e) => join(dir, e.name));
    } catch {
      return [];
    }
  };
  for (const nest of ["frontend", "app", "apps", "web", "client", "packages"]) {
    const p = join(repoRoot, nest);
    if (!existsSync(p)) continue;
    dirs.push(p);
    for (const sub of ["apps", "packages"]) {
      const q = join(p, sub);
      if (!existsSync(q)) continue;
      dirs.push(q, ...subdirs(q));
    }
    dirs.push(...subdirs(p).filter((d) => !d.endsWith("node_modules")));
  }
  return [...new Set(dirs)];
}

export function buildContext({ repoRoot, context, force, dryRun }, deps = {}) {
  // Set BEFORE any stage runs: writeSurvey is the single write path and the
  // flag has to be true by the time the first stage calls it (dry-run bug,
  // 2026-09-26 — the flag was plumbed into ctx and the writer never read it).
  setDryRun(dryRun);
  const commit = (deps.headCommit ?? headCommit)(repoRoot);
  const contractSrc = readSurvey(repoRoot, ENV_CONTRACT_FILE);
  const envContract = parseEnvContract(contractSrc);
  const hasPlaywright = (deps.playwrightAvailable ?? playwrightAvailable)(
    repoRoot,
  );
  const tier = tierFor(envContract, { playwrightAvailable: hasPlaywright });
  return {
    repoRoot,
    commit,
    context,
    force: Boolean(force),
    dryRun: Boolean(dryRun),
    // The write path consults this via survey-io's module flag, set below.
    envContract,
    hasEnvContract: Boolean(contractSrc),
    tier,
    viewport: envContract.viewport ?? { width: 1440, height: 900 },
    provenanceFor: (generator, over = {}) =>
      provenance({
        tier,
        commit,
        viewport: envContract.viewport ?? { width: 1440, height: 900 },
        generator,
        ...over,
      }),
  };
}

/** Load a stage lazily so `--stage harvest` never imports the browser code. */
async function loadStage(name) {
  const here = dirname(fileURLToPath(import.meta.url));
  return import(join(here, "stages", `${name}.mjs`));
}

export async function runStages(ctx, stages, { load = loadStage } = {}) {
  const report = { stages: [], artifacts: [], findings: [] };
  for (const name of stages) {
    const mod = await load(name);
    const started = Date.now();
    const result = (await mod.run(ctx)) ?? {};
    const entry = {
      stage: name,
      artifacts: result.artifacts ?? [],
      findings: result.findings ?? [],
      skipped: result.skipped ?? null,
      ms: Date.now() - started,
    };
    report.stages.push(entry);
    report.artifacts.push(...entry.artifacts);
    report.findings.push(...entry.findings);
    // Stages hand the next one what they learned (routes, controls, census)
    // in-process; the files are the durable record, this is just the pipe.
    Object.assign(ctx, result.exports ?? {});
  }
  return report;
}

const HELP = `waypoint design-audit — observe an existing application

  --stage <name>   run one stage (${STAGE_ORDER.join(" | ")})
  --force          re-capture rows already captured at HEAD
  --resume         continue an interrupted sweep (the default)
  --repo <path>    audit a checkout other than the working directory
  --context <slug> scope validation to one design context
  --dry-run        plan the work, write nothing

The audit only ever writes under design/survey/. It records observations;
it never ratifies, approves, or edits the design record.`;

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(HELP);
    return 0;
  }
  const ctx = buildContext(opts);
  const stages = opts.stage ? [opts.stage] : STAGE_ORDER;

  console.log(`audit: ${ctx.repoRoot}`);
  console.log(`commit: ${ctx.commit}`);
  console.log(
    `tier: ${ctx.tier}${ctx.hasEnvContract ? "" : " (no env-contract — source-level only)"}`,
  );
  console.log(`stages: ${stages.join(" -> ")}`);
  console.log("");

  const report = await runStages(ctx, stages);

  for (const s of report.stages) {
    const skipped = s.skipped ? ` — skipped: ${s.skipped}` : "";
    console.log(
      `  ${s.stage.padEnd(10)} ${String(s.artifacts.length).padStart(3)} artifacts  ` +
        `${String(s.findings.length).padStart(3)} findings  ${s.ms}ms${skipped}`,
    );
  }
  console.log("");
  // "would write" under --dry-run: reporting "wrote" when nothing was written
  // is how the original bug stayed invisible — the output claimed the write
  // and the caller had no reason to look.
  console.log(
    `${isDryRun() ? "would write" : "wrote"} ${report.artifacts.length} artifact(s) under design/survey/`,
  );
  if (report.findings.length)
    console.log(`${report.findings.length} finding(s) — see design/survey/gaps.yaml`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`design-audit failed: ${err.message}`);
      process.exit(1);
    });
}
