/**
 * Survey IO — the ONE place the audit is allowed to touch the filesystem.
 *
 * rule:design.audit-observes-only says the audit writes under design/survey/**
 * and nowhere else. That rule is worth exactly as much as its enforcement, so
 * every write in the runner goes through writeSurvey() and every path is
 * asserted here rather than reviewed by eye in six stage modules.
 *
 * Emitted YAML stays inside the parsers.mjs subset (flat maps, lists of flat
 * maps, opaque literal blocks). The audited repo's own parsers must be able
 * to read back what the audit writes — a survey file the project's tooling
 * cannot parse is a dead end dressed as an artifact.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

export const SURVEY_DIR = join("design", "survey");

/** Throws unless `target` resolves inside <repoRoot>/design/survey. */
export function assertSurveyPath(repoRoot, target) {
  const root = resolve(repoRoot, SURVEY_DIR);
  const abs = resolve(repoRoot, target);
  const rel = relative(root, abs);
  if (rel === "" || rel.startsWith("..") || rel.startsWith(`..${sep}`)) {
    throw new Error(
      `refusing to write outside design/survey: ${target}\n` +
        "The audit observes; it never edits the design record " +
        "(rule:design.audit-observes-only).",
    );
  }
  return abs;
}

/**
 * Dry-run state, module-level and set once per run by the audit context.
 *
 * This is deliberately NOT threaded through writeSurvey's arguments. Every
 * stage calls writeSurvey, and every call site would have to pass the flag
 * correctly for the guarantee to hold — which is exactly the shape of bug
 * this fixes. `--dry-run` said "plan the work, write nothing" while three
 * stages consulted the flag and the one function that actually writes did
 * not, so a dry run skipped the browser and then wrote eight artifacts
 * anyway.
 *
 * One choke point, one place to be right.
 */
let dryRun = false;

/** Called by buildContext. Returns the previous value so a test can restore it. */
export function setDryRun(value) {
  const previous = dryRun;
  dryRun = Boolean(value);
  return previous;
}

export function isDryRun() {
  return dryRun;
}

/**
 * Write a survey artifact. Returns the repo-relative path — under --dry-run
 * the path it WOULD have written, so the run's report stays accurate about
 * what a real run produces.
 */
export function writeSurvey(repoRoot, relPath, content) {
  const abs = assertSurveyPath(repoRoot, join(SURVEY_DIR, relPath));
  if (dryRun) return join(SURVEY_DIR, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content.endsWith("\n") ? content : `${content}\n`);
  return join(SURVEY_DIR, relPath);
}

export function readSurvey(repoRoot, relPath) {
  const abs = resolve(repoRoot, SURVEY_DIR, relPath);
  return existsSync(abs) ? readFileSync(abs, "utf8") : null;
}

export function surveyExists(repoRoot, relPath) {
  return existsSync(resolve(repoRoot, SURVEY_DIR, relPath));
}

// ── YAML emit (subset) ────────────────────────────────────────────────────

/**
 * Scalars. Quoting rule: quote when the value could otherwise read as
 * structure (leading/trailing space, `:` + space, `#`, list/flow markers) or
 * as another type (numbers, booleans, empty). Everything else stays bare,
 * because a file a human is meant to skim should not be a wall of quotes.
 */
