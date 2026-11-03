/**
 * Adapter: Vite + React Router (the pilot's stack).
 *
 * Route extraction walks the config with a bracket stack rather than a
 * regex, because the thing that matters is ANCESTRY: `voyage/:voyageId` is
 * meaningless until you know it sits inside `queue`, and a flat grep of
 * `path:` produces a list of fragments that look like routes and are not.
 *
 * The scanner deliberately understands almost nothing about JavaScript. It
 * tracks braces, skips strings and comments, and reads `path:` and
 * `index: true`. JSX in `element:` contributes balanced braces and no path,
 * which costs an empty frame and breaks nothing — a full parse would buy
 * accuracy this stage cannot use, since a declared route still has to be
 * confirmed by the crawl (D-3).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { joinRoutePath } from "./_interface.mjs";

const ROUTER_FILES = [
  "src/app/routes.tsx", "src/routes.tsx", "src/App.tsx",
  "src/router.tsx", "src/app/router.tsx", "src/routes/index.tsx",
];

/** Candidate app roots — a monorepo keeps the SPA a level or three in. */
export function appRoots(repoRoot) {
  const roots = [repoRoot];
  for (const a of ["frontend", "web", "client", "app"]) {
    const base = join(repoRoot, a);
    if (!existsSync(base)) continue;
    roots.push(base);
    for (const b of ["apps", "packages"]) {
      const nested = join(base, b);
      if (!existsSync(nested)) continue;
      // one more level: frontend/apps/<name>
      for (const name of subdirs(nested)) roots.push(join(nested, name));
    }
  }
  return roots;
}

function subdirs(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

export function findRouterFile(repoRoot) {
  for (const root of appRoots(repoRoot)) {
    for (const rel of ROUTER_FILES) {
      const p = join(root, rel);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

/**
 * Extract absolute route paths from a React Router config.
 *
 * Returns rows, not strings: a route's `kind` (page vs splat vs index) and
 * whether it carries params changes what the audit can do with it, and the
 * crawl needs to know which paths it must be GIVEN rather than guessed.
 */
export function extractRoutes(src) {
  const out = [];
  const stack = [];
  let i = 0;
  const n = src.length;

  while (i < n) {
    const ch = src[i];

    // Skip comments and string/template literals wholesale — a `{` inside a
    // string is not structure, and a URL inside a comment is not a route.
    if (ch === "/" && src[i + 1] === "/") {
      i = src.indexOf("\n", i);
      if (i === -1) break;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipString(src, i);
      continue;
    }

    if (ch === "{") {
      stack.push({ path: null, index: false });
      i++;
      continue;
    }
    if (ch === "}") {
      const frame = stack.pop();
      if (frame && (frame.path !== null || frame.index)) {
        const ancestry = stack.map((f) => f.path).filter(Boolean);
        const full = joinRoutePath([...ancestry, frame.path ?? ""]);
        out.push({
          path: full,
          kind: frame.index ? "index" : full.includes("*") ? "splat" : "page",
          params: (full.match(/:[\w]+/g) ?? []).map((p) => p.slice(1)),
        });
      }
      i++;
      continue;
    }

    const key = matchKeyAt(src, i);
    if (key && stack.length) {
      const frame = stack[stack.length - 1];
      if (key.name === "path" && key.value !== null) frame.path = key.value;
      if (key.name === "index" && key.raw === "true") frame.index = true;
      i = key.end;
      continue;
    }

    i++;
  }

  // Ancestry-only frames ("/queue" as a layout with children) legitimately
  // appear twice; identity is the path, and the more specific kind wins.
  const byPath = new Map();
  for (const r of out) {
    const prev = byPath.get(r.path);
    if (!prev || (prev.kind === "index" && r.kind !== "index")) byPath.set(r.path, r);
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function skipString(src, i) {
  const quote = src[i];
  let j = i + 1;
  while (j < src.length) {
    if (src[j] === "\\") {
      j += 2;
      continue;
    }
    if (src[j] === quote) return j + 1;
    j++;
  }
  return src.length;
}

/** `path: "x"` / `index: true` at position i, or null. */
function matchKeyAt(src, i) {
  const m = /^(path|index)\s*:\s*/.exec(src.slice(i, i + 24));
  if (!m) return null;
  let j = i + m[0].length;
  const q = src[j];
  if (q === '"' || q === "'") {
    const end = skipString(src, j);
    return { name: m[1], value: src.slice(j + 1, end - 1), raw: null, end };
  }
  const rest = /^(true|false)/.exec(src.slice(j, j + 6));
  if (rest) return { name: m[1], value: null, raw: rest[1], end: j + rest[0].length };
  return { name: m[1], value: null, raw: null, end: j };
}

export const adapter = {
  id: "vite-react-router",
  kind: "frontend",

  detect(repoRoot) {
    const router = findRouterFile(repoRoot);
    let hasVite = false;
    let hasRouter = false;
    for (const root of appRoots(repoRoot)) {
      hasVite ||= ["vite.config.ts", "vite.config.js", "vite.config.mts"].some(
        (f) => existsSync(join(root, f)),
      );
      const pkg = join(root, "package.json");
      if (existsSync(pkg)) {
        const src = readFileSync(pkg, "utf8");
        hasRouter ||= src.includes("react-router");
      }
    }
    const confidence = (router ? 0.5 : 0) + (hasVite ? 0.3 : 0) + (hasRouter ? 0.2 : 0);
    return {
      match: confidence >= 0.5,
      confidence,
      stack: "vite + react",
      router: router ? "react-router (config)" : "unknown",
      styling: detectStyling(repoRoot),
      evidence: router,
    };
  },

  routes(repoRoot) {
    const file = findRouterFile(repoRoot);
    if (!file) return [];
    return extractRoutes(readFileSync(file, "utf8")).map((r) => ({
      ...r,
      source: "static",
      evidence: file,
    }));
  },

  /**
   * Reuse a server already answering before booting a second one. The pilot
   * ran this way for a reason: a developer with the app already up should not
   * wait ninety seconds for a duplicate, and CI without one still gets a boot.
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

function detectStyling(repoRoot) {
  for (const root of appRoots(repoRoot)) {
    for (const f of ["tailwind.config.ts", "tailwind.config.js"]) {
      if (existsSync(join(root, f))) return "tailwind (config)";
    }
    const pkg = join(root, "package.json");
    if (existsSync(pkg) && readFileSync(pkg, "utf8").includes("tailwindcss"))
      return "tailwind (v4 @theme or config)";
  }
  return "css custom properties";
}
