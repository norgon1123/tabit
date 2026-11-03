/**
 * Inventory — what routes exist, according to BOTH sources (D-3).
 *
 * The static set is what the code declares. The crawl set is what a browser
 * can actually reach by following links from the entry point. Neither is
 * authoritative and the interesting part is where they disagree:
 *
 *   declared-unreachable  — a route in the config nothing links to. Dead code,
 *                           a deep link nobody advertises, or a broken nav.
 *   reached-undeclared    — a URL the app served that the config does not
 *                           name. Usually a redirect target or a route
 *                           registered somewhere the extractor cannot see.
 *
 * Merging the two silently would erase precisely that signal, which is why
 * the cross-check is the stage's actual product and routes.yaml carries the
 * findings alongside the rows.
 */

import { adaptersFor } from "./detect.mjs";
import { provenanceHeader } from "../provenance.mjs";
import {
  DEFAULT_STATES,
  mergeRoutes,
  parseRoutesFile,
  renderRoutesFile,
} from "../routes.mjs";
import { readSurvey, writeSurvey, yamlList } from "../survey-io.mjs";
import { installRelay, loadPlaywright } from "./capture.mjs";

/** `/queue/voyage/:id` and `/api/x/{y}` both become a matcher for real URLs. */
export function routeMatcher(declared) {
  const pattern = String(declared)
    .replace(/[.+^$()|[\]\\]/g, "\\$&")
    .replace(/:\w+/g, "[^/]+")
    .replace(/\{[^}]+\}/g, "[^/]+")
    .replace(/\*/g, ".*");
  return new RegExp(`^${pattern}/?$`);
}

export function matchesAnyDeclared(path, declaredPaths) {
  return declaredPaths.some((d) => routeMatcher(d).test(path));
}

/**
 * Cross-check. Static routes carrying params are never reported unreachable
 * on their own: the crawl cannot invent an id, so absence is the audit's
 * limitation rather than the app's defect — saying otherwise would be a false
 * positive, and false positives are how a gap report earns a reputation.
 */
export function crossCheck(staticRoutes, crawled) {
  const declaredPaths = staticRoutes.map((r) => r.path);
  const findings = [];

  for (const r of staticRoutes) {
    const reachable = crawled.some((c) => routeMatcher(r.path).test(c.path));
    if (reachable || r.kind === "index") continue;
    if (r.params?.length) {
      findings.push({
        kind: "declared-needs-fixture",
        route: r.path,
        evidence: r.evidence ?? "static route with path params",
        suggests: "add a state recipe with a real id to env-contract.yaml",
      });
      continue;
    }
    findings.push({
      kind: "declared-unreachable",
      route: r.path,
      evidence: r.evidence ?? "declared in the router config",
      suggests: "confirm it is a deep link by design, or a nav gap worth a flow slice",
    });
  }

  for (const c of crawled) {
    if (matchesAnyDeclared(c.path, declaredPaths)) continue;
    findings.push({
      kind: "reached-undeclared",
      route: c.path,
      evidence: c.from ? `linked from ${c.from}` : "reached during the crawl",
      suggests: "extend the route extractor, or record the redirect deliberately",
    });
  }

  return findings;
}

/** Breadth-first walk of in-app links, bounded and same-origin only. */
export async function crawl(page, baseURL, { maxPages = 40, skip = [] } = {}) {
  const origin = new URL(baseURL).origin;
  const seen = new Map();
  const queue = [{ path: "/", from: null }];
  const skipRe = skip.map((s) => routeMatcher(s.path ?? s));

  while (queue.length && seen.size < maxPages) {
    const { path, from } = queue.shift();
    if (seen.has(path)) continue;
    if (skipRe.some((re) => re.test(path))) continue;
    seen.set(path, { path, from });
    try {
      await page.goto(`${origin}${path}`, {
        waitUntil: "networkidle",
        timeout: 20_000,
      });
      const hrefs = await page.evaluate(() =>
        Array.from(document.querySelectorAll("a[href]"))
          .map((a) => a.getAttribute("href"))
          .filter(Boolean),
      );
      const landed = new URL(page.url()).pathname;
      if (landed !== path) seen.set(landed, { path: landed, from: path });
      for (const href of hrefs) {
        if (!href.startsWith("/") || href.startsWith("//")) continue;
        const next = href.split("#")[0].split("?")[0];
        if (!seen.has(next)) queue.push({ path: next, from: path });
      }
    } catch {
      // A route that will not load is not a crawl result; capture will record
      // it properly, with its state and its reason.
    }
  }
  return [...seen.values()];
}

