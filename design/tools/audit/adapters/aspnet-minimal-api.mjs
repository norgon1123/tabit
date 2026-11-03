/**
 * Adapter: ASP.NET backend routes — the COMMAND surface.
 *
 * This adapter is not here to audit a UI. It is here because a button labelled
 * "Process" means very little on its own, and `MapPost("/voyages/{id}/process")`
 * is the corroborating evidence that turns it into a candidate CTA with a
 * command behind it (task-008). Losing the write verbs would starve derive of
 * exactly the half that distinguishes an action from a link.
 *
 * Extraction is regex-over-source with group tracking, not compilation. That
 * is a deliberate ceiling: the output is EVIDENCE offered to a human at a
 * design-flow proposal, and a route this misses is a route the crawl or the
 * control harvest can still surface. A compiler in the audit would buy
 * precision the cadence does not spend.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

/**
 * Endpoints that exist for machines, recorded here rather than dropped in a
 * regex somewhere — an exclusion nobody can see is indistinguishable from a
 * bug, and the next person needs to know why /health never appears.
 */
export const INFRA_PATTERNS = [
  { pattern: /^\/?health\b/i, why: "liveness probe — not a user command" },
  { pattern: /^\/?ready\b/i, why: "readiness probe" },
  { pattern: /^\/?metrics\b/i, why: "scrape endpoint" },
  { pattern: /^\/?swagger/i, why: "API docs" },
  { pattern: /^\/?openapi/i, why: "API schema" },
  { pattern: /\{\*\*?catchall\}/i, why: "framework catch-all" },
];

export function isInfraRoute(path) {
  const p = String(path ?? "").replace(/^\/?api\//, "/");
  return INFRA_PATTERNS.find((r) => r.pattern.test(p)) ?? null;
}

const CS_EXT = new Set([".cs"]);
const SKIP_DIR = new Set(["bin", "obj", "node_modules", ".git", "TestResults"]);

export function* csharpFiles(root, { limit = 3000 } = {}) {
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
      if (e.name.startsWith(".")) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIR.has(e.name)) stack.push(full);
        continue;
      }
      if (!CS_EXT.has(extname(e.name))) continue;
      if (++seen > limit) return;
      yield full;
    }
  }
}

/**
 * Minimal APIs, with group prefixes resolved.
 *
 * `var api = app.MapGroup("/api")` followed by `api.MapPost("/reset")` is the
 * shipped shape; reading the second line alone yields `/reset`, a path that
 * does not exist. Tracking the variable is the difference between an endpoint
 * list and a plausible-looking fiction.
 */
export function extractMinimalApi(src, file) {
  const groups = new Map();
  for (const m of src.matchAll(
    /(?:var|let)\s+(\w+)\s*=\s*(\w+)\.MapGroup\(\s*"([^"]*)"/g,
  )) {
    const [, name, parent, path] = m;
    groups.set(name, `${groups.get(parent) ?? ""}${path}`);
  }

  const out = [];
  const lines = src.split("\n");
  lines.forEach((line, i) => {
    for (const m of line.matchAll(
      /(\w+)\.Map(Get|Post|Put|Delete|Patch)\(\s*"([^"]*)"/g,
    )) {
      const [, receiver, method, path] = m;
      const prefix = groups.get(receiver) ?? "";
      const full = normalize(`${prefix}${path}`);
      out.push({
        method: method.toUpperCase(),
        path: full,
        handlerName: handlerNameFrom(full, method),
        source: "static",
        evidence: `${file}:${i + 1}`,
      });
    }
  });
  return out;
}

/** Attribute-routed controllers: [Route] on the class, [HttpPost] on actions. */
export function extractAttributeRoutes(src, file) {
  const out = [];
  const controller = /class\s+(\w+)Controller\b/.exec(src)?.[1];
  const classRoute =
    /\[Route\(\s*"([^"]*)"\s*\)\]/.exec(src)?.[1]?.replace(
      /\[controller\]/gi,
      controller ?? "",
    ) ?? "";

  const lines = src.split("\n");
  lines.forEach((line, i) => {
    const m = /\[Http(Get|Post|Put|Delete|Patch)(?:\(\s*"([^"]*)"\s*\))?\]/.exec(line);
    if (!m) return;
    const [, method, actionRoute] = m;
    // The action's own name is the next method signature; a handler without a
    // name is still a route, so the name is optional evidence.
    const after = lines.slice(i + 1, i + 4).join(" ");
    const action = /\b(?:public|internal)\s+[\w<>,\s\[\]?]+\s+(\w+)\s*\(/.exec(after)?.[1];
    const full = normalize(`/${classRoute}/${actionRoute ?? ""}`);
    out.push({
      method: method.toUpperCase(),
      path: full,
      handlerName: action ?? handlerNameFrom(full, method),
      source: "static",
      evidence: `${file}:${i + 1}`,
    });
  });
  return out;
}

function normalize(path) {
  const p = `/${String(path).replace(/^\/+/, "").replace(/\/+$/, "")}`.replace(
    /\/{2,}/g,
    "/",
  );
  return p === "/" ? "/" : p;
}

/**
 * A candidate name, VERBATIM from the route. No canonical-verb mapping here:
 * "confirm" stays "confirm" rather than becoming "Approve", because the
 * adjudication belongs to a human at a design-flow proposal (ADR-DA-4).
 */
function handlerNameFrom(path, method) {
  const tail = path
    .split("/")
    .filter((s) => s && !s.startsWith("{"))
    .pop();
  return tail ? `${method.toLowerCase()} ${tail}` : method.toLowerCase();
}

export const adapter = {
  id: "aspnet-minimal-api",
  kind: "backend",

  detect(repoRoot) {
    let csproj = false;
    let program = false;
    for (const dir of ["backend", "src", "."]) {
      const base = join(repoRoot, dir);
      if (!existsSync(base)) continue;
      for (const f of csharpFiles(base, { limit: 400 })) {
        if (f.endsWith("Program.cs")) program = true;
        if (program) break;
      }
      csproj ||= hasCsproj(base);
    }
    const confidence = (program ? 0.6 : 0) + (csproj ? 0.4 : 0);
    return {
      match: confidence >= 0.5,
      confidence,
      stack: ".NET",
      router: "minimal API / attribute routing",
      styling: null,
    };
  },

  /** Backend routes are the command surface, not navigable screens. */
  routes(repoRoot) {
    const out = [];
    for (const file of csharpFiles(repoRoot)) {
      let src;
      try {
        if (statSync(file).size > 400_000) continue;
        src = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      if (!/\.Map(Get|Post|Put|Delete|Patch)\(|\[Http(Get|Post|Put|Delete|Patch)/.test(src))
        continue;
      const rel = relative(repoRoot, file);
      out.push(...extractMinimalApi(src, rel), ...extractAttributeRoutes(src, rel));
    }
    const kept = [];
    const excluded = [];
    for (const r of out) {
      const infra = isInfraRoute(r.path);
      (infra ? excluded : kept).push(infra ? { ...r, excludedBecause: infra.why } : r);
    }
    kept.excluded = excluded;
    return kept;
  },
};

function hasCsproj(dir) {
  const stack = [dir];
  let budget = 300;
  while (stack.length && budget-- > 0) {
    let entries;
    try {
      entries = readdirSync(stack.pop(), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory() && !SKIP_DIR.has(e.name) && !e.name.startsWith("."))
        stack.push(join(dir, e.name));
      if (e.isFile() && (e.name.endsWith(".csproj") || e.name.endsWith(".slnx")))
        return true;
    }
  }
  return false;
}
