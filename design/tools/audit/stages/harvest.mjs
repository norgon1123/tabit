/**
 * Harvest — the T3 layer: what the source DECLARES, with no browser and no
 * running application.
 *
 * This is the floor of the fidelity ladder and the only rung available for an
 * app that cannot be booted (a desktop client, a legacy stack, a repo you were
 * handed an hour ago). It answers a different question from capture: not
 * "what does a reader see" but "what vocabulary does this codebase contain" —
 * including values that are declared and never painted, which is precisely
 * what a stylesheet reader can see and a screenshot cannot.
 *
 * Every row it produces is marked T3 and carries counts but NO painted area.
 * Cross-tier comparison is banned in the drift gate for the same reason it is
 * banned here: a count and an area are not the same measurement, and letting
 * them mix would launder a declaration into evidence.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

import { provenanceHeader } from "../provenance.mjs";
import { writeSurvey, yamlList } from "../survey-io.mjs";

const SOURCE_EXT = new Set([".tsx", ".jsx", ".ts", ".js", ".vue", ".svelte", ".html", ".razor", ".cshtml"]);
const STYLE_EXT = new Set([".css", ".scss", ".less"]);
const SKIP_DIR = new Set([
  "node_modules", ".git", "dist", "build", ".next", "out", "coverage",
  "bin", "obj", ".venv", "vendor", "design",
]);

/** Walk source files, bounded so a monorepo cannot turn this into a crawl. */
export function* sourceFiles(root, { limit = 4000 } = {}) {
  let seen = 0;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") && e.name !== ".storybook") continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIR.has(e.name)) stack.push(full);
        continue;
      }
      const ext = extname(e.name);
      if (!SOURCE_EXT.has(ext) && !STYLE_EXT.has(ext)) continue;
      if (++seen > limit) return;
      yield { path: full, ext };
    }
  }
}

/**
 * Utility classes as written, plus arbitrary-value violations.
 *
 * Arbitrary values (`bg-[#0a0a0a]`, `p-[13px]`) are the escape hatch that
 * makes a token system decorative: they type-check, they render, and they are
 * invisible to every gate that only reads the token file. Listing them with
 * file:line is the whole point — a violation without a location is a mood.
 */
export function harvestClasses(src, file) {
  const counts = new Map();
  const violations = [];
  const lines = src.split("\n");
  const attr = /(?:className|class)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*`([^`]*)`)/g;
  const apply = /@apply\s+([^;]+);/g;

  lines.forEach((line, i) => {
    for (const re of [attr, apply]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line))) {
        const blob = m[1] ?? m[2] ?? m[3] ?? m[0].replace(/^@apply\s+/, "");
        for (const raw of blob.split(/\s+/)) {
          const cls = raw.trim();
          if (!cls || cls.includes("${") || cls.length > 60) continue;
          counts.set(cls, (counts.get(cls) ?? 0) + 1);
          if (/\[[^\]]+\]/.test(cls)) {
            violations.push({
              class: cls,
              file,
              line: i + 1,
              why: "arbitrary value — outside the token scale",
            });
          }
        }
      }
    }
  });
  return { counts, violations };
}

/**
 * Custom properties, declared. Both halves matter: `--ink: #2C2925` is the
 * token, `color: var(--ink)` is the adoption, and a system where the first
 * exists without the second is a token file nobody uses.
 */
export function harvestCustomProperties(src, file) {
  const declared = [];
  const used = new Map();
  src.split("\n").forEach((line, i) => {
    const decl = line.match(/^\s*(--[\w-]+)\s*:\s*([^;]+);/);
    if (decl) {
      declared.push({
        property: decl[1],
        value: decl[2].trim(),
        file,
        line: i + 1,
      });
    }
    for (const m of line.matchAll(/var\((--[\w-]+)/g)) {
      used.set(m[1], (used.get(m[1]) ?? 0) + 1);
    }
  });
  return { declared, used };
}

/** Raw colour literals in stylesheets — the values a token system should own. */
export function harvestRawColors(src, file) {
  const out = [];
  src.split("\n").forEach((line, i) => {
    // A token DEFINITION is the token, not a raw literal — strip declarations
    // before scanning so `:root { --ink: #2C2925; }` on one line behaves the
    // same as the multi-line form.
    const scanned = line.replace(/--[\w-]+\s*:\s*[^;}]+/g, "");
    for (const m of scanned.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]+\)/g)) {
      out.push({ value: m[0], file, line: i + 1 });
    }
  });
  return out;
}

export async function run(ctx) {
  const prov = ctx.provenanceFor("audit/harvest", { tier: "T3", viewport: null });
  const classCounts = new Map();
  const violations = [];
  const declaredProps = [];
  const usedProps = new Map();
  const rawColors = [];
  let files = 0;

  for (const { path, ext } of sourceFiles(ctx.repoRoot)) {
    let src;
    try {
      if (statSync(path).size > 600_000) continue;
      src = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    files++;
    const rel = relative(ctx.repoRoot, path);
    if (SOURCE_EXT.has(ext) || STYLE_EXT.has(ext)) {
      const { counts, violations: v } = harvestClasses(src, rel);
      for (const [cls, n] of counts)
        classCounts.set(cls, (classCounts.get(cls) ?? 0) + n);
      violations.push(...v);
    }
    if (STYLE_EXT.has(ext)) {
      const { declared, used } = harvestCustomProperties(src, rel);
      declaredProps.push(...declared);
      for (const [p, n] of used) usedProps.set(p, (usedProps.get(p) ?? 0) + n);
      rawColors.push(...harvestRawColors(src, rel));
    }
  }

  const topClasses = [...classCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 200)
    .map(([cls, count]) => ({ class: cls, count }));

  const unusedTokens = declaredProps
    .filter((d) => !usedProps.has(d.property))
    .map((d) => ({ property: d.property, file: d.file, line: d.line }));

  const artifacts = [
    writeSurvey(
      ctx.repoRoot,
      "source-census.yaml",
      [
        provenanceHeader(prov, [
          "T3: DECLARED vocabulary. Counts only — nothing here was painted,",
          "so these rows are never comparable with a T1 census's areas.",
          `files scanned: ${files}`,
        ]),
        "version: 1",
        yamlList("classes", topClasses),
        yamlList("arbitraryValues", violations.slice(0, 200), { style: "block" }),
        yamlList("customProperties", declaredProps.slice(0, 300), { style: "block" }),
        yamlList("declaredButUnused", unusedTokens.slice(0, 100)),
        yamlList("rawColorsInStylesheets", dedupeColors(rawColors).slice(0, 100), {
          style: "block",
        }),
        "",
      ].join("\n"),
    ),
  ];

  const findings = violations.length
    ? [
        {
          kind: "arbitrary-values",
          evidence: `${violations.length} arbitrary utility value(s), e.g. ${violations[0].class} at ${violations[0].file}:${violations[0].line}`,
          suggests: "design-tokens — introduce or reuse a token; the scale is the only legal source",
        },
      ]
    : [];

  return {
    artifacts,
    findings,
    exports: {
      sourceCensus: { topClasses, violations, declaredProps, rawColors, files },
    },
  };
}

function dedupeColors(rows) {
  const seen = new Map();
  for (const r of rows) {
    const prev = seen.get(r.value);
    if (prev) prev.count++;
    else seen.set(r.value, { ...r, count: 1 });
  }
  return [...seen.values()].sort((a, b) => b.count - a.count);
}
