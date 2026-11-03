#!/usr/bin/env node
/**
 * gate-check — the deterministic half of /waypoint.design-review.
 * (design-feature task-011 step 0; spec C7/C8; DF-FR-035/036/040.7/040.8/060)
 *
 * Checks (file-derivable; language/tokens/a11y run via their own linters):
 *   bijection  — every CTA row names a command (phantom affordances)
 *   lineage    — every slice field's reads_from exists in the object's ledger entry
 *   coverage   — touched contexts must be ratified (provisional passes, D3)
 *   debt       — open non-migration debt for touched contexts fails (D2);
 *                migration debt fails only when its covered files are touched
 *   staleness  — ledger ratified_at older than any linked sid timestamp (D1/DF-FR-060);
 *                sid timestamps supplied via --sids <json> (from `waypoint memory`)
 *   qoc        — decision records carry ≥2 options + criteria before decision (DC-FR-020)
 *   mockup     — post-v2 slices (wireframe present) for touched contexts carry a
 *                hash-valid mockup approval or a recorded skip (DC-FR-063/064/066; AD-2)
 *   unparseable— a file a parser cannot read is a finding, never a silent pass (DC-FR-051)
 *   baseline   — brownfield ratchet (DF-FR-036): `baseline` mode writes it,
 *                `verify` mode fails new violations and any count increase
 *
 * Zero deps; all parsing lives in ./parsers.mjs (AD-2: one parser,
 * three consumers — this tool, the seeded copy, and the platform sync).
 * Deterministic: sorted output, no timestamps in reports.
 *
 * Usage:
 *   node design/tools/gate-check.mjs verify --touched memory[,billing] [--sids sids.json] [--files a.tsx,b.tsx]
 *   node design/tools/gate-check.mjs baseline
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { checkToast } from "./feedback.mjs";
import { join } from "node:path";
import {
  parseCoverage,
  parseCtas,
  parseDebt,
  parseLedgerSubset,
  parseMockupBindings,
  parseQoc,
  parseScreen,
  parseSlice,
  parseSliceMeta,
  parseSliceScreens,
  screenContentHash,
  sliceContentHash,
  sliceWithoutMockup,
} from "./parsers.mjs";

// Re-exported so this module's import surface is unchanged for existing
// consumers — the tests and the seeded tool keep importing from here.
export {
  parseCoverage,
  parseCtas,
  parseDebt,
  parseLedgerSubset,
  parseMockupBindings,
  parseQoc,
  parseScreen,
  parseSlice,
  parseSliceMeta,
  parseSliceScreens,
  screenContentHash,
  sliceContentHash,
  sliceWithoutMockup,
};

const DESIGN_DIR = process.env.GATE_DESIGN_DIR ?? "design";

// ---------------------------------------------------------------------------
// tiny YAML-subset readers (coverage / debt / flow slices share flat shapes)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// checks — each returns findings: { check, severity, detail, fix }
// ---------------------------------------------------------------------------

function loadLedgers(designDir) {
  const dir = join(designDir, "glossary");
  if (!existsSync(dir)) return {};
  const out = {};
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".yaml")).sort()) {
    const src = readFileSync(join(dir, f), "utf8");
    const ctx = f.replace(/\.yaml$/, "");
    out[ctx] = { ...parseLedgerSubset(src), raw: src, ctas: parseCtas(src) };
  }
  return out;
}

/**
 * Unparseable-is-a-finding (DC-FR-051): minimal structural validity per file
 * kind. A file a parser cannot read fails as `unparseable`, never a silent pass.
 */
export function unparseableFinding(file, why) {
  return {
    check: "unparseable",
    severity: "fail",
    detail: `${file}: ${why}`,
    fix: "repair the file structure — see the schema comment header (plan md-ux-craft §3)",
  };
}

/**
 * Every statechart belongs to a screen that exists.
 *
 * Nothing checked this. A machine is reachable only through its filename —
 * slices carry a `machine:` key that NOTHING reads and that no slice has ever
 * set (0 of 25) — so an orphan has no other way to be noticed.
 *
 * A machine may be named for a SCREEN or for a SLICE, and both are legitimate.
 * Five of the six shipped machines take a screen's name; academy.reorder.ts
 * takes its slice's, and says so in its own docstring. The first version of
 * this check accepted only screens and failed that file — a check strict
 * enough to reject working artifacts teaches people to ignore it.
 *
 * Only the orphan direction is reported. The inverse — a moded screen with NO
 * machine — is not: "moded" is not a property any artifact declares, so
 * deciding it would mean inferring modes from a wireframe, and the gate does
 * not guess.
 */
