/**
 * Drift — the census against the ratified tokens, as a RATCHET.
 *
 * Shaped after the language gate (DP-NFR-010) for a reason learned the hard
 * way: a gate that fails on the day it lands teaches people to delete it.
 * Every brownfield app has off-token values; the baseline records today's
 * count and the gate only fails when that count GROWS. Shrinking it is free
 * and expected.
 *
 * Two invariants keep it honest:
 *
 *   Vacuity guard — zero census rows or zero tokens means NOTHING WAS
 *   CHECKED, and that exits non-zero. A green gate that verified nothing is
 *   indistinguishable in a log from a green gate that verified everything,
 *   and this codebase has shipped that exact failure before (the `--help`
 *   that wiped a ratchet; the Vale config that matched only build files).
 *
 *   Tier separation — T1 rows (painted) and T3 rows (declared) are counted in
 *   separate buckets and never summed. A declaration that was never rendered
 *   is not evidence about what a user sees, and letting the two mix would
 *   launder one into the other.
 *
 * Usage: node drift.mjs [--repo <path>] [--baseline]
 *        --baseline rewrites the baseline from the current census.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { parseYamlRows, writeSurvey, yamlList } from "./survey-io.mjs";

export const BASELINE_FILE = "drift-baseline.yaml";

/** Every literal value a DTCG token tree resolves to. */
export function tokenValues(tokensJson) {
  const flat = new Map();
  const walk = (node, path = []) => {
    for (const [k, v] of Object.entries(node ?? {})) {
      if (k.startsWith("$")) continue;
      if (v && typeof v === "object") {
        if ("$value" in v) flat.set(path.concat(k).join("."), v.$value);
        else walk(v, path.concat(k));
      }
    }
  };
  walk(tokensJson);

  const resolved = new Set();
  const resolveRef = (val, depth = 0) => {
    if (typeof val !== "string" || depth > 8) return val;
    const m = /^\{(.+)\}$/.exec(val);
    if (!m) return val;
    return resolveRef(flat.get(m[1]), depth + 1);
  };
  for (const v of flat.values()) {
    const r = resolveRef(v);
    if (Array.isArray(r)) resolved.add(r.join(", ").toLowerCase());
    else if (r !== undefined && r !== null)
      resolved.add(canonicaliseColour(String(r).toLowerCase()));
  }
  return resolved;
}

/**
 * One spelling per colour, so a token and a painted value can be compared.
 *
 * Tokens are AUTHORED (`#1e293b`); a census records what the browser COMPUTED
 * (`rgb(30, 41, 59)`). They are the same colour and never the same string, so
 * a raw `tokens.has(value)` reports every tokenized colour as drift. Measured
 * on this repo's first real census: 13 of 110 colour rows were that false
 * alarm. A gate that cries wolf on correct work is worse than no gate, because
 * the baseline grows to accommodate it and the headroom hides real drift.
 *
 * Anything this cannot parse is returned untouched — an unparseable value is
 * off-token by the same rule as before, never silently excused.
 */
export function canonicaliseColour(value) {
  const v = String(value ?? "").trim().toLowerCase();

  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;

  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/.exec(v);
  if (!m) return v;

  const raw = m[4];
  const alpha =
    raw === undefined ? 1 : raw.endsWith("%") ? parseFloat(raw) / 100 : parseFloat(raw);
  // A translucent colour is NOT the token it is mixed from: it paints
  // differently over every ground. Left as-is, which keeps it off-token.
  if (alpha !== 1) return v;

  const channel = (n) => Math.round(Number(n)).toString(16).padStart(2, "0");
  return `#${channel(m[1])}${channel(m[2])}${channel(m[3])}`;
}

/**
 * Split a multi-value property into its components, leaving commas that sit
 * inside `rgb(...)` alone. `border-color` carries one value per side, and a
 * border painted with one token on all four sides is not four violations.
 */
export function colourComponents(value) {
  const out = [];
  let depth = 0;
  let current = "";
  for (const ch of String(value ?? "")) {
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    if (depth === 0 && /\s/.test(ch)) {
      if (current) out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current) out.push(current);
  return out;
}

/** Load every DTCG file under design/tokens (the renderer projection included). */
export function loadTokens(repoRoot) {
  const dir = join(repoRoot, "design", "tokens");
  const values = new Set();
  if (!existsSync(dir)) return values;
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    try {
      for (const v of tokenValues(JSON.parse(readFileSync(join(dir, f), "utf8"))))
        values.add(v);
    } catch {
      // A malformed token file is a token problem, not a drift problem; the
      // vacuity guard will catch it if it leaves us with nothing to compare.
    }
  }
  return values;
}

/** Values a colour/size property carries that no token declares. */
const COLOUR = /^(color|background-color|border-color)$/;
const TRANSPARENT = /^(rgba\(0, ?0, ?0, ?0\)|transparent)$/;

/** True when EVERY visible component of a colour value is a token. */
function onToken(value, tokens) {
  const parts = colourComponents(value).filter((p) => !TRANSPARENT.test(p));
  if (parts.length === 0) return false;
  return parts.every((p) => tokens.has(canonicaliseColour(p)));
}

