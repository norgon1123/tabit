/**
 * Route adoption by bulk-confirmed proposal (FR-MP-080, task-007).
 *
 * D-4 refused both automatic adoption (it launders an observation into the
 * ratified record) and per-screen adjudication (right boundary, wrong
 * ergonomics at brownfield scale — 19 routes against 27 declared objects on
 * the pilot). What it directed instead is the mechanism this project already
 * uses when one human must own many small decisions at once: ratification
 * reviews a whole ledger diff and stamps once, not term by term.
 *
 * ADR-MP-6 is why this is a separate module rather than a flag on the diff.
 * A CANDIDATE HAS NO `chosen` FIELD. The schema cannot express a machine's
 * choice, which is stronger than a rule saying it must not make one — a rule
 * can be forgotten by the next author, and an absent field cannot.
 *
 * Nothing here writes design/screens/ (rule:design.tools-never-write-screens).
 * Confirmation is a separate command a human runs.
 */

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const isHoleLike = (v) => Boolean(v) && typeof v === "object" && v.value === null;
const known = (v) => v !== null && v !== undefined && !isHoleLike(v);

/**
 * Candidate routes for one unrouted screen, with the evidence a reviewer needs.
 * Ordered by route so the file diffs reviewably — NOT by any notion of fit,
 * which would be ranking by another name.
 */
function candidatesFor(screen, observedScreens) {
  const name = norm(screen.name);
  return observedScreens
    .filter((o) => {
      const r = norm(o.route);
      return name && (r.includes(name) || name.split(" ").some((w) => w.length > 3 && r.includes(w)));
    })
    .map((o) => ({
      route: o.route,
      states: o.states ?? [],
      evidence: o.evidence ?? null,
      // No `chosen`, no `score`, no `confidence`. See ADR-MP-6.
    }))
    .sort((a, b) => (a.route < b.route ? -1 : 1));
}

/**
 * Pure fold. Every screen the record leaves unrouted, with every served route
 * that could implement it.
 *
 * A screen with several candidates is NOT resolved here and is not marked as
 * needing resolution differently from one with a single candidate — the file
 * carries what was observed, and the human decides what that means.
 */
export function proposeRoutes(current, target, { declined = [] } = {}) {
  if (!current || !target) return { version: 1, context: null, proposals: [] };
  const context = target.context ?? current.context ?? null;
  const observed = current.screens ?? [];
  const declinedKeys = new Set(declined.map((d) => `${d.screen}::${d.route}`));

  const proposals = (target.screens ?? [])
    .filter((s) => !known(s.route))
    .map((s) => ({
      screen: s.name,
      archetype: known(s.archetype) ? s.archetype : null,
      candidates: candidatesFor(s, observed)
        // A pairing refused once is not re-proposed unless the evidence changes.
        .filter((c) => !declinedKeys.has(`${s.name}::${c.route}`)),
    }))
    .filter((p) => p.candidates.length > 0)
    .sort((a, b) => (String(a.screen) < String(b.screen) ? -1 : 1));

  return { version: 1, context, proposals };
}

/**
 * Serialise. Kept beside the fold rather than in a stage because the header is
 * part of the contract: a reader opening this file must learn, before the data,
 * that confirming it is a human act.
 */
export function renderProposalFile(proposal) {
  const lines = [
    "# ROUTE ADOPTION PROPOSAL — nothing here is adopted.",
    "#",
    "# Each screen below is declared with no route, and each candidate is a route",
    "# that ships. Confirming this file is a HUMAN act, reviewed in bulk the way a",
    "# ledger diff is ratified — one pass over the whole list, not one decision per",
    "# screen (D-4).",
    "#",
    "# A candidate carries no `chosen` field and no score. Where several routes",
    "# could implement one screen, all are listed and none is preferred: which is",
    "# canonical is exactly the decision that was not delegated (ADR-MP-6).",
    "#",
    "# Declining is recorded. A refused pairing is not proposed again unless the",
    "# evidence changes.",
    "version: 1",
    `context: ${proposal.context ?? "unknown"}`,
    "proposals:",
  ];
  if (!proposal.proposals.length) {
    lines.push("  []  # every declared screen already carries a route");
    return lines.join("\n") + "\n";
  }
  for (const p of proposal.proposals) {
    lines.push(`  - screen: ${p.screen}`);
    lines.push(`    archetype: ${p.archetype ?? "~"}`);
    lines.push(`    candidates:`);
    for (const c of p.candidates) {
      lines.push(`      - { route: "${c.route}", states: [${(c.states ?? []).join(", ")}], evidence: ${c.evidence ? `"${c.evidence}"` : "~"} }`);
    }
  }
  return lines.join("\n") + "\n";
}
