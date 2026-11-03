#!/usr/bin/env node
/**
 * vale-from-ledger — generate Vale style rules from seam ledgers.
 * (design-feature task-005; DF-FR-040.3, DF-NFR-002)
 *
 * Reads every design/glossary/*.yaml, emits .vale/WayPoint/*.yml rules:
 *   - banned_synonyms of ratified terms  -> substitution rules, level: error
 *   - banned_synonyms of provisional terms -> substitution rules, level: warning
 *   - domain-only terms and hidden aliases -> existence rules, level: error
 *   - banned constructions (fixed list from doctrine) -> existence, level: error
 *
 * Deterministic: sorted keys, no timestamps — same ledgers, byte-identical
 * output (asserted by test). Zero dependencies: parses the ledger's YAML
 * SUBSET (2-space indentation, scalar values, flat lists, one nesting level
 * under `terms:`) — not a general YAML parser.
 *
 * Usage: node design/tools/vale-from-ledger.mjs [--ledgers <dir>] [--out <dir>]
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseLedgerSubset } from "./parsers.mjs";

// Re-exported: the ledger parser used to live here, and this keeps that
// import path working for anything that still reaches for it.
export { parseLedgerSubset };

const args = process.argv.slice(2);
const argOf = (flag, dflt) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const LEDGER_DIR = argOf("--ledgers", "design/glossary");
const OUT_DIR = argOf("--out", ".vale/WayPoint");

/** Doctrine's banned constructions — fixed list, mirrors LANGUAGE_DIGEST. */
const BANNED_CONSTRUCTIONS = [
  "please",
  "click here",
  "are you sure",
];

const sortObject = (o) =>
  Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

export function buildRules(ledgers, options = {}) {
  const {
    // Which zone marks vocabulary that must not appear at all. Product
    // ledgers say `domain-only`; the framework's own ledger says
    // `internal-only`.
    hiddenZone = "domain-only",
    // Term names owned by OTHER ledgers. A word that is somebody's ratified
    // noun must never be auto-rewritten into a different word, however
    // reasonable that ban looked in the ledger that declared it.
    protectedTerms = new Set(),
    warn = (m) => console.warn(m),
    // Doctrine has to be able to NAME the constructions it bans. These belong
    // to the UI-copy rule set; adding them to the register set made the
    // sentence "Banned constructions: please, click here" fail its own lint.
    includeBannedConstructions = true,
  } = options;
  const subsError = {};
  const subsWarning = {};
  const existence = new Set();

  for (const { terms } of ledgers) {
    for (const [name, def] of Object.entries(terms)) {
      const level = def.status === "provisional" ? subsWarning : subsError;
      const guard = (syn) => {
        // Cross-ledger ambiguity guard: one synonym may map to exactly one
        // canonical term across ALL ledgers. Silent last-wins is the same
        // bug class the starter tests caught within a single file.
        const prior = subsError[syn] ?? subsWarning[syn];
        if (prior && prior !== name) {
          throw new Error(
            `Ambiguous banned synonym '${syn}': maps to '${prior}' and '${name}' across ledgers. One synonym, one canonical term.`,
          );
        }
      };
      for (const syn of def.banned_synonyms ?? []) {
        if (protectedTerms.has(syn.toLowerCase())) {
          // FAIL SAFE: drop the ban rather than rewrite another context's
          // word. Silent global rewriting is how `section` — a studio noun,
          // and the name of half the Atlas — came to be rewritten to
          // `module` because academy banned it.
          warn(
            `vale-from-ledger: '${syn}' is banned (-> ${name}) but is a ledger term elsewhere; ban dropped. Scope it, rename it, or adjudicate the clash.`,
          );
          continue;
        }
        guard(syn);
        level[syn] = name;
      }
      // Brownfield migration synonyms (C8): vocabulary adjudicated away that
      // still SHIPS in the UI stays at warning level, bound to a migration
      // debt entry — never an instant build-breaker. It hard-fails only when
      // the debt entry resolves and the term moves to banned_synonyms.
      for (const syn of def.banned_synonyms_migration ?? []) {
        if (protectedTerms.has(syn.toLowerCase())) {
          warn(
            `vale-from-ledger: migration synonym '${syn}' (-> ${name}) is a ledger term elsewhere; ban dropped.`,
          );
          continue;
        }
        guard(syn);
        subsWarning[syn] = name;
      }
      // `banned_synonyms_local` is a ban this context means but that cannot be
      // expressed as a global rule — typically because the word is another
      // context's ratified noun, or doctrine vocabulary. It is enforced at
      // design time (design_resolve warns, with the context named) and at
      // review, never by a substitution that would rewrite someone else's
      // word. Silently skipped: a warning you expect on every run is noise.
      if (def.zone === hiddenZone) existence.add(name);
      for (const alias of def.domain_aliases_hidden ?? []) existence.add(alias);
    }
  }

  const files = {};
  if (Object.keys(subsError).length > 0) {
    files["LedgerTerms.yml"] = valeSubstitution(
      "error",
      "Use the ledger term '%s' instead of '%s'.",
      sortObject(subsError),
    );
  }
  if (Object.keys(subsWarning).length > 0) {
    files["ProvisionalTerms.yml"] = valeSubstitution(
      "warning",
      "Provisional ledger term: '%s' is the candidate replacement for '%s'.",
      sortObject(subsWarning),
    );
  }
  const existenceTokens = [
    ...[...existence].sort((a, b) => a.localeCompare(b)),
    ...(includeBannedConstructions ? BANNED_CONSTRUCTIONS : []),
  ];
  files["DomainOnly.yml"] = valeExistence(
    "error",
    "Internal or banned vocabulary must not appear in UI strings.",
    existenceTokens,
  );
  return files;
}

