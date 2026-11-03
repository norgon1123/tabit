/**
 * check-routes — does the router agree with the design?
 *
 * Walks the Next.js App Router, normalises what it finds into route patterns,
 * and diffs them against the `route:` blocks on screen contracts
 * (QOC-design-011). Four findings, each naming a different kind of drift:
 *
 *   route-unmodeled   the router serves it; no screen describes it
 *   route-phantom     a screen claims it; the router does not serve it
 *   route-param-name  same shape, different parameter name — a rename that
 *                     landed in one place only. Reported separately because
 *                     "phantom + unmodeled" for one renamed segment reads as
 *                     two unrelated problems
 *   route-collision   two screens claim one path and neither is a `mode_of`
 *                     the other — filtered views are modes, not rivals
 *
 * RING-FENCED. `design/route-baseline.yaml` records the routes that were
 * already unmodeled when this check was introduced. Those are reported as
 * debt, never as failures; anything new fails. A hard gate over 46 unmodeled
 * routes on day one is a gate that gets switched off in a week.
 *
 * Usage:
 *   node design/tools/check-routes.mjs                 report
 *   node design/tools/check-routes.mjs --update-baseline
 */

import { existsSync, readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseScreen, parseScreenRoutes } from "./parsers.mjs";

const DESIGN_DIR = process.env.GATE_DESIGN_DIR ?? "design";
const APP_DIR = process.env.GATE_APP_DIR ?? "src/app";
const BASELINE = join(DESIGN_DIR, "route-baseline.yaml");

/**
 * Every `page.tsx` under the app directory, as a URL pattern.
 *
 * Route groups — `(workspaces)`, `(auth)` — organise files without appearing
 * in the URL, so they are stripped. Parallel (`@slot`) and intercepting
 * (`(.)`) segments are skipped entirely: they render into another route
 * rather than owning one, so they are not destinations a screen could model.
 */
export function routesFromApp(appDir) {
  const found = [];
  const walk = (dir, segs) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry.startsWith("@") || /^\(\.+\)/.test(entry)) continue;
        const hidden = /^\(.+\)$/.test(entry);
        walk(full, hidden ? segs : segs.concat(entry));
      } else if (/^page\.(tsx|ts|jsx|js)$/.test(entry)) {
        found.push("/" + segs.join("/"));
      }
    }
  };
  walk(appDir, []);
  return [...new Set(found.map((r) => (r === "/" ? "/" : r.replace(/\/+$/, "") || "/")))].sort();
}

/** Parameter names replaced by position, so a rename is detectable as such. */
export const shapeOf = (route) =>
  route.replace(/\[\[?\.{0,3}[^\]]+\]\]?/g, (seg) => (seg.startsWith("[[") ? "[[*]]" : seg.startsWith("[...") ? "[*]" : "[]"));

/** Every route a screen contract claims, with the screen that claims it. */
export function modeledRoutes(designDir) {
  const dir = join(designDir, "screens");
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".yaml") && !x.startsWith("_")).sort()) {
    const src = readFileSync(join(dir, f), "utf8");
    const meta = parseScreen(src);
    const id = `${meta.context}.${meta.screen}`;
    for (const r of parseScreenRoutes(src)) {
      if (r.path) out.push({ ...r, screen: id, file: f });
    }
  }
  return out;
}

function loadBaseline() {
  if (!existsSync(BASELINE)) return new Set();
  const src = readFileSync(BASELINE, "utf8");
  const block = src.match(/^unmodeled:\s*\n((?:\s*-\s.*\n?)*)/m);
  if (!block) return new Set();
  return new Set(block[1].split("\n").map((l) => l.replace(/^\s*-\s*/, "").trim()).filter(Boolean));
}

export function checkRoutes(designDir = DESIGN_DIR, appDir = APP_DIR) {
  const code = routesFromApp(appDir);
  const modeled = modeledRoutes(designDir);
  const baseline = loadBaseline();
  const findings = [];

  const codeSet = new Set(code);
  const codeShapes = new Map(code.map((r) => [shapeOf(r), r]));

  // one path claimed twice, with no mode_of relationship
  const byPath = new Map();
  for (const m of modeled) {
    if (!byPath.has(m.path)) byPath.set(m.path, []);
    byPath.get(m.path).push(m);
  }
  for (const [path, claims] of byPath) {
    const principals = claims.filter((c) => !c.modeOf);
    if (principals.length > 1) {
      findings.push({
        check: "route-collision",
        severity: "fail",
        detail: `${path} claimed by ${principals.map((c) => c.screen).join(" and ")} — neither declares mode_of`,
      });
    }
  }

  for (const m of modeled) {
    if (codeSet.has(m.path)) continue;
    const twin = codeShapes.get(shapeOf(m.path));
    findings.push(
      twin
        ? {
            check: "route-param-name",
            severity: "fail",
            detail: `${m.file}: design says ${m.path}, router says ${twin}`,
          }
        : {
            check: "route-phantom",
            severity: "fail",
            detail: `${m.file}: ${m.path} is not served by the router`,
          },
    );
  }

  const modeledPaths = new Set(modeled.map((m) => m.path));
  const unmodeled = code.filter((r) => !modeledPaths.has(r));
  for (const r of unmodeled) {
    if (baseline.has(r)) continue;
    findings.push({
      check: "route-unmodeled",
      severity: "fail",
      detail: `${r} is served by the router but no screen contract describes it`,
    });
  }

  return {
    findings,
    stats: {
      routes: code.length,
      modeled: code.length - unmodeled.length,
      unmodeled: unmodeled.length,
      ringFenced: unmodeled.filter((r) => baseline.has(r)).length,
      screens: modeled.length,
    },
    unmodeled,
  };
}

// ---- CLI ----
const isMain = process.argv[1] && process.argv[1].endsWith("check-routes.mjs");
if (isMain) {
  const { findings, stats, unmodeled } = checkRoutes();

  if (process.argv.includes("--update-baseline")) {
    const today = new Date().toISOString().slice(0, 10);
    const body = [
      "# design/route-baseline.yaml — routes unmodeled when check-routes was introduced.",
      "# MACHINE-WRITTEN. Ring-fenced debt: these are reported, never failed. A route",
      "# leaves this list by gaining a screen contract; nothing is ever added by hand,",
      "# and the count is expected to fall monotonically.",
      "version: 1",
      `generated: ${today}`,
      `count: ${unmodeled.length}`,
      "unmodeled:",
      ...unmodeled.map((r) => `  - ${r}`),
      "",
    ].join("\n");
    writeFileSync(BASELINE, body);
    console.log(`baseline written — ${unmodeled.length} routes ring-fenced`);
    process.exit(0);
  }

  const pct = stats.routes ? Math.round((stats.modeled / stats.routes) * 100) : 0;
  console.log(`routes ${stats.modeled}/${stats.routes} modeled (${pct}%) · ${stats.ringFenced} ring-fenced · ${stats.screens} screen routes`);
  for (const f of findings) console.log(`  ${f.severity.toUpperCase()} ${f.check}: ${f.detail}`);
  if (!findings.length) console.log("  no new drift");
  process.exit(findings.some((f) => f.severity === "fail") ? 1 : 0);
}