export function yamlScalar(value, { flow = false } = {}) {
  if (value === null || value === undefined) return "~";
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  // Arrays and objects are STRUCTURE, not text. Without these two branches
  // String() flattens them: ["empty","error"] became the scalar
  // "empty,error", and a hole object became "[object Object]". Both were
  // written to design/survey/model/ and read back as strings, so a model
  // carrying states, geometry and typed holes arrived with none of them —
  // and looked plausible enough that only a real sweep exposed it.
  if (Array.isArray(value)) {
    return `[${value.map((v) => yamlScalar(v, { flow: true })).join(", ")}]`;
  }
  if (typeof value === "object") {
    const pairs = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}: ${yamlScalar(v, { flow: true })}`);
    return `{ ${pairs.join(", ")} }`;
  }
  const s = String(value);
  if (s === "") return '""';
  const needsQuote =
    // In FLOW context every bracket and brace is structure, anywhere in the
    // value — not only leading. A comma ends the pair, a closing brace ends
    // the map, and an OPENING BRACKET starts a sequence mid-value.
    //
    // The last one was the hole: the next-app-router adapter emits evidence
    // paths like `src/app/(workspaces)/studio/[projectSlug]`, and an
    // unquoted `[` there made the whole routes.yaml unparseable. Any adapter
    // for a filesystem-routed framework hits this, so it is fixed in the
    // writer rather than asked of each adapter.
    (flow && /[,[\]{}]/.test(s)) ||
    /^[\s]|[\s]$/.test(s) ||
    // The leading-indicator set is YAML's, not a guess: - ? : , [ ] { } # & *
    // ! | > ' " % @ ` all change meaning in first position. `?` was missing
    // and a real CSS class is named exactly that, so `{ class: ?, count: 24 }`
    // reached source-census.yaml and made it unparseable — a bare ? is the
    // explicit-key indicator.
    /:\s|\s#|^[-?:,#&*!|>%@`'"]|^\[|^\{|^\]|^\}/.test(s) ||
    /[\n]/.test(s) ||
    /^(true|false|null|~|yes|no|on|off)$/i.test(s) ||
    /^-?\d/.test(s);
  if (!needsQuote) return s;
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ")}"`;
}

/** One flat map as a `- { k: v, ... }` row — the shape parseCtas-style readers expect. */
export function yamlFlowRow(obj, indent = "  ") {
  const pairs = Object.entries(obj)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${yamlScalar(v, { flow: true })}`);
  return `${indent}- { ${pairs.join(", ")} }`;
}

/** One flat map as an indented block row — used where values are long. */
export function yamlBlockRow(obj, indent = "  ") {
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return `${indent}- {}`;
  const [firstK, firstV] = entries[0];
  const rest = entries.slice(1);
  return [
    `${indent}- ${firstK}: ${yamlScalar(firstV)}`,
    ...rest.map(([k, v]) => `${indent}  ${k}: ${yamlScalar(v)}`),
  ].join("\n");
}

/** A list of flat maps under a top-level key; `[]` when empty (never omitted). */
export function yamlList(key, rows, { style = "flow", indent = "  " } = {}) {
  if (!rows || rows.length === 0) return `${key}: []`;
  const render = style === "block" ? yamlBlockRow : yamlFlowRow;
  return [`${key}:`, ...rows.map((r) => render(r, indent))].join("\n");
}

// ── YAML read-back (subset) ───────────────────────────────────────────────

/**
 * Read a list of flat maps written by yamlList. Deliberately narrow: this
 * reads what this module writes, nothing more. Anything richer belongs in
 * parsers.mjs, which the gate and the projection already share.
 */
export function parseYamlRows(src, key) {
  const rows = [];
  let inKey = false;
  let cur = null;
  for (const raw of String(src ?? "").split("\n")) {
    const line = raw.replace(/(^|\s)#.*$/, "").trimEnd();
    if (!line.trim()) continue;
    if (/^\S/.test(line)) {
      inKey = line.startsWith(`${key}:`);
      cur = null;
      continue;
    }
    if (!inKey) continue;
    const t = line.trim();
    if (t.startsWith("- {")) {
      rows.push(parseFlowMap(t.slice(2)));
      cur = null;
    } else if (t.startsWith("- ")) {
      cur = {};
      rows.push(cur);
      const m = t.slice(2).match(/^([\w-]+):\s*(.*)$/);
      if (m) cur[m[1]] = unquote(m[2]);
    } else if (cur) {
      const m = t.match(/^([\w-]+):\s*(.*)$/);
      if (m) cur[m[1]] = unquote(m[2]);
    }
  }
  return rows;
}

function parseFlowMap(text) {
  const body = text.trim().replace(/^\{/, "").replace(/\}$/, "");
  const out = {};
  // Split on commas that are not inside quotes or brackets.
  let depth = 0;
  let quoted = false;
  let buf = "";
  const parts = [];
  for (const ch of body) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && (ch === "[" || ch === "{")) depth++;
    if (!quoted && (ch === "]" || ch === "}")) depth--;
    if (ch === "," && !quoted && depth === 0) {
      parts.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) parts.push(buf);
  for (const p of parts) {
    const m = p.trim().match(/^([\w-]+):\s*(.*)$/);
    if (m) out[m[1]] = unquote(m[2]);
  }
  return out;
}

function unquote(v) {
  const s = String(v ?? "").trim();
  if (s === "~" || s === "") return null;
  if (/^".*"$/.test(s)) return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (/^(true|false)$/.test(s)) return s === "true";
  return s;
}
