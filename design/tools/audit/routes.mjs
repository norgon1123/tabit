/**
 * The route inventory — agg:design.route-inventory, and the audit's TODO.
 *
 * D-1 made this file the resumability mechanism: there is no separate run
 * state, no lockfile, no cache. A row's status IS the progress, which means a
 * developer can read the audit's state with `cat` and steer it with an editor.
 *
 * Row identity is (path, state). A route is audited once per state it can be
 * in, because a screen with no rows and a screen mid-error are different
 * pictures, and the copy doctrine already names the four classes every screen
 * is contracted for.
 *
 * Merge is additive and stable (task-007): re-running never silently drops a
 * row. A route that has disappeared from both the static set and the crawl is
 * marked `vanished` and kept, because "this used to exist" is a finding and
 * deleting it would erase the only evidence of it.
 */

import { parseYamlRows, yamlList } from "./survey-io.mjs";
import { provenanceHeader } from "./provenance.mjs";

/** The four state classes every screen is contracted for (copy doctrine). */
export const DEFAULT_STATES = ["loaded", "empty", "error", "no-permission"];

export const STATUS = /** @type {const} */ ({
  TODO: "todo",
  CAPTURED: "captured",
  UNREACHABLE: "unreachable",
  VANISHED: "vanished",
});

export const rowKey = (r) => `${r.path} ${r.state}`;

/**
 * Merge a freshly discovered route set into the existing inventory.
 *
 * - unchanged rows keep their status and capturedCommit, so resume works
 * - new rows arrive as todo
 * - rows no longer discovered become vanished, never deleted
 * - `source` reflects THIS discovery (static, crawl, or both) because the
 *   cross-check is the point (D-3): a route that stopped being reachable
 *   should visibly stop being reachable
 */
export function mergeRoutes(existing, discovered) {
  const prev = new Map(existing.map((r) => [rowKey(r), r]));
  const out = [];
  const seen = new Set();

  for (const d of discovered) {
    const states = d.states?.length ? d.states : DEFAULT_STATES;
    for (const state of states) {
      const key = rowKey({ path: d.path, state });
      seen.add(key);
      const before = prev.get(key);
      out.push({
        path: d.path,
        state,
        source: d.source,
        // A vanished row that came back is news: audit it again.
        status:
          before?.status === STATUS.VANISHED
            ? STATUS.TODO
            : (before?.status ?? STATUS.TODO),
        capturedCommit: before?.capturedCommit ?? null,
        note: d.note ?? before?.note ?? null,
      });
    }
  }

  for (const [key, row] of prev) {
    if (seen.has(key)) continue;
    out.push({ ...row, status: STATUS.VANISHED });
  }

  return out.sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      DEFAULT_STATES.indexOf(a.state) - DEFAULT_STATES.indexOf(b.state) ||
      a.state.localeCompare(b.state),
  );
}

/**
 * What still needs capturing at `commit`.
 *
 * `force` re-captures everything discoverable; without it a row captured at
 * this exact commit is skipped — that is what makes an interrupted sweep
 * cheap to resume. `vanished` rows are never candidates: there is nothing at
 * that path left to photograph.
 */
export function pendingRows(rows, commit, { force = false } = {}) {
  return rows.filter((r) => {
    if (r.status === STATUS.VANISHED) return false;
    if (force) return true;
    return !(r.status === STATUS.CAPTURED && r.capturedCommit === commit);
  });
}

export function markCaptured(rows, target, commit) {
  const key = rowKey(target);
  return rows.map((r) =>
    rowKey(r) === key
      ? { ...r, status: STATUS.CAPTURED, capturedCommit: commit }
      : r,
  );
}

/** A state that cannot be reached is RECORDED, never silently skipped (task-003). */
export function markUnreachable(rows, target, why) {
  const key = rowKey(target);
  return rows.map((r) =>
    rowKey(r) === key
      ? { ...r, status: STATUS.UNREACHABLE, note: why ?? r.note ?? null }
      : r,
  );
}

export function parseRoutesFile(src) {
  return parseYamlRows(src, "routes").map((r) => ({
    path: String(r.path),
    state: String(r.state),
    source: r.source ?? "static",
    status: r.status ?? STATUS.TODO,
    capturedCommit: r.capturedCommit ?? null,
    note: r.note ?? null,
  }));
}

export function parseRoutesFindings(src) {
  return parseYamlRows(src, "findings");
}

export function renderRoutesFile(rows, prov, findings = []) {
  const counts = rows.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  const summary = Object.entries(counts)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join(" ");
  return [
    provenanceHeader(prov, [
      "This file is the audit's TODO: status is the progress, and editing it",
      "by hand is a supported way to steer a sweep (D-1).",
      `rows: ${rows.length} (${summary})`,
    ]),
    "version: 1",
    yamlList("routes", rows),
    yamlList("findings", findings),
    "",
  ].join("\n");
}
