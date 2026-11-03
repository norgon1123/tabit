/**
 * port:design.app-under-audit — the seam that makes the audit stack-agnostic.
 *
 * Everything above this line (capture, census, skeletons, gaps) is written
 * once and never learns what framework it is looking at; everything a
 * framework needs to say fits in four functions. That asymmetry is the whole
 * design: adding Rails or Django or a .NET MVC app should cost one small
 * adapter, not a second audit.
 *
 *   kind              "frontend" (describes screens) | "backend" (commands)
 *   detect(repoRoot) -> { match, confidence, stack, router, styling }
 *   routes(repoRoot)  -> [{ path, kind, source }]      // statically declared
 *   boot(envContract) -> { baseURL, stop() } | null    // or reuse what runs
 *   walk(page, route) -> void                          // optional settle hook
 *
 * `confidence` exists because detection is evidence, not certainty: two
 * adapters may both match a hybrid repo, and the runner records which one it
 * chose and why rather than silently preferring whichever sorted first.
 */

/** Shape-check an adapter at registration — a typo here is a silent no-op later. */
export const ADAPTER_KINDS = ["frontend", "backend"];

export function assertAdapter(adapter) {
  for (const fn of ["detect", "routes"]) {
    if (typeof adapter?.[fn] !== "function")
      throw new Error(`adapter ${adapter?.id ?? "?"} is missing ${fn}()`);
  }
  if (!adapter.id) throw new Error("adapter needs an id");
  if (!ADAPTER_KINDS.includes(adapter.kind))
    throw new Error(
      `adapter ${adapter.id} must declare kind: ${ADAPTER_KINDS.join(" | ")}`,
    );
  return adapter;
}

/**
 * Highest confidence wins; ties break by id so a repo that matches two
 * adapters equally produces the SAME answer on every run. A detector whose
 * result depends on directory-read order is a detector that will one day
 * change its mind for no reason anyone can reproduce.
 *
 * `kind` filters BEFORE scoring, because the primary adapter answers "what
 * screens does this app have" and a backend adapter cannot answer it at any
 * confidence. The pilot's first run crowned the .NET adapter on a full-stack
 * repo — both scored 1.0 and "aspnet" sorts before "vite" — which is a
 * missing field, not a tie-break bug.
 */
export function pickAdapter(adapters, repoRoot, { kind = "frontend" } = {}) {
  const scored = adapters
    .filter((a) => !kind || a.kind === kind)
    .map((a) => ({ adapter: a, result: a.detect(repoRoot) }))
    .filter((s) => s.result?.match)
    .sort(
      (x, y) =>
        (y.result.confidence ?? 0) - (x.result.confidence ?? 0) ||
        x.adapter.id.localeCompare(y.adapter.id),
    );
  return scored[0] ?? null;
}

/** Join a react-router-style ancestry into one absolute path. */
export function joinRoutePath(segments) {
  let out = "";
  for (const raw of segments) {
    const seg = String(raw ?? "").trim();
    if (!seg) continue;
    if (seg.startsWith("/")) {
      out = seg; // an absolute child resets the ancestry, as the router does
      continue;
    }
    out = `${out.replace(/\/$/, "")}/${seg}`;
  }
  return out === "" ? "/" : out.replace(/\/{2,}/g, "/");
}
