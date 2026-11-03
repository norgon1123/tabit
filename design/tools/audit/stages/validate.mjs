/**
 * Validate — observed reality diffed against the design record.
 *
 * Two rules shape every line of this stage.
 *
 * rule:design.audit-same-parser — the diff is computed with the AUDITED
 * repo's own `design/tools/parsers.mjs`, the same module its gate runs. A gap
 * produced by a different parser than enforcement is not a finding about the
 * design; it is a finding about two parsers, and it would waste the reader's
 * afternoon proving that.
 *
 * D-2 — findings live in design/survey/gaps.yaml and NOWHERE else. The audit
 * never writes coverage.yaml, because coverage records what a human ratified
 * and gaps record what a machine saw, and a file that mixed them would teach
 * the next gate to confuse the two.
 *
 * And one working principle: FALSE POSITIVES ARE FATAL HERE. A gap report
 * that cries wolf gets skimmed, then ignored, then deleted. Where the audit
 * cannot know something — a screen with no declared route, a relationship
 * whose representation cannot be observed — it says so in `notComputed`
 * instead of guessing. An honest blank beats a confident invention.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve, relative, sep } from "node:path";

import { provenanceHeader } from "../provenance.mjs";
import { readSurvey, writeSurvey, yamlList, parseYamlRows } from "../survey-io.mjs";

/**
 * Import the audited repo's parsers, asserting the path stays inside it.
 * A parsers module from anywhere else would silently re-introduce the parser
 * skew this rule exists to prevent.
 */
export async function loadRepoParsers(repoRoot) {
  const target = resolve(repoRoot, "design", "tools", "parsers.mjs");
  const rel = relative(resolve(repoRoot), target);
  if (rel.startsWith("..") || rel.startsWith(`..${sep}`)) {
    throw new Error("parsers.mjs must come from the audited repo");
  }
  if (!existsSync(target)) return null;
  return import(`file://${target}`);
}

const FUNCTION_WORDS = new Set([
  "the", "a", "an", "and", "or", "to", "for", "of", "in", "on", "at", "by",
  "with", "from", "this", "all", "new", "your", "my", "is", "are", "be",
]);

/** Ledger nouns and banned synonyms, flattened per context. */
export function ledgerIndex(parsers, repoRoot) {
  const dir = join(repoRoot, "design", "glossary");
  const contexts = {};
  if (!existsSync(dir)) return contexts;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".yaml"))) {
    const context = file.replace(/\.yaml$/, "");
    const src = readFileSync(join(dir, file), "utf8");
    const parsed = parsers.parseLedgerSubset(src) ?? {};
    const terms = parsed.terms ?? {};
    const banned = [];
    for (const [term, row] of Object.entries(terms)) {
      for (const key of ["banned_synonyms", "banned_synonyms_migration", "banned_synonyms_local"]) {
        for (const word of listify(row?.[key])) {
          banned.push({
            word: String(word).toLowerCase(),
            insteadUse: term,
            // A migration ban is a WARNING by doctrine: the strings exist and
            // are being migrated. Reporting it as an error would fail a build
            // for work that is already acknowledged.
            level: key === "banned_synonyms_migration" ? "warning" : "error",
            scope: key === "banned_synonyms_local" ? "local" : "global",
          });
        }
      }
    }
    contexts[context] = {
      terms: Object.keys(terms).map((t) => t.toLowerCase()),
      banned,
      ctas: parsers.parseCtas(src) ?? [],
    };
  }
  return contexts;
}

