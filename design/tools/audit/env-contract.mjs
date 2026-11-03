/**
 * The environment contract — how to put the audited application into a known
 * state, written by a human, read by the audit.
 *
 * The pilot's sharpest lesson: a survey of a running app with empty worklists
 * is perfectly ACCURATE and completely USELESS. What makes a capture true is
 * not "localhost" — it is a boot recipe plus a seed recipe that produce the
 * same screen twice. So the contract is authored, not detected, and the audit
 * refuses to claim T1 without one.
 *
 * Absent or unbootable: the audit degrades to T2 (static mocks) or T3 (source
 * only) and SAYS SO in every artifact, rather than quietly measuring a login
 * page and calling it a worklist.
 */

import { parseYamlRows } from "./survey-io.mjs";

export const ENV_CONTRACT_FILE = "env-contract.yaml";

const FLAT_KEYS = [
  "version",
  "tier",
  "baseUrl",
  "relayOrigins",
  "boot",
  "reuseIfUp",
  "seed",
  "reset",
  "auth",
  "viewport",
  "mockGlob",
];

/**
 * Parse the contract. Flat top-level keys plus two row lists (`states` and
 * `skip`), which keeps it inside the parser subset the rest of the design
 * system reads.
 */
export function parseEnvContract(src) {
  const out = { states: [], skip: [] };
  if (!src) return out;
  for (const raw of src.split("\n")) {
    const line = raw.replace(/(^|\s)#.*$/, "").trimEnd();
    if (!line.trim() || /^\s/.test(line)) continue;
    const m = line.match(/^([\w-]+):\s*(.*)$/);
    if (!m) continue;
    const [, k, v] = m;
    if (!FLAT_KEYS.includes(k) || v === "") continue;
    out[k] = coerce(v);
  }
  out.states = parseYamlRows(src, "states");
  out.skip = parseYamlRows(src, "skip");
  if (typeof out.viewport === "string") {
    const vp = out.viewport.match(/(\d+)\s*x\s*(\d+)/i);
    out.viewport = vp
      ? { width: Number(vp[1]), height: Number(vp[2]) }
      : undefined;
  }
  return out;
}

function coerce(v) {
  const s = v.trim().replace(/^"(.*)"$/, "$1");
  if (/^(true|false)$/.test(s)) return s === "true";
  if (/^\d+$/.test(s)) return Number(s);
  return s;
}

/**
 * Which tier this contract can actually support, independent of what it
 * claims. A contract asserting T1 with no way to reach the app is a wish.
 */
export function tierFor(contract, { playwrightAvailable = false } = {}) {
  if (!playwrightAvailable) return "T3";
  if (contract?.baseUrl || contract?.boot) return "T1";
  if (contract?.mockGlob) return "T2";
  return "T3";
}

/** The scaffold written on first detect — a form for a human to fill in. */
export function scaffoldEnvContract({ baseUrl, boot, framework } = {}) {
  return `# The environment contract — AUTHORED BY A HUMAN, read by the audit.
#
# The audit measures what it can reach. A capture of an app with no seeded
# data is accurate and useless, so this file is where the state recipe lives.
# Without a reachable app the audit degrades to T2/T3 and says so in every
# artifact; it never pretends source analysis is measurement.
version: 1

# tier the audit should attempt: T1 live app | T2 static mocks | T3 source only
tier: ${baseUrl || boot ? "T1" : "T3"}

# Where the app answers once booted.
baseUrl: ${baseUrl ?? "http://localhost:5173"}

# How to start it. Leave blank to require an already-running server.
boot: ${boot ?? ""}

# Reuse a server already listening on baseUrl instead of booting one.
reuseIfUp: true

# How to put data in a known state before capture (seed script, fixture POST).
seed:

# How to return to that known state between states (optional).
reset:

# How authenticated sessions are obtained: none | dev-open | storage-state path
auth: ${framework === "unknown" ? "" : "dev-open"}

# Capture viewport. The pilot used 1440x900; changing it changes every skeleton.
viewport: 1440x900

# For T2: where the static mocks live (file:// capture, no server).
mockGlob:

# API origins the browser must relay past CORS, comma separated.
#
# An SPA served from one port and calling APIs on another is the normal local
# shape, and the APIs usually whitelist only the standard dev origin. Without
# relaying, every data fetch fails: the shell renders, the content does not,
# and the audit measures a census of navigation chrome while reporting that
# every CTA in the ledger is missing. The pilot did exactly that.
relayOrigins:

# Per-route state recipes. Each row says how to REACH a state; a state with no
# recipe is attempted naively and recorded \`unreachable\` if it cannot be shown.
states: []

# Paths the audit must not visit (logout, destructive actions, external links).
skip: []
`;
}