function valeSubstitution(level, message, swap) {
  const lines = [
    "extends: substitution",
    `message: "${message}"`,
    `level: ${level}`,
    "ignorecase: true",
    "swap:",
  ];
  for (const [from, to] of Object.entries(swap)) {
    lines.push(`  ${from}: ${to}`);
  }
  return `${lines.join("\n")}\n`;
}

function valeExistence(level, message, tokens) {
  const lines = [
    "extends: existence",
    `message: "${message}"`,
    `level: ${level}`,
    "ignorecase: true",
    "tokens:",
  ];
  for (const t of tokens) lines.push(`  - '${t}'`);
  return `${lines.join("\n")}\n`;
}

/** Term names across a set of ledgers, lowercased. */
function termNames(ledgers) {
  const out = new Set();
  for (const { terms } of ledgers) {
    for (const name of Object.keys(terms)) out.add(name.toLowerCase());
  }
  return out;
}

export function run(ledgerDir = LEDGER_DIR, outDir = OUT_DIR) {
  let names = [];
  try {
    names = readdirSync(ledgerDir)
      .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    console.error(`No ledger directory at ${ledgerDir}; nothing to do.`);
    return 0;
  }

  const read = (f) => parseLedgerSubset(readFileSync(join(ledgerDir, f), "utf8"));

  // `_starter` is the copy-me template shipped with the bundle. Its example
  // rows are illustrations, and letting them generate real bans made every
  // project inherit a rule nobody in that project wrote.
  const productNames = names.filter(
    (f) => f !== "_method.yaml" && f !== "_starter.yaml",
  );
  const product = productNames.map(read);
  const method = names.includes("_method.yaml") ? [read("_method.yaml")] : [];

  // The two rule sets are generated separately and never merged. A framework
  // ban must not rewrite a product's interface copy, and a product ban must
  // not rewrite doctrine.
  const files = buildRules(product, {
    hiddenZone: "domain-only",
    protectedTerms: termNames(product),
  });
  mkdirSync(outDir, { recursive: true });
  for (const [name, content] of Object.entries(files).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    writeFileSync(join(outDir, name), content);
  }

  let methodCount = 0;
  if (method.length > 0) {
    const methodOut = `${outDir}Method`;
    const methodFiles = buildRules(method, {
      hiddenZone: "internal-only",
      protectedTerms: termNames(product),
      includeBannedConstructions: false,
    });
    mkdirSync(methodOut, { recursive: true });
    for (const [name, content] of Object.entries(methodFiles).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      writeFileSync(join(methodOut, name), content);
    }
    methodCount = Object.keys(methodFiles).length;
    console.log(
      `vale-from-ledger: _method -> ${methodCount} register rule file(s) in ${methodOut}`,
    );
  }

  console.log(
    `vale-from-ledger: ${product.length} ledger(s) -> ${Object.keys(files).length} rule file(s) in ${outDir}`,
  );
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(run());
}