function listify(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return String(v)
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * A banned synonym appearing in a control a user reads.
 *
 * The highest-precision check in the stage: the ledger names the word, the
 * capture recorded it verbatim, and the only judgement is a word-boundary
 * match. Nothing here is inferred.
 */
export function bannedSynonymGaps(controls, ledgers) {
  const gaps = [];
  for (const [context, ledger] of Object.entries(ledgers)) {
    for (const ban of ledger.banned) {
      const re = new RegExp(`\\b${escapeRe(ban.word)}\\b`, "i");
      const hits = controls.filter((c) => re.test(prose(c.label)));
      if (hits.length === 0) continue;
      gaps.push({
        kind: "banned-synonym-observed",
        context,
        term: ban.word,
        level: ban.level,
        evidence: `${hits.length} control(s), e.g. "${hits[0].label}" on ${hits[0].screen}`,
        insteadUse: ban.insteadUse,
        suggests:
          ban.level === "warning"
            ? "migration debt — the ledger already expects these strings to change"
            : "design-model — the ledger bans this word; the UI still says it",
      });
    }
  }
  return gaps;
}

/**
 * Strip identifiers before matching prose.
 *
 * `Module.cruise-line-rent` contains "line" and is not a user-facing word: it
 * is a key that happens to be rendered. Matching it reported a banned-synonym
 * violation for a string nobody chose, which is the kind of row that teaches
 * a reader to stop trusting the list.
 */
export function prose(label) {
  return String(label ?? "")
    .split(/\s+/)
    .filter((w) => !/[.]/.test(w) && !/^[A-Z0-9_-]{3,}$/.test(w))
    .join(" ");
}

/**
 * CTA coverage in both directions.
 *
 * Scoped project-wide rather than per-screen on purpose: without a declared
 * route, the audit cannot say WHICH screen should carry a CTA, and inventing
 * that mapping is how a report starts lying. "No control anywhere invokes
 * this verb on this object" is a claim the evidence actually supports.
 */
export function ctaGaps(controls, ledgers) {
  const labels = controls.map((c) => String(c.label ?? "").toLowerCase());
  const gaps = [];

  for (const [context, ledger] of Object.entries(ledgers)) {
    for (const cta of ledger.ctas) {
      if (!cta.verb || !cta.object) continue;
      if (String(cta.status ?? "").includes("provisional")) continue;
      const verb = String(cta.verb).toLowerCase();
      const objectHead = String(cta.object).toLowerCase().split(/\s+/).pop();
      const seen = labels.some((l) => l.includes(verb) && l.includes(objectHead));
      if (seen) continue;
      const verbSeen = labels.some((l) => l.includes(verb));
      gaps.push({
        kind: "matrixed-cta-not-observed",
        context,
        cta: `${cta.verb} ${cta.object}`,
        command: cta.command ?? null,
        evidence: verbSeen
          ? `the verb appears in the UI but never with "${objectHead}"`
          : "no captured control carries this verb",
        suggests:
          "design-flow — either the screen that offers it was not captured, or the CTA is unbuilt",
      });
    }
  }

  return gaps;
}

/**
 * Observed actions the ledger does not carry.
 *
 * Only "verb + noun" shaped labels are considered, because that is the shape
 * doctrine requires of a button — anything else is prose, and treating prose
 * as an unmatrixed CTA would bury the real findings.
 */
export function unmatrixedCtaGaps(controls, ledgers, canonicalVerbs) {
  const known = new Set();
  for (const ledger of Object.values(ledgers)) {
    for (const cta of ledger.ctas) {
      if (cta.verb && cta.object)
        known.add(`${String(cta.verb).toLowerCase()} ${String(cta.object).toLowerCase().split(/\s+/).pop()}`);
    }
  }
  const allTerms = new Set(
    Object.values(ledgers).flatMap((l) => l.terms.map((t) => t.split(/\s+/).pop())),
  );

  // Candidate actions, then the instance filter.
  const candidates = [];
  for (const c of controls) {
    const label = String(c.label ?? "");
    const words = label.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    if (words.length < 2 || words.length > 3) continue;
    const [verb] = words;
    if (!canonicalVerbs.has(verb)) continue;
    candidates.push({
      screen: c.screen,
      verb,
      head: words[words.length - 1],
      label,
      tail: label.split(/\s+/).slice(1).join(" "),
    });
  }

  /**
   * "Edit PRINCESS", "Edit HAL", "Edit ADORA" is ONE action over a list, not
   * seven undocumented nouns. The tail there is a data value, and the signal
   * that says so is repetition: the same verb on the same screen with many
   * different tails. The pilot produced thirteen such rows out of fourteen —
   * precisely the noise that gets a gap report ignored.
   */
  const tailsByVerbScreen = new Map();
  for (const c of candidates) {
    const key = `${c.screen}::${c.verb}`;
    (tailsByVerbScreen.get(key) ?? tailsByVerbScreen.set(key, new Set()).get(key)).add(c.head);
  }
  const varies = (c) => (tailsByVerbScreen.get(`${c.screen}::${c.verb}`)?.size ?? 0) >= 3;
  // A dotted or SHOUTING tail is an identifier even when it appears once.
  const looksLikeInstance = (c) =>
    varies(c) || /\./.test(c.tail) || /^[A-Z0-9][A-Z0-9 ._-]+$/.test(c.tail);

  const seen = new Map();
  for (const c of candidates) {
    if (looksLikeInstance(c)) {
      // Still worth one row: a repeated verb over a list is a shipped action.
      const key = `${c.screen}::${c.verb}::instances`;
      if (seen.has(key)) continue;
      if ([...known].some((k) => k.startsWith(`${c.verb} `))) continue;
      seen.set(key, {
        kind: "unmatrixed-cta",
        action: `${c.verb} (per row)`,
        evidence: `control "${c.label}" on ${c.screen} — one of ${tailsByVerbScreen.get(`${c.screen}::${c.verb}`)?.size ?? 1} instances`,
        suggests: "design-flow — a shipped row action with no CTA row; the object is the list's object",
      });
      continue;
    }
    if (known.has(`${c.verb} ${c.head}`)) continue;
    const key = `${c.verb} ${c.head}`;
    if (seen.has(key)) continue;
    seen.set(key, {
      kind: allTerms.has(c.head) ? "unmatrixed-cta" : "unledgered-noun",
      action: key,
      evidence: `control "${c.label}" on ${c.screen}`,
      suggests: allTerms.has(c.head)
        ? "design-flow — a shipped action with no CTA row"
        : "design-model — the object this acts on is not in any ledger",
    });
  }
  return [...seen.values()];
}

/**
 * Screen coverage, computed ONLY where screens declare their routes.
 *
 * `route:` blocks already exist in the screen contract and the check-routes
 * gate already reads them, so this is a diff against a real declaration
 * rather than a guessed correspondence. Where no screen declares a route the
 * stage reports that it could not compute, which is a smaller and truer
 * statement than a page of invented mismatches.
 */
export function screenGaps(parsers, repoRoot, capturedRoutes) {
  const dir = join(repoRoot, "design", "screens");
  const gaps = [];
  const declared = [];
  if (!existsSync(dir)) return { gaps, declared, computable: false };

  for (const file of readdirSync(dir).filter((f) => f.endsWith(".yaml"))) {
    const src = readFileSync(join(dir, file), "utf8");
    const meta = parsers.parseScreen(src) ?? {};
    for (const r of parsers.parseScreenRoutes(src) ?? []) {
      if (r?.path) declared.push({ path: r.path, screen: meta.screen, context: meta.context, file });
    }
  }
  if (declared.length === 0) return { gaps, declared, computable: false };

  const norm = (p) => String(p).replace(/\[[^\]]+\]|:[\w]+|\{[^}]+\}/g, "*").replace(/\/$/, "");
  const declaredSet = new Set(declared.map((d) => norm(d.path)));
  const capturedSet = new Set(capturedRoutes.map((r) => norm(r.path)));

  for (const path of capturedSet) {
    if (declaredSet.has(path)) continue;
    gaps.push({
      kind: "uncontracted-screen",
      route: path,
      evidence: "captured in the running app; no screen artifact declares this route",
      suggests: "design-flow — the screen ships without a contract",
    });
  }
  for (const d of declared) {
    if (capturedSet.has(norm(d.path))) continue;
    gaps.push({
      kind: "contracted-screen-absent",
      route: d.path,
      screen: `${d.context}.${d.screen}`,
      evidence: `declared by ${d.file}; never reached during the sweep`,
      suggests: "confirm it is unbuilt, or add a state recipe so the audit can reach it",
    });
  }
  return { gaps, declared, computable: true };
}

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * One row per finding, not one per state.
 *
 * A screen captured in four states is one screen; reporting its row action
 * four times pads the report with repetition a reader has to re-read before
 * realising it says nothing new.
 */
