/**
 * Derive — candidate workflows, triangulated from three independent sources.
 *
 *   controls   what a user can click, with the label they actually read
 *   commands   what the backend can be asked to do (the write verbs)
 *   navEdges   where clicking takes them
 *
 * Any one of these alone is weak evidence. A button labelled "Process" could
 * be anything; `MapPost("/api/voyages/{id}/process")` could be an internal
 * job trigger; together they are a candidate CTA with a command behind it.
 *
 * Everything here stays VERBATIM and everything stays a CANDIDATE (ADR-DA-4).
 * The stage does not map "Send to manager" onto the canonical verb `Send`, does
 * not assign severity or surface, and does not invent a command sid. Those are
 * adjudications, they belong to a human at a design-flow proposal, and an
 * audit that pre-empts them produces a ledger nobody agreed to.
 */

import { provenanceHeader } from "../provenance.mjs";
import { readSurvey, writeSurvey, yamlList, parseYamlRows } from "../survey-io.mjs";

/** Words that make a label a navigation, not an action. */
const NAV_ISH = /^(back|close|cancel|home|next|previous|menu|skip)$/i;

/**
 * Score a control against a command route.
 *
 * Confidence is RECORDED, never asserted: a 0.4 join is a hint for a human
 * reading the proposal, and presenting it as a fact would be the kind of
 * plausible-but-unagreed claim the whole cadence exists to prevent.
 */
export function joinConfidence(label, command) {
  const words = tokenize(label);
  if (words.length === 0) return 0;
  const target = tokenize(`${command.handlerName ?? ""} ${command.path ?? ""}`);
  if (target.length === 0) return 0;
  const hits = words.filter((w) => target.includes(w));
  if (hits.length === 0) return 0;
  const coverage = hits.length / words.length;
  // A write verb agreeing with a clickable control is the strongest signal
  // available without running the app's own instrumentation.
  const writeBonus = ["POST", "PUT", "DELETE", "PATCH"].includes(command.method)
    ? 0.2
    : 0;
  return Math.min(1, Number((coverage * 0.8 + writeBonus).toFixed(2)));
}

function tokenize(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\{[^}]*\}/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !["the", "and", "for", "api", "get", "post"].includes(w));
}

/**
 * Candidate CTAs: one row per control, with its best command match if any.
 *
 * Controls that are plainly navigation are kept but marked, because a nav
 * control is still evidence about reachability — it is simply not a command
 * candidate, and silently dropping it would hide half the nav graph.
 */
export function candidateCtas(controls, commands) {
  const byLabel = new Map();
  for (const c of controls) {
    const key = `${c.label}::${c.screen}`;
    const prev = byLabel.get(key);
    if (prev) {
      prev.occurrences++;
      continue;
    }
    byLabel.set(key, { ...c, occurrences: 1 });
  }

  return [...byLabel.values()].map((c) => {
    const scored = commands
      .map((cmd) => ({ cmd, confidence: joinConfidence(c.label, cmd) }))
      .filter((s) => s.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence);
    const best = scored[0];
    return {
      screen: c.screen,
      label: c.label, // VERBATIM — the adjudication input, not a conclusion
      element: c.tag,
      occurrences: c.occurrences,
      looksLikeNavigation: Boolean(c.href) || NAV_ISH.test(c.label),
      candidateCommand: best?.cmd.path ?? null,
      candidateMethod: best?.cmd.method ?? null,
      confidence: best?.confidence ?? 0,
      alternatives: scored.slice(1, 3).map((s) => s.cmd.path).join(" | ") || null,
    };
  });
}

/** Screen-to-screen edges, deduplicated, with the link that produced them. */
export function navGraph(edges) {
  const seen = new Map();
  for (const e of edges) {
    const key = `${e.from} -> ${e.to}`;
    if (!seen.has(key)) seen.set(key, { from: e.from, to: e.to });
  }
  return [...seen.values()].sort((a, b) =>
    `${a.from}${a.to}`.localeCompare(`${b.from}${b.to}`),
  );
}

/** Commands no control appears to invoke — a flow the UI may not expose. */
export function unreachableCommands(commands, ctas) {
  const claimed = new Set(ctas.map((c) => c.candidateCommand).filter(Boolean));
  return commands
    .filter((c) => ["POST", "PUT", "DELETE", "PATCH"].includes(c.method))
    .filter((c) => !claimed.has(c.path))
    .map((c) => ({
      method: c.method,
      path: c.path,
      evidence: c.evidence ?? null,
      note: "no captured control matched this command",
    }));
}

export async function run(ctx) {
  const controls = ctx.controls ?? readRows(ctx, "controls.yaml", "controls");
  const navEdges = ctx.navEdges ?? readRows(ctx, "controls.yaml", "navEdges");
  const commands = ctx.commandRoutes ?? readRows(ctx, "commands.yaml", "commands");

  if (controls.length === 0) {
    return {
      artifacts: [],
      findings: [],
      skipped: "no controls captured — run capture first (T1/T2)",
    };
  }

  const ctas = candidateCtas(controls, commands);
  const graph = navGraph(navEdges);
  const orphans = unreachableCommands(commands, ctas);
  const prov = ctx.provenanceFor("audit/derive");

  const artifacts = [
    writeSurvey(
      ctx.repoRoot,
      "observed-flows.yaml",
      [
        provenanceHeader(prov, [
          "CANDIDATES, verbatim. No canonical verbs, no severity, no surface,",
          "no command sids: those are adjudications a human makes at a",
          "design-flow proposal (ADR-DA-4). Confidence is recorded so a weak",
          "join reads as a hint rather than a claim.",
        ]),
        "version: 1",
        yamlList("candidateCtas", ctas, { style: "block" }),
        yamlList("navEdges", graph),
        yamlList("commandsWithNoControl", orphans, { style: "block" }),
        "",
      ].join("\n"),
    ),
  ];

  const findings = orphans.length
    ? [
        {
          kind: "command-without-control",
          evidence: `${orphans.length} write endpoint(s) with no matching control, e.g. ${orphans[0].method} ${orphans[0].path}`,
          suggests:
            "design-flow — either the UI does not expose it, or the capture missed the screen that does",
        },
      ]
    : [];

  return { artifacts, findings, exports: { candidateCtas: ctas, navGraph: graph } };
}

function readRows(ctx, file, key) {
  const src = readSurvey(ctx.repoRoot, file);
  return src ? parseYamlRows(src, key) : [];
}