export async function run(ctx) {
  const artifacts = [];
  const adapters = adaptersFor(ctx.repoRoot);

  const staticRoutes = [];
  const commandRoutes = [];
  for (const a of adapters) {
    const rows = a.routes(ctx.repoRoot) ?? [];
    // Backend adapters describe commands, not screens: they inform derive and
    // the cross-check, and they never become rows to photograph.
    if (a.kind === "backend") commandRoutes.push(...rows);
    else staticRoutes.push(...rows);
  }

  let crawled = [];
  let crawlSkipped = null;
  if (ctx.tier === "T1" && ctx.envContract.baseUrl && !ctx.dryRun) {
    const pw = await loadPlaywright(ctx.repoRoot);
    if (!pw) {
      crawlSkipped = "playwright unavailable";
    } else {
      const browser = await pw.chromium.launch();
      try {
        const page = await browser.newPage({ viewport: ctx.viewport });
        // Same relay as capture: a crawl of a data-less app finds the shell's
        // links and calls that the navigation graph.
        await installRelay(page.context(), ctx.envContract);
        crawled = await crawl(page, ctx.envContract.baseUrl, {
          skip: ctx.envContract.skip ?? [],
        });
      } catch (err) {
        crawlSkipped = err.message;
      } finally {
        await browser.close();
      }
    }
  } else {
    crawlSkipped = ctx.tier === "T1" ? "no baseUrl in env-contract" : `tier ${ctx.tier}`;
  }

  const findings = crawlSkipped ? [] : crossCheck(staticRoutes, crawled);
  const discovered = unionRoutes(staticRoutes, crawled);

  const existing = parseRoutesFile(readSurvey(ctx.repoRoot, "routes.yaml") ?? "");
  const rows = mergeRoutes(existing, discovered);
  const prov = ctx.provenanceFor("audit/inventory");
  artifacts.push(
    writeSurvey(ctx.repoRoot, "routes.yaml", renderRoutesFile(rows, prov, findings)),
  );

  artifacts.push(
    writeSurvey(
      ctx.repoRoot,
      "commands.yaml",
      [
        provenanceHeader(prov, [
          "The backend command surface. Candidate names are VERBATIM from the",
          "route; canonical-verb adjudication happens at design-flow with a",
          "human directing (ADR-DA-4).",
        ]),
        "version: 1",
        yamlList("commands", commandRoutes, { style: "block" }),
        yamlList("excluded", commandRoutes.excluded ?? [], { style: "block" }),
        "",
      ].join("\n"),
    ),
  );

  if (crawlSkipped) {
    findings.push({
      kind: "crosscheck-incomplete",
      evidence: `no crawl: ${crawlSkipped}`,
      suggests:
        "the static set is unverified — fill in env-contract and re-run to get the cross-check (D-3)",
    });
  }

  return {
    artifacts,
    findings,
    exports: { staticRoutes, commandRoutes, crawled, routeRows: rows },
  };
}

/**
 * The union, with `source` recording which side saw each path. A crawled URL
 * that matches a declared pattern is the SAME route — reporting
 * /queue/voyage/ZUI20260620 as its own row would flood the TODO with one
 * entry per fixture.
 */
export function unionRoutes(staticRoutes, crawled) {
  const out = staticRoutes.map((r) => ({
    path: r.path,
    source: crawled.some((c) => routeMatcher(r.path).test(c.path))
      ? "both"
      : "static",
    states: r.params?.length ? ["loaded"] : DEFAULT_STATES,
    note: r.params?.length ? "needs a fixture id to reach" : null,
  }));
  const declaredPaths = staticRoutes.map((r) => r.path);
  for (const c of crawled) {
    if (matchesAnyDeclared(c.path, declaredPaths)) continue;
    out.push({ path: c.path, source: "crawl", states: DEFAULT_STATES, note: null });
  }
  return out;
}