export function dedupeGaps(gaps) {
  const seen = new Map();
  for (const g of gaps) {
    const key = [g.kind, g.cta ?? "", g.action ?? "", g.route ?? "", g.term ?? ""].join("|");
    if (!seen.has(key)) seen.set(key, g);
  }
  return [...seen.values()];
}

/**
 * Contexts that ship screens but have no object map to diff against.
 *
 * FR-DA-060 is a DIFF, and a diff against nothing is empty — so a legacy
 * context produced a silent blank where the most useful finding belongs. The
 * offer is an OBSERVATION with a suggested action, never coverage: D-2 keeps
 * `coverage.yaml` a record of human decisions, and an audit that wrote it
 * would make "measured" and "ratified" indistinguishable.
 */
export function baselineOffers(repoRoot, capturedRoutes, objects) {
  if (!objects?.length) return [];
  const mapped = existsSync(join(repoRoot, "design", "objects"))
    ? readdirSync(join(repoRoot, "design", "objects")).filter((f) => f.endsWith(".yaml"))
    : [];
  if (mapped.length > 0) return [];
  return [
    {
      kind: "baseline-available",
      evidence: `${objects.length} candidate object(s) derived from ${capturedRoutes.length} captured route(s); no design/objects/*.yaml to diff against`,
      suggests:
        "run /waypoint.design-model {context} — observed-objects.yaml is proposal input, not a map",
    },
  ];
}