/**
 * Every CTA's `roles:` names a role that exists.
 *
 * `roles` was on every CTA row and read by NOTHING, so it drifted: of 59
 * references across the design record, 39 named a role this application does
 * not have. `member` (27 uses) and `admin` (12) are not roles at all;
 * `super-admin` is the right role with the wrong separator, which matches
 * nothing at runtime while looking correct in review.
 *
 * The vocabulary comes from design/glossary/_shared.yaml, whose rows carry the
 * evidence they were read from — the AppRole table seeded by
 * scripts/seed-rbac.ts. This check compares one against the other; it does not
 * decide what a wrong role SHOULD be. Renaming 27 `member` rows is an
 * adjudication, and the gate does not adjudicate.
 *
 * Findings are ratcheted, not fatal on day one: the repo starts with 39 and
 * the baseline holds them, so existing rows keep working and no NEW wrong role
 * can be added. That is the same posture the language check takes toward
 * vocabulary it inherited.
 */
/**
 * A success toast follows the feedback grammar.
 *
 * Every slice authored one; nothing read it; nothing checked it — and
 * "Action reorderd" sat in the record. Authored copy that no surface renders
 * and no gate reads is copy nobody proofreads.
 *
 * Narrow on purpose: it checks a toast that EXISTS. Saying "no toast" is
 * legitimate and is said two ways (`null`, and prose beginning "none"), and a
 * mutation can rightly have none — an inline edit's feedback is the row
 * returning to text. Deciding which mutations owe a toast is a design
 * judgment; spelling is not.
 */
export function checkFeedback(designDir, touched) {
  const findings = [];
  const dir = join(designDir, "flows");
  if (!existsSync(dir)) return findings;
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".yaml")).sort()) {
    if (!touched.includes(f.split(".")[0])) continue;
    const src = readFileSync(join(dir, f), "utf8");
    // Strip the trailing YAML comment. `success: null  # navigation` is not
    // the string "null", and treating it as one reported every read-only
    // slice in the repo — ten findings, none of them real.
    const uncomment = (v) => v?.replace(/\s+#.*$/, "").trim();
    const scalar = (k) => uncomment((src.match(new RegExp(`^${k}:\\s*(.*)$`, "m")) ?? [])[1]);
    const success = uncomment((src.match(/^\s{2}success:\s*(.*)$/m) ?? [])[1]);
    const problems = checkToast({
      cta: scalar("cta"),
      object: scalar("object"),
      success: success?.replace(/^["']|["']$/g, ""),
    });
    for (const p of problems) {
      findings.push({
        check: "feedback-grammar",
        severity: "fail",
        detail: `flows/${f}: ${p}`,
        fix: "match the grammar, or say `success: null` if the action owes no toast",
      });
    }
  }
  return findings;
}

export function checkRoles(designDir, touched) {
  const findings = [];
  const sharedPath = join(designDir, "glossary", "_shared.yaml");
  if (!existsSync(sharedPath)) return findings;
  const shared = readFileSync(sharedPath, "utf8");
  const rolesBlock = shared.match(/^roles:\n((?:[ \t].*\n?)*)/m);
  if (!rolesBlock) return findings;
  const declared = new Set(
    [...rolesBlock[1].matchAll(/^  ([a-z][\w-]*):\s*$/gm)].map((m) => m[1]),
  );
  if (declared.size === 0) return findings;

  const dir = join(designDir, "glossary");
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".yaml")).sort()) {
    const ctx = f.replace(/\.yaml$/, "");
    if (ctx.startsWith("_") || !touched.includes(ctx)) continue;
    const src = readFileSync(join(dir, f), "utf8");
    for (const m of src.matchAll(/^\s*roles:\s*\[([^\]]*)\]/gm)) {
      for (const raw of m[1].split(",")) {
        const role = raw.trim().replace(/^["']|["']$/g, "");
        if (!role || declared.has(role)) continue;
        findings.push({
          // The role is IN the check name, so the ratchet counts per role
          // rather than per check. A single `role-undeclared: 43` would be
          // useless: verify is scoped by --touched and always sees fewer than
          // a repo-wide baseline, so every scoped run would pass — including
          // one that added a new wrong role. The language check baselines per
          // term for the same reason.
          // Hyphen, not a colon. The baseline reader matches `^ {2}([\w-]+):`
          // so a colon in a check name is written to the ratchet and never
          // read back — the baseline silently reads 0 and every inherited
          // violation fails forever. Found by testing the ratchet instead of
          // assuming it.
          check: `role-undeclared-${role}`,
          severity: "warn",
          detail: `glossary/${f}: CTA role \`${role}\` is not declared in _shared.yaml`,
          fix: `use one of ${[...declared].join(", ")}, or add \`${role}\` to _shared.yaml with the evidence it exists`,
        });
      }
    }
  }
  return findings;
}

