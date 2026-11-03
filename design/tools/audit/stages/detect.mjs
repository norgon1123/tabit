/**
 * Detect — what is this application, and can the audit reach it?
 *
 * Two outputs, and the second one matters more. `stack.yaml` records what was
 * detected and with what confidence. The env-contract SCAFFOLD is the ask:
 * the audit cannot invent a boot command or a seed recipe, and the pilot
 * proved that guessing produces a beautifully measured login page. So when
 * the contract is missing, detect writes a form for a human to fill in and
 * says plainly that the sweep is running at a lower tier until they do.
 */

import { adapter as aspnet } from "../adapters/aspnet-minimal-api.mjs";
import { adapter as viteReactRouter } from "../adapters/vite-react-router.mjs";
import { adapter as nextAppRouter } from "../adapters/next-app-router.mjs";
import { assertAdapter, pickAdapter } from "../adapters/_interface.mjs";
import { ENV_CONTRACT_FILE, scaffoldEnvContract } from "../env-contract.mjs";
import { provenanceHeader } from "../provenance.mjs";
import { surveyExists, writeSurvey, yamlList, yamlScalar } from "../survey-io.mjs";

// Order is not precedence — pickAdapter scores by confidence and records what
// it chose and why. Next is listed first only because it is the host's own
// stack, and the audit having no adapter for the repo it ships in went
// unnoticed until 2026-09-26.
export const ADAPTERS = [nextAppRouter, viteReactRouter, aspnet].map(assertAdapter);

/** Frontend adapters describe screens; backend adapters describe commands. */
export function detectAll(repoRoot, adapters = ADAPTERS) {
  return adapters
    .map((a) => ({ id: a.id, ...a.detect(repoRoot) }))
    .sort((x, y) => (y.confidence ?? 0) - (x.confidence ?? 0) || x.id.localeCompare(y.id));
}

export async function run(ctx) {
  const artifacts = [];
  const findings = [];
  const detected = detectAll(ctx.repoRoot);
  // The primary adapter answers "what screens does this app have", so only a
  // frontend adapter can be it; the backend adapter is recorded separately as
  // the command surface.
  const chosen = pickAdapter(ADAPTERS, ctx.repoRoot, { kind: "frontend" });
  const backend = pickAdapter(ADAPTERS, ctx.repoRoot, { kind: "backend" });

  const prov = ctx.provenanceFor("audit/detect", { viewport: null });
  artifacts.push(
    writeSurvey(
      ctx.repoRoot,
      "stack.yaml",
      [
        provenanceHeader(prov, [
          "Detection is evidence, not certainty: every adapter's score is",
          "recorded so a wrong pick is visible rather than mysterious.",
        ]),
        "version: 1",
        `primaryAdapter: ${yamlScalar(chosen?.adapter.id ?? null)}`,
        `commandAdapter: ${yamlScalar(backend?.adapter.id ?? null)}`,
        `tierAttempted: ${yamlScalar(ctx.tier)}`,
        `envContract: ${yamlScalar(ctx.hasEnvContract ? "present" : "missing")}`,
        yamlList(
          "adapters",
          detected.map((d) => ({
            id: d.id,
            match: Boolean(d.match),
            confidence: d.confidence ?? 0,
            stack: d.stack ?? null,
            router: d.router ?? null,
            kind: ADAPTERS.find((a) => a.id === d.id)?.kind ?? null,
            styling: d.styling ?? null,
            evidence: d.evidence ?? null,
          })),
          { style: "block" },
        ),
        "",
      ].join("\n"),
    ),
  );

  if (!ctx.hasEnvContract && !ctx.dryRun) {
    const front = detected.find((d) => d.match && d.styling);
    artifacts.push(
      writeSurvey(
        ctx.repoRoot,
        ENV_CONTRACT_FILE,
        scaffoldEnvContract({ framework: front?.stack ?? "unknown" }),
      ),
    );
    findings.push({
      kind: "env-contract-missing",
      evidence: "design/survey/env-contract.yaml scaffolded, not filled in",
      suggests:
        "fill in boot + seed, then re-run — until then the audit is source-level (T3) and says so",
    });
  }

  if (!chosen) {
    findings.push({
      kind: "no-adapter",
      evidence: `no adapter matched ${ctx.repoRoot}`,
      suggests:
        "harvest still runs (T3); add an adapter for this stack to reach T1",
    });
  }

  return {
    artifacts,
    findings,
    exports: { adapterId: chosen?.adapter.id ?? null, detected },
  };
}

/** Re-detecting is cheap; every stage that needs adapters asks for them here. */
export function adaptersFor(repoRoot) {
  return ADAPTERS.filter((a) => a.detect(repoRoot)?.match);
}

/** True when the survey already carries a filled-in contract. */
export function hasContract(repoRoot) {
  return surveyExists(repoRoot, ENV_CONTRACT_FILE);
}