/**
 * Derived candidates that no object map names (FR-DA-046).
 *
 * ONE DIRECTION ONLY, and the asymmetry is the whole design. Saying "this
 * repeated structure ships and the map does not name it" is sound: the
 * evidence is on screen. The inverse — "the map declares X and we never saw
 * it" — is not, because derive-objects finds COLLECTIONS. An object that only
 * ever renders as a single detail view has no repeat group and can never be
 * derived, so that direction would fire on every detail-only noun. On
 * CruisePaperwork that is 27 declared objects against 4 derived candidates:
 * a wall of findings that are all the tool's blind spot rather than the
 * project's gap. False positives are this stage's death; the inverse is
 * recorded under notComputed instead.
 *
 * A near-match is a HINT, not a verdict. "Voyage worklist" plausibly renders
 * the declared `voyage`; the matcher says so and leaves the judgement alone.
 */
export function undeclaredObjectGaps(parsers, repoRoot, derived) {
  const dir = join(repoRoot, "design", "objects");
  if (!existsSync(dir)) return [];
  const declared = new Set();
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".yaml"))) {
    const map = parsers.parseObjectMap(readFileSync(join(dir, f), "utf8"));
    for (const name of Object.keys(map?.objects ?? {})) declared.add(norm(name));
  }
  if (declared.size === 0) return [];

  return (derived ?? [])
    .filter((o) => o.named)
    .filter((o) => !plausibleMatch(norm(o.name), declared))
    .map((o) => ({
      kind: "object-not-declared",
      route: o.route,
      evidence: `"${o.name}" — ${o.members} repeated member(s), fields: ${o.cardFields}`,
      suggests:
        "design-model — a repeated structure ships that no object map names; adjudicate it or record why it is not an object",
    }));
}

/** Lowercase, de-plural, drop qualifiers. Scoring only, never asserted. */
function norm(name) {
  return String(name)
    .toLowerCase()
    .replace(/^(active|all|current|built-in|custom)\s+/, "")
    .replace(/\s+(list|table|grid|worklist|queue)$/, "")
    .replace(/s$/, "")
    .trim();
}

/** Either name containing the other is close enough to leave alone. */
function plausibleMatch(candidate, declared) {
  for (const d of declared) {
    if (candidate === d) return true;
    if (candidate.includes(d) || d.includes(candidate)) return true;
  }
  return false;
}

export async function run(ctx) {
  const parsers = await loadRepoParsers(ctx.repoRoot);
  if (!parsers) {
    return {
      artifacts: [],
      findings: [
        {
          kind: "no-parsers",
          evidence: "design/tools/parsers.mjs not found in the audited repo",
          suggests:
            "run a design action to seed the tools; the audit will not substitute its own parser (rule:design.audit-same-parser)",
        },
      ],
      skipped: "no design/tools/parsers.mjs — gaps need the repo's own parser",
    };
  }

  const controls = ctx.controls ?? readRows(ctx, "controls.yaml", "controls");
  const routeRows = ctx.routeRows ?? readRows(ctx, "routes.yaml", "routes");
  const routeFindings = readRows(ctx, "routes.yaml", "findings");
  const ledgers = ledgerIndex(parsers, ctx.repoRoot);
  const scoped = ctx.context
    ? Object.fromEntries(Object.entries(ledgers).filter(([c]) => c === ctx.context))
    : ledgers;

  const canonicalVerbs = canonicalVerbSet(ctx.repoRoot);
  const captured = routeRows.filter((r) => r.status === "captured");

  const gaps = dedupeGaps([
    ...bannedSynonymGaps(controls, scoped),
    ...ctaGaps(controls, scoped),
    ...unmatrixedCtaGaps(controls, scoped, canonicalVerbs),
    ...routeFindings.map((f) => ({
      kind: `route-drift/${f.kind}`,
      route: f.route,
      evidence: f.evidence,
      suggests: f.suggests,
    })),
  ]);

  const screens = screenGaps(parsers, ctx.repoRoot, captured);
  gaps.push(...screens.gaps);
  gaps.push(...baselineOffers(ctx.repoRoot, captured, ctx.objects));
  gaps.push(...undeclaredObjectGaps(parsers, ctx.repoRoot, ctx.objects));

  // What the audit deliberately did NOT compute, and why. An honest blank is
  // worth more than a confident invention.
  const notComputed = [];
  if (ctx.objects?.length) {
    notComputed.push({
      what: "declared objects never observed",
      why: "derive-objects finds repeated structures, so an object that only renders as a single detail view cannot be observed at all; absence here is the tool's blind spot, not the project's gap",
      suggests: "compare design/objects/*.yaml against observed-objects.yaml by eye, or capture the detail routes that render each one",
    });
  }
  if (!screens.computable) {
    notComputed.push({
      what: "screen coverage",
      why: "no screen artifact declares a `route:`; the screen-to-route correspondence would have to be guessed",
      suggests: "add route: blocks to design/screens/*.yaml (check-routes already reads them)",
    });
  }
  notComputed.push({
    what: "representation mismatch",
    why: "an object-map representation (link vs embedded-list vs count) cannot be read reliably from layout alone",
    suggests: "review the skeletons beside the object map at the next design-model run",
  });
  if (controls.length === 0) {
    notComputed.push({
      what: "CTA and vocabulary coverage",
      why: "no controls were captured — the app was not reached at T1/T2",
      suggests: "fill in env-contract.yaml and re-run",
    });
  }

  const prov = ctx.provenanceFor("audit/validate");
  const artifacts = [
    writeSurvey(
      ctx.repoRoot,
      "gaps.yaml",
      [
        provenanceHeader(prov, [
          "OBSERVATIONS about the design record, computed with the audited",
          "repo's own parsers (rule:design.audit-same-parser). This file never",
          "changes coverage.yaml: ratification is a human act, and a machine",
          "that wrote it would be stamping decisions nobody made (D-2).",
          `gaps: ${gaps.length} · contexts: ${Object.keys(scoped).length} · controls: ${controls.length}`,
        ]),
        "version: 1",
        yamlList("gaps", gaps, { style: "block" }),
        yamlList("notComputed", notComputed, { style: "block" }),
        "",
      ].join("\n"),
    ),
    writeSurvey(ctx.repoRoot, "audit-report.md", renderReport(gaps, notComputed, ctx, prov)),
  ];

  return { artifacts, findings: gaps, exports: { gaps } };
}