export function checkMachines(designDir, touched) {
  const findings = [];
  const dir = join(designDir, "machines");
  if (!existsSync(dir)) return findings;
  for (const f of readdirSync(dir).filter((n) => /\.(ts|js)$/.test(n)).sort()) {
    const stem = f.replace(/\.(ts|js)$/, "");
    const context = stem.split(".")[0];
    if (!touched.includes(context)) continue;
    if (existsSync(join(designDir, "screens", `${stem}.yaml`))) continue;
    if (existsSync(join(designDir, "flows", `${stem}.yaml`))) continue;
    findings.push({
      check: "machine-orphan",
      severity: "fail",
      detail: `machines/${f}: no screen at screens/${stem}.yaml and no slice at flows/${stem}.yaml`,
      fix: `create the screen or slice with /waypoint.design-flow ${context} ${stem.split(".").slice(1).join(".")}, or delete the machine`,
    });
  }
  return findings;
}

export function checkParseable(designDir, touched) {
  const findings = [];
  const covPath = join(designDir, "coverage.yaml");
  if (existsSync(covPath) && !/^contexts:/m.test(readFileSync(covPath, "utf8"))) {
    findings.push(unparseableFinding("coverage.yaml", "no top-level `contexts:` map"));
  }
  const debtPath = join(designDir, "debt.yaml");
  if (existsSync(debtPath) && !/^entries:/m.test(readFileSync(debtPath, "utf8"))) {
    findings.push(unparseableFinding("debt.yaml", "no top-level `entries:` list"));
  }
  const glossDir = join(designDir, "glossary");
  if (existsSync(glossDir)) {
    for (const f of readdirSync(glossDir).filter((n) => n.endsWith(".yaml")).sort()) {
      const ctx = f.replace(/\.yaml$/, "");
      if (!touched.includes(ctx) && !ctx.startsWith("_")) continue;
      if (!/^context:/m.test(readFileSync(join(glossDir, f), "utf8"))) {
        findings.push(unparseableFinding(`glossary/${f}`, "no top-level `context:` key"));
      }
    }
  }
  const flowDir = join(designDir, "flows");
  if (existsSync(flowDir)) {
    for (const f of readdirSync(flowDir).filter((n) => n.endsWith(".yaml")).sort()) {
      if (!touched.includes(f.split(".")[0])) continue;
      if (!/^object:/m.test(readFileSync(join(flowDir, f), "utf8"))) {
        findings.push(unparseableFinding(`flows/${f}`, "no top-level `object:` key"));
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// QOC integrity (DC-FR-020): ≥2 options, criteria before decision
// ---------------------------------------------------------------------------

export function checkQocIntegrity(designDir, touched) {
  const findings = [];
  const dir = join(designDir, "decisions");
  if (!existsSync(dir)) return findings;
  for (const f of readdirSync(dir).filter((n) => /^QOC-.+\.md$/.test(n)).sort()) {
    const ctx = f.replace(/^QOC-/, "").replace(/-\d+\.md$/, "");
    if (!touched.includes(ctx)) continue;
    const qoc = parseQoc(readFileSync(join(dir, f), "utf8"));
    if (!qoc) {
      findings.push(unparseableFinding(`decisions/${f}`, "missing `## Options` or `## Decision` heading"));
      continue;
    }
    if (qoc.optionCount < 2) {
      findings.push({
        check: "qoc",
        severity: "fail",
        detail: `decisions/${f}: ${qoc.optionCount} option(s) — a decision without alternatives is a default, not a choice`,
        fix: "record ≥2 genuinely different options with trade-offs (DC-FR-020)",
      });
    }
    if (!qoc.criteriaBeforeDecision) {
      findings.push({
        check: "qoc",
        severity: "fail",
        detail: `decisions/${f}: no \`## Criteria\` section before \`## Decision\``,
        fix: "state the criteria before scoring options, then decide (DC-FR-020)",
      });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Mockup approval (DC-FR-063/064/066): hash-valid approval before implement
// ---------------------------------------------------------------------------

export function checkMockupApproval(designDir, touched, debt = []) {
  const findings = [];
  const flowDir = join(designDir, "flows");
  if (!existsSync(flowDir)) return findings;
  for (const f of readdirSync(flowDir).filter((n) => n.endsWith(".yaml")).sort()) {
    if (!touched.includes(f.split(".")[0])) continue;
    const src = readFileSync(join(flowDir, f), "utf8");
    const meta = parseSliceMeta(src);
    if (!meta.hasWireframe) continue; // v1 slice — exempt by construction
    const skip = debt.some(
      (e) =>
        e.trigger === "mockup-skip" &&
        (Array.isArray(e.files) ? e.files : []).some((p) => p.endsWith(f)),
    );
    if (skip) continue;
    if (!meta.mockup?.content_hash) {
      findings.push({
        check: "mockup",
        severity: "fail",
        detail: `flows/${f}: post-v2 slice has no mockup approval`,
        fix: "run /waypoint.design-implement step 0 (render, present, approve), or record an explicit skip (trigger: mockup-skip) in design/debt.yaml",
      });
      continue;
    }
    const expected = sliceContentHash(src);
    if (meta.mockup.content_hash !== expected) {
      findings.push({
        check: "mockup",
        severity: "fail",
        detail: `flows/${f}: mockup approval is stale (recorded ${meta.mockup.content_hash}, slice now ${expected})`,
        fix: "the slice changed after approval — re-approve via /waypoint.design-implement step 0",
      });
    }
  }
  return findings;
}

export function checkBijection(ledgers, touched) {
  const findings = [];
  for (const ctx of touched) {
    for (const row of ledgers[ctx]?.ctas ?? []) {
      if (!row.command) {
        findings.push({
          check: "bijection",
          severity: "fail",
          detail: `${ctx}: CTA '${row.verb ?? "?"} ${row.object ?? "?"}' has no command sid (phantom affordance)`,
          fix: `bind the CTA to a command in design/glossary/${ctx}.yaml or remove the affordance`,
        });
      }
      if (row.command && !row.severity) {
        findings.push({
          check: "bijection",
          severity: "fail",
          detail: `${ctx}: CTA '${row.verb} ${row.object}' missing severity annotation`,
          fix: "assign severity from the doctrine ladder (recoverable | irreversible | irreversible-high-value)",
        });
      }
    }
  }
  return findings;
}

export function checkLineage(designDir, ledgers, touched) {
  const findings = [];
  const flowDir = join(designDir, "flows");
  if (!existsSync(flowDir)) return findings;
  for (const f of readdirSync(flowDir).filter((n) => n.endsWith(".yaml")).sort()) {
    const ctx = f.split(".")[0];
    if (!touched.includes(ctx)) continue;
    const slice = parseSlice(readFileSync(join(flowDir, f), "utf8"));
    const term = slice.object && ledgers[ctx]?.terms?.[slice.object];
    const declared = term?.reads_from ?? [];
    for (const { field, reads_from } of slice.fields) {
      if (!reads_from) {
        findings.push({
          check: "lineage",
          severity: "fail",
          detail: `${f}: field '${field}' has no reads_from source`,
          fix: "declare the read model that feeds this field in the slice",
        });
      } else if (declared.length > 0 && !declared.includes(reads_from)) {
        findings.push({
          check: "lineage",
          severity: "fail",
          detail: `${f}: field '${field}' reads from '${reads_from}' which is not in the ledger's reads_from for '${slice.object}'`,
          fix: `add '${reads_from}' to the ledger entry or correct the slice`,
        });
      }
    }
  }
  return findings;
}

export function checkCoverage(coverage, touched) {
  const findings = [];
  for (const ctx of touched) {
    const c = coverage[ctx];
    for (const artifact of ["glossary", "objects"]) {
      const state = c?.[artifact] ?? "missing";
      if (state === "missing" || state === "stale" || state === "draft") {
        findings.push({
          check: "coverage",
          severity: "fail",
          detail: `${ctx}.${artifact} is ${state}`,
          fix: `run /waypoint.design-model ${ctx}`,
        });
      }
    }
  }
  return findings;
}

export function checkDebt(debt, touched, touchedFiles = []) {
  const findings = [];
  for (const e of debt) {
    if (e.resolved && e.resolved !== "null") continue;
    if (!touched.includes(e.context)) continue;
    const isMigration = e.trigger === "migration" || e.type === "migration";
    if (isMigration) {
      const covered = Array.isArray(e.files) ? e.files : [];
      const hit = covered.filter((f) => touchedFiles.includes(f));
      if (hit.length === 0) continue;
      findings.push({
        check: "debt",
        severity: "fail",
        detail: `${e.context}: migration debt covers touched file(s) ${hit.join(", ")}`,
        fix: "complete the migration for these files in this PR, or leave them untouched",
      });
    } else {
      findings.push({
        check: "debt",
        severity: "fail",
        detail: `${e.context}: open debt (${e.artifact}, task ${e.task ?? "?"}, ${e.date ?? "?"})`,
        fix: `run /waypoint.design-model ${e.context} (clears the debt) before merging UI for it`,
      });
    }
  }
  return findings;
}

export function checkStaleness(coverage, sidTimestamps, touched) {
  const findings = [];
  if (!sidTimestamps) return findings;
  for (const ctx of touched) {
    const c = coverage[ctx];
    if (!c?.ratified_at || !c?.ratified_sids) continue;
    for (const sid of c.ratified_sids) {
      const changed = sidTimestamps[sid];
      if (changed && changed > c.ratified_at) {
        findings.push({
          check: "staleness",
          severity: "fail",
          detail: `${ctx}: linked sid '${sid}' changed at ${changed}, after ratification (${c.ratified_at})`,
          fix: `re-run /waypoint.design-model ${ctx} to re-ratify against the current domain model`,
        });
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// baseline (DF-FR-036): counts per check; verify = no new, no increase
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Screen checks (design-preflight T06; DP-FR-004/020/050/051)
// ---------------------------------------------------------------------------

/** Doctrine-owned; extending the set is QOC-gated at org tier, like the verbs. */
const ARCHETYPES = ["list", "detail", "form", "dashboard", "wizard"];
const APPROVAL_STATES = ["proposed", "approved", "rejected", "stale"];
const COPY_VARIANTS = ["first_use", "no_results", "error", "no_permission"];
/** approved_by must be a person. Narrow, mechanical guard — not a judgment. */
const AGENT_NAME = /^(md-ux-|agent\b|claude\b|bot\b|system\b)/i;

/** Screens of a touched context, with their contributing slices (AD-4). */
function loadScreens(designDir, touched) {
  const dir = join(designDir, "screens");
  if (!existsSync(dir)) return [];
  const flowDir = join(designDir, "flows");
  const flows = existsSync(flowDir)
    ? readdirSync(flowDir).filter((f) => f.endsWith(".yaml")).sort()
    : [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") && !f.startsWith("_"))
    .sort()
    .map((f) => {
      const [context, screen] = f.replace(/\.yaml$/, "").split(".");
      return { file: f, context, screen, src: readFileSync(join(dir, f), "utf8") };
    })
    .filter((s) => touched.includes(s.context))
    .map((s) => ({
      ...s,
      slices: flows
        .filter((f) => f.startsWith(`${s.context}.`))
        .map((f) => ({ file: f, src: readFileSync(join(flowDir, f), "utf8") }))
        .filter(({ src }) => parseSliceScreens(src).includes(s.screen)),
    }));
}

export function checkScreenIntegrity(designDir, touched) {
  const findings = [];
  for (const sc of loadScreens(designDir, touched)) {
    const meta = parseScreen(sc.src);
    if (!meta.screen || !meta.context) {
      findings.push(unparseableFinding(`screens/${sc.file}`, "no top-level `context:`/`screen:`"));
      continue;
    }
    // Adoption safety (DP-NFR-010): a screen with no wireframe predates the
    // contract — the same rule that exempts v1 slices from the mockup gate.
    // Screens created by migrating existing slices land here until their first
    // design.flow run, and must not become a wall of new failures.
    if (!meta.hasWireframe) continue;
    if (!meta.archetype || !ARCHETYPES.includes(meta.archetype)) {
      findings.push({
        check: "screen",
        severity: "fail",
        detail: `screens/${sc.file}: archetype '${meta.archetype ?? "(none)"}' is not a doctrine archetype`,
        fix: `name one of ${ARCHETYPES.join(" | ")} — extending the set is QOC-gated at org tier`,
      });
    }
    const missing = COPY_VARIANTS.filter((v) => !meta.copyVariants.includes(v));
    if (missing.length > 0) {
      findings.push({
        check: "screen",
        severity: "fail",
        detail: `screens/${sc.file}: empty-state copy missing ${missing.join(", ")}`,
        fix: "author all four variants — a silent blank region is a review failure",
      });
    }
    if (meta.mockup?.content_hash) {
      const expected = screenContentHash(
        sc.src,
        sc.slices.map((s) => s.src),
      );
      if (expected !== meta.mockup.content_hash) {
        findings.push({
          check: "screen",
          severity: "fail",
          detail:
            `screens/${sc.file}: approval is stale — the screen or one of its ` +
            `${sc.slices.length} contributing slice(s) changed since it was approved`,
          fix: `re-approve via /waypoint.design-implement ${meta.context} ${meta.screen}`,
        });
      }
    }
  }
  return findings;
}

export function checkApprovalState(designDir, touched) {
  const findings = [];
  for (const sc of loadScreens(designDir, touched)) {
    const meta = parseScreen(sc.src);
    if (!meta.mockup) continue;
    const state = meta.mockup.state;
    if (state && !APPROVAL_STATES.includes(state)) {
      findings.push({
        check: "approval",
        severity: "fail",
        detail: `screens/${sc.file}: state '${state}' is not ${APPROVAL_STATES.join(" | ")}`,
        fix: "use a doctrine approval state",
      });
    }
    if (state === "approved") {
      const by = meta.mockup.approved_by;
      if (!by || AGENT_NAME.test(by)) {
        findings.push({
          check: "approval",
          severity: "fail",
          detail: `screens/${sc.file}: approved_by '${by ?? "(empty)"}' is not a person`,
          fix: "approval is a human act — an agent never writes `approved` (DP-FR-026)",
        });
      }
    }
  }
  return findings;
}

export function checkMockupBijection(designDir, touched, ledgers) {
  const findings = [];
  for (const sc of loadScreens(designDir, touched)) {
    const meta = parseScreen(sc.src);
    if (!meta.mockup?.content_hash) continue; // nothing approved yet — not this check's business
    const path = join(designDir, "mockups", `${sc.context}.${sc.screen}.html`);
    if (!existsSync(path)) {
      findings.push({
        check: "mockup-bijection",
        severity: "fail",
        detail: `screens/${sc.file}: approved, but design/mockups/${sc.context}.${sc.screen}.html is missing`,
        fix: `render it: /waypoint.design-implement ${sc.context} ${sc.screen}`,
      });
      continue;
    }
    const bindings = parseMockupBindings(readFileSync(path, "utf8"));
    if (!bindings) {
      findings.push(unparseableFinding(`mockups/${sc.context}.${sc.screen}.html`, "no data-wp-* bindings"));
      continue;
    }
    if (bindings.hasScript) {
      findings.push({
        check: "mockup-bijection",
        severity: "fail",
        detail: `mockups/${sc.context}.${sc.screen}.html carries a <script>`,
        fix: "a mockup has zero logic; the annotation overlay is CSS only (DP-FR-005)",
      });
    }
    // Screen-scoped, not slice-scoped: the CTAs reachable here come from EVERY
    // slice naming this screen, which is the whole point of SD-4.
    //
    // Reachability is a (verb, object) PAIR, not a verb. A slice names both,
    // and matching on the verb alone means a context where one verb applies
    // to many objects demands every one of them on every screen: agent-
    // framework has nine `edit` rows, so feature-form — fed by a single
    // `edit feature` slice — was asked to render `edit agent`, `edit
    // template` and seven more. Nine false failures from one screen.
    const key = (verb, object) => `${verb} :: ${object}`;
    const reachable = new Set(
      sc.slices
        .map(({ src }) => {
          const verb = (src.match(/^cta:\s*(\S+)/m) ?? [])[1];
          const object = (src.match(/^object:\s*(.+)$/m) ?? [])[1]?.replace(/\s*#.*$/, "").trim();
          return verb && object ? key(verb, object) : null;
        })
        .filter(Boolean),
    );
    const rows = (ledgers[sc.context]?.ctas ?? []).filter((r) =>
      reachable.has(key(r.verb, r.object)),
    );
    const rendered = new Set(bindings.controls.map((c) => c.cta));
    for (const row of rows) {
      // A page-surface CTA NAVIGATES. Its control belongs on the screen that
      // OFFERS it, not on the one it lands on — and the form archetype's own
      // commit control is Save, by contract. Demanding otherwise asks a form
      // to render the button that opened it, and a form serving both `create`
      // and `edit` to render two primaries, which the budget forbids anyway.
      //
      // Scoped to `form` deliberately: a detail screen reached by `view` does
      // carry actions on the object it is showing, so the general case stays
      // checked. Slice screen ORDER cannot decide this — `view agent` lists
      // its offering screen first and `create feature` lists its destination
      // first, so position carries no meaning to lean on.
      if (meta.archetype === "form" && row.surface === "page") continue;
      if (!rendered.has(row.verb)) {
        findings.push({
          check: "mockup-bijection",
          severity: "fail",
          detail: `mockups/${sc.context}.${sc.screen}.html: CTA '${row.verb} ${row.object}' is reachable on this screen but not rendered`,
          fix: "re-render the mockup so every reachable CTA appears as an annotated control",
        });
      }
    }
    for (const control of bindings.controls) {
      if (!rows.some((r) => r.verb === control.cta)) {
        findings.push({
          check: "mockup-bijection",
          severity: "fail",
          detail: `mockups/${sc.context}.${sc.screen}.html: control '${control.cta}' traces to no CTA row for this screen`,
          fix: "remove the control, or add the CTA to the matrix and a slice that lands it here",
        });
      }
    }
  }
  return findings;
}

export function summarize(findings) {
  const counts = {};
  for (const f of findings) counts[f.check] = (counts[f.check] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort());
}

export function compareBaseline(baseline, current) {
  const findings = [];
  for (const [check, n] of Object.entries(current)) {
    const base = baseline[check] ?? 0;
    if (n > base) {
      findings.push({
        check: "baseline",
        severity: "fail",
        detail: `${check}: ${n} violation(s) vs baseline ${base} — the ratchet only turns one way`,
        fix: "fix the new violations, or the touched files' share of old ones",
      });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// runner
// ---------------------------------------------------------------------------

export function runChecks({ designDir = DESIGN_DIR, touched = [], touchedFiles = [], sidTimestamps = null }) {
  const ledgers = loadLedgers(designDir);
  const coveragePath = join(designDir, "coverage.yaml");
  const debtPath = join(designDir, "debt.yaml");
  const coverage = existsSync(coveragePath) ? parseCoverage(readFileSync(coveragePath, "utf8")) : {};
  const debt = existsSync(debtPath) ? parseDebt(readFileSync(debtPath, "utf8")) : [];

  return [
    ...checkParseable(designDir, touched),
    ...checkMachines(designDir, touched),
    ...checkRoles(designDir, touched),
    ...checkFeedback(designDir, touched),
    ...checkCoverage(coverage, touched),
    ...checkBijection(ledgers, touched),
    ...checkLineage(designDir, ledgers, touched),
    ...checkDebt(debt, touched, touchedFiles),
    ...checkStaleness(coverage, sidTimestamps, touched),
    ...checkQocIntegrity(designDir, touched),
    ...checkMockupApproval(designDir, touched, debt),
    ...checkScreenIntegrity(designDir, touched),
    ...checkApprovalState(designDir, touched),
    ...checkMockupBijection(designDir, touched, ledgers),
  ];
}

const USAGE = `gate-check.mjs — the design fitness gate (DF-FR-036)

Usage:
  gate-check.mjs verify   --touched <ctx[,ctx]> [--files a,b] [--sids sids.json]
  gate-check.mjs baseline --touched <ctx[,ctx]> [--files a,b] [--force]

Modes:
  verify    Run the checks. Exit 1 on findings not covered by the baseline.
  baseline  Record today's findings as the baseline this repo starts from.
            The count may only shrink after that — new findings fail.

Options:
  --touched  Bounded contexts to check. REQUIRED. Every check short-circuits
             on it — untouched contexts are never checked (the strangler
             property) — so omitting it checks nothing at all.
  --files    Touched file paths; scopes migration debt.
  --sids     JSON file of sid timestamps; enables the staleness check.
  --force    baseline only: permit writing an empty ratchet over a non-empty
             one. The ratchet only turns one way, so this needs saying out loud.
  --help     This text.

Exit: 0 pass · 1 gate findings · 2 usage error`;

/** Parse a baseline file into {check: count}. */
export function readBaseline(path) {
  const base = {};
  if (!existsSync(path)) return base;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^ {2}([\w-]+):\s*(\d+)$/);
    if (m) base[m[1]] = Number(m[2]);
  }
  return base;
}

function main() {
  const [mode, ...args] = process.argv.slice(2);
  const has = (flag) => args.includes(flag);
  const argOf = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };

  // `baseline --help` used to parse --help as an argument and RUN the command,
  // overwriting the ratchet. Help is handled before anything reads the disk.
  if (!mode || mode === "--help" || mode === "-h" || has("--help") || has("-h")) {
    console.log(USAGE);
    return 0;
  }
  if (mode !== "verify" && mode !== "baseline") {
    console.error(`unknown mode '${mode}'\n\n${USAGE}`);
    return 2;
  }

  const touched = (argOf("--touched") ?? "").split(",").filter(Boolean);
  if (touched.length === 0) {
    console.error(
      `${mode}: --touched is required — every check short-circuits on it, so ` +
        `omitting it checks nothing` +
        (mode === "baseline"
          ? " and would record an empty ratchet over your real one."
          : " and always passes.") +
        `\n\n${USAGE}`,
    );
    return 2;
  }

  const touchedFiles = (argOf("--files") ?? "").split(",").filter(Boolean);
  const sidsFile = argOf("--sids");
  const sidTimestamps = sidsFile ? JSON.parse(readFileSync(sidsFile, "utf8")) : null;
  const baselinePath = join(DESIGN_DIR, "baseline.yaml");

  const findings = runChecks({ touched, touchedFiles, sidTimestamps });

  if (mode === "baseline") {
    const counts = summarize(findings);
    const previous = readBaseline(baselinePath);
    if (
      Object.keys(counts).length === 0 &&
      Object.keys(previous).length > 0 &&
      !has("--force")
    ) {
      console.error(
        `baseline: refusing to replace a non-empty ratchet ` +
          `(${JSON.stringify(previous)}) with an empty one. Either the ` +
          `contexts named by --touched do not cover it, or the findings are ` +
          `genuinely resolved — in which case pass --force.`,
      );
      return 2;
    }
    const body = [
      "# design/baseline.yaml — the findings this repo started with (DF-FR-036).",
      "# MACHINE-WRITTEN. The counts below may only shrink; anything new fails.",
      "version: 1",
      "counts:",
    ]
      .concat(Object.entries(counts).map(([k, v]) => `  ${k}: ${v}`))
      .join("\n");
    writeFileSync(baselinePath, `${body}\n`);
    console.log(`baseline written: ${JSON.stringify(counts)}`);
    return 0;
  }

  let all = findings;
  if (existsSync(baselinePath)) {
    all = compareBaseline(readBaseline(baselinePath), summarize(findings));
  }

  for (const f of all) {
    console.log(`FAIL [${f.check}] ${f.detail}\n  fix: ${f.fix}`);
  }
  if (all.length === 0) console.log("GATE: PASS (deterministic checks)");
  else console.log(`GATE: FAIL — ${all.length} finding(s)`);
  return all.length === 0 ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
