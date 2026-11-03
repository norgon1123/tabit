/**
 * port:design.app-under-audit — Next.js App Router.
 *
 * Written 2026-09-26 because the audit could not audit its own host. Two
 * adapters existed — vite-react-router and aspnet-minimal-api — and
 * waypoint-web is Next.js, so `detect` matched nothing, no static route
 * extraction ran, and the inventory fell back to an unauthenticated crawl
 * that found two paths on a forty-route application.
 *
 * Routes are a DIRECTORY WALK, not a parse. The App Router encodes its route
 * table in the filesystem, so a folder containing page.tsx is a route and its
 * path is its position under app/. That makes this adapter simpler than the
 * Vite one, which has to read a router config — the routing information is
 * already structural and needs no interpretation.
 *
 * Four conventions carry all the meaning:
 *   [slug]        -> a dynamic segment            -> :slug
 *   [...rest]     -> a catch-all                  -> *
 *   (group)       -> organisational, NOT a path   -> omitted from the URL
 *   @slot         -> a parallel route             -> not a navigable route
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Where an App Router tree can live. `src/app` first: it is the common shape. */
export function appDirs(repoRoot) {
  return [join(repoRoot, "src", "app"), join(repoRoot, "app")].filter(
    (d) => existsSync(d) && statSync(d).isDirectory(),
  );
}

const PAGE_FILES = ["page.tsx", "page.ts", "page.jsx", "page.js", "page.mdx"];

/**
 * One directory segment -> zero or one URL segment.
 *
 * Returns null for a segment that contributes nothing to the URL, which is
 * the part a naive implementation gets wrong: a (group) exists to organise
 * files and to scope a layout, and treating it as a path segment invents
 * routes the application does not serve.
 */
export function urlSegment(name) {
  if (name.startsWith("(") && name.endsWith(")")) return null;   // route group
  if (name.startsWith("@")) return undefined;                    // parallel slot
  const catchAll = name.match(/^\[\.\.\.(.+)\]$/);
  if (catchAll) return "*";
  const optionalCatchAll = name.match(/^\[\[\.\.\.(.+)\]\]$/);
  if (optionalCatchAll) return "*";
  const dynamic = name.match(/^\[(.+)\]$/);
  if (dynamic) return `:${dynamic[1]}`;
  return name;
}

/**
 * Every navigable route under one app directory.
 *
 * `undefined` from urlSegment means the whole subtree is skipped — a parallel
 * slot renders INTO another route rather than being one, so emitting its
 * pages would produce URLs nothing can navigate to.
 */
export function routesFrom(appDir, repoRoot = "") {
  const rel = (d) => (repoRoot && d.startsWith(repoRoot) ? d.slice(repoRoot.length + 1) : d);
  const out = [];
  const walk = (dir, segments) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.isFile() && PAGE_FILES.includes(e.name))) {
      const path = segments.length ? `/${segments.join("/")}` : "/";
      out.push({ path, kind: "page", evidence: rel(dir) });
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith("_") || e.name === "node_modules") continue;
      const seg = urlSegment(e.name);
      if (seg === undefined) continue;                 // parallel slot: skip subtree
      walk(join(dir, e.name), seg === null ? segments : [...segments, seg]);
    }
  };
  walk(appDir, []);
  return out;
}

/** API route handlers — the command surface, for the derive stage. */
export function apiRoutesFrom(appDir) {
  const out = [];
  const walk = (dir, segments) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const handler = entries.find((e) => e.isFile() && /^route\.(tsx?|jsx?)$/.test(e.name));
    if (handler) {
      const src = readFileSync(join(dir, handler.name), "utf8");
      // The exported HTTP verbs ARE the command surface. Read rather than
      // assumed: a route.ts exporting only GET is not a command.
      const verbs = ["GET", "POST", "PUT", "PATCH", "DELETE"].filter((v) =>
        new RegExp(`export\\s+(async\\s+)?function\\s+${v}\\b`).test(src),
      );
      out.push({
        path: segments.length ? `/${segments.join("/")}` : "/",
        kind: "api",
        verbs,
        evidence: join(dir, handler.name),
      });
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith("_") || e.name === "node_modules") continue;
      const seg = urlSegment(e.name);
      if (seg === undefined) continue;
      walk(join(dir, e.name), seg === null ? segments : [...segments, seg]);
    }
  };
  walk(appDir, []);
  return out;
}

function pkgOf(repoRoot) {
  const p = join(repoRoot, "package.json");
  return existsSync(p) ? readFileSync(p, "utf8") : "";
}

function detectStyling(repoRoot) {
  for (const f of ["tailwind.config.ts", "tailwind.config.js", "tailwind.config.mjs"]) {
    if (existsSync(join(repoRoot, f))) return "tailwind (config)";
  }
  if (/"tailwindcss"/.test(pkgOf(repoRoot))) return "tailwind (v4 @theme or config)";
  return "css custom properties";
}

export const adapter = {
  id: "next-app-router",
  kind: "frontend",

  detect(repoRoot) {
    const dirs = appDirs(repoRoot);
    const pkg = pkgOf(repoRoot);
    const hasNext = /"next"\s*:/.test(pkg);
    const hasConfig = ["next.config.ts", "next.config.js", "next.config.mjs"].some((f) =>
      existsSync(join(repoRoot, f)),
    );
    // An app/ directory is the strongest signal, because it is what makes this
    // the APP router rather than the pages router — the same package.json
    // serves both, so `next` in dependencies distinguishes nothing on its own.
    const hasAppDir = dirs.length > 0;
    const confidence = (hasAppDir ? 0.5 : 0) + (hasNext ? 0.3 : 0) + (hasConfig ? 0.2 : 0);
    return {
      match: confidence >= 0.5,
      confidence,
      stack: "next.js",
      router: hasAppDir ? "next app router (filesystem)" : "unknown",
      styling: detectStyling(repoRoot),
      evidence: dirs[0] ?? null,
    };
  },

  routes(repoRoot) {
    return appDirs(repoRoot)
      .flatMap((d) => routesFrom(d, repoRoot))
      .map((r) => ({ ...r, source: "static" }))
      // A route group can make two directories resolve to one URL. Emitting
      // both would double-count a screen that the application serves once.
      .filter((r, i, all) => all.findIndex((x) => x.path === r.path) === i)
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  },

  /** The command surface, for the derive stage. */
  commands(repoRoot) {
    return appDirs(repoRoot)
      .flatMap((d) => apiRoutesFrom(d))
      .filter((r) => r.verbs.length)
      .sort((a, b) => (a.path < b.path ? -1 : 1));
  },

  /**
   * Reuse a server already answering. Same posture as the Vite adapter and
   * for the same reason: a developer with the app up should not wait for a
   * duplicate, and `next dev` fails on an occupied port anyway.
   */
  async boot(envContract, { fetchImpl = fetch } = {}) {
    const baseURL = envContract?.baseUrl;
    if (!baseURL) return null;
    if (envContract.reuseIfUp !== false && (await isUp(baseURL, fetchImpl))) {
      return { baseURL, reused: true, stop: async () => {} };
    }
    return null; // boot commands are the human's to run (env-contract `boot:`)
  },
};

async function isUp(baseURL, fetchImpl) {
  try {
    const res = await fetchImpl(baseURL, { method: "GET" });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}