/** The canonical verb set, read from the repo's own doctrine when present. */
export function canonicalVerbSet(repoRoot) {
  const shared = join(repoRoot, "design", "glossary", "_shared.yaml");
  const verbs = new Set();
  if (existsSync(shared)) {
    const src = readFileSync(shared, "utf8");
    const block = /^verbs:\s*\n((?:\s+.*\n?)*)/m.exec(src)?.[1] ?? "";
    for (const m of block.matchAll(/^\s{2}([\w-]+):/gm)) verbs.add(m[1].toLowerCase());
  }
  if (verbs.size === 0) {
    for (const v of [
      "create", "add", "edit", "save", "cancel", "delete", "remove", "view",
      "duplicate", "archive", "restore", "search", "filter", "sort", "reorder",
      "export", "import", "publish", "download", "invite", "assign", "unassign",
      "enroll", "start", "approve", "reject", "enable", "disable", "close", "process",
    ])
      verbs.add(v);
  }
  return verbs;
}

function renderReport(gaps, notComputed, ctx, prov) {
  const byKind = gaps.reduce((acc, g) => {
    acc[g.kind] = (acc[g.kind] ?? 0) + 1;
    return acc;
  }, {});
  const lines = [
    "# Design audit — gap report",
    "",
    `Observed at tier **${prov.tier}** on commit \`${prov.commit.slice(0, 8)}\`.`,
    "These are observations. Nothing here ratifies, approves, or edits the",
    "design record; each row names the action that would close it.",
    "",
    "## What was found",
    "",
  ];
  if (gaps.length === 0) {
    lines.push("No gaps. Every observed control and route traces to the design record.", "");
  } else {
    for (const [kind, n] of Object.entries(byKind).sort((a, b) => b[1] - a[1]))
      lines.push(`- **${kind}** — ${n}`);
    lines.push("");
    for (const g of gaps.slice(0, 40)) {
      lines.push(
        `- \`${g.kind}\` ${g.cta ?? g.action ?? g.route ?? g.term ?? ""} — ${g.evidence}`,
        `  - next: ${g.suggests}`,
      );
    }
    if (gaps.length > 40) lines.push(`- …and ${gaps.length - 40} more in gaps.yaml`);
    lines.push("");
  }
  lines.push("## What was not computed, and why", "");
  for (const n of notComputed) lines.push(`- **${n.what}** — ${n.why}`, `  - ${n.suggests}`);
  lines.push("");
  return lines.join("\n");
}

function readRows(ctx, file, key) {
  const src = readSurvey(ctx.repoRoot, file);
  return src ? parseYamlRows(src, key) : [];
}