export function offTokenValues(census, tokens) {
  const buckets = { T1: {}, T2: {}, T3: {} };
  const INTERESTING = /^(color|background-color|border-color|font-size|font-weight|border-radius|font-family|gap|padding-top|padding-left|margin-top|box-shadow|line-height)$/;

  for (const [property, rows] of Object.entries(census.properties ?? {})) {
    if (!INTERESTING.test(property)) continue;
    for (const row of rows) {
      const value = String(row.value ?? "").trim().toLowerCase();
      if (!value || value === "none" || value === "normal") continue;
      // Transparent and inherited values are not design decisions.
      if (/^(rgba\(0, ?0, ?0, ?0\)|transparent|auto|inherit|initial|0px|0)$/.test(value))
        continue;
      if (tokens.has(value)) continue;
      // Colour properties compare by canonical spelling, and per component:
      // `rgb(30, 41, 59)` is `#1e293b`, and a four-sided border painted with
      // one token is one satisfied value, never four violations.
      if (COLOUR.test(property) && onToken(value, tokens)) continue;
      const tier = row.tier ?? "T1";
      buckets[tier] ??= {};
      buckets[tier][property] = (buckets[tier][property] ?? 0) + 1;
    }
  }
  return buckets;
}

export function parseBaseline(src) {
  const rows = parseYamlRows(src ?? "", "counts");
  const out = {};
  for (const r of rows) {
    const tier = String(r.tier ?? "T1");
    (out[tier] ??= {})[String(r.property)] = Number(r.count ?? 0);
  }
  return out;
}

export function renderBaseline(buckets) {
  const rows = [];
  for (const [tier, props] of Object.entries(buckets)) {
    for (const [property, count] of Object.entries(props).sort())
      rows.push({ tier, property, count });
  }
  return [
    "# design/survey/drift-baseline.yaml — the ratchet's floor.",
    "#",
    "# Off-token values counted per property, per TIER. A brownfield app has",
    "# these on day one; that is expected and not a failure. The gate fails",
    "# only when a count GROWS. Shrinking it is free — regenerate with",
    "# `node design/tools/audit/drift.mjs --baseline`.",
    "#",
    "# Tiers never mix: T1 is painted, T3 is merely declared.",
    "version: 1",
    yamlList("counts", rows),
    "",
  ].join("\n");
}

/** Compare, returning what grew. Empty means the ratchet held. */
export function compare(current, baseline) {
  const grew = [];
  for (const [tier, props] of Object.entries(current)) {
    for (const [property, count] of Object.entries(props)) {
      const before = baseline?.[tier]?.[property] ?? 0;
      if (count > before) grew.push({ tier, property, was: before, now: count });
    }
  }
  return grew;
}

/**
 * The gate. Returns {code, lines} rather than exiting, so the same logic is
 * testable and the CLI stays a thin wrapper.
 */
export function evaluate({ census, tokens, baseline, rewrite = false }) {
  const lines = [];
  const censusRows = Object.values(census?.properties ?? {}).reduce(
    (n, rows) => n + rows.length,
    0,
  );

  // The vacuity guard, first: everything below is meaningless without inputs.
  if (censusRows === 0 || tokens.size === 0) {
    lines.push(
      "NOTHING WAS CHECKED",
      `  census rows: ${censusRows}`,
      `  token values: ${tokens.size}`,
      "A drift gate with no census or no tokens passes trivially and proves",
      "nothing. Run the audit's capture/harvest stages, or point it at a",
      "project that has design/tokens.",
    );
    return { code: 1, lines, buckets: null };
  }

  const buckets = offTokenValues(census, tokens);
  const total = Object.values(buckets).reduce(
    (n, props) => n + Object.values(props).reduce((m, c) => m + c, 0),
    0,
  );
  lines.push(
    `census rows: ${censusRows} · token values: ${tokens.size} · off-token: ${total}`,
  );

  if (rewrite) {
    lines.push("baseline rewritten from the current census");
    return { code: 0, lines, buckets, rewrite: true };
  }

  const grew = compare(buckets, baseline ?? {});
  if (grew.length === 0) {
    lines.push("ratchet held — no property gained off-token values");
    return { code: 0, lines, buckets };
  }
  lines.push("", "off-token values INCREASED:");
  for (const g of grew)
    lines.push(`  ${g.tier} ${g.property}: ${g.was} -> ${g.now}`);
  lines.push(
    "",
    "Introduce or reuse a token rather than raising the baseline. If the",
    "growth is deliberate, rerun with --baseline and say so in the PR.",
  );
  return { code: 1, lines, buckets };
}

export async function main(argv = process.argv.slice(2)) {
  const repoRoot = resolve(
    argv.includes("--repo") ? argv[argv.indexOf("--repo") + 1] : process.cwd(),
  );
  const rewrite = argv.includes("--baseline");

  const censusPath = join(repoRoot, "design", "survey", "style-census.json");
  const census = existsSync(censusPath)
    ? JSON.parse(readFileSync(censusPath, "utf8"))
    : { properties: {} };
  const tokens = loadTokens(repoRoot);
  const baselinePath = join(repoRoot, "design", "survey", BASELINE_FILE);
  const baseline = existsSync(baselinePath)
    ? parseBaseline(readFileSync(baselinePath, "utf8"))
    : null;

  const result = evaluate({ census, tokens, baseline, rewrite });
  for (const line of result.lines) console.log(line);
  if (result.rewrite && result.buckets)
    writeSurvey(repoRoot, BASELINE_FILE, renderBaseline(result.buckets));
  if (!baseline && !rewrite && result.code === 0)
    console.log(
      "no baseline yet — run with --baseline to record today's floor",
    );
  return result.code;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`drift failed: ${err.message}`);
      process.exit(1);
    });
}
