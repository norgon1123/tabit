/**
 * Derive objects — candidate nouns from repeated structure (FR-DA-045).
 *
 * The audit could already propose VERBS (observed-flows.yaml) and could only
 * DIFF nouns against a record that, for a legacy app, does not exist — so the
 * gap report read "uncovered" on every line and gave a team nothing to start
 * from. This stage is the missing half: it proposes objects, which is also the
 * order ORCA works in (FP-2, objects before actions).
 *
 * The algorithm is prior art, not invention. Repeated-sibling segmentation is
 * MDR (Liu et al., 2005). MDR's documented failure is non-contiguous or
 * irregular records, and a naive MDR pass over waypoint-web reproduced it
 * exactly: one `action` object split into three collections because cards
 * carrying an optional "Default Agent" row have a different structural
 * signature. DEPTA (Zhai & Liu, IEEE TKDE 2006) fixes that by decoupling
 * segmentation from alignment, so partial tree alignment is here from the
 * first commit rather than bolted on after the bug is rediscovered
 * (ADR-DA-9).
 *
 * Everything emitted is a CANDIDATE (ADR-DA-4). This stage does not decide
 * cardinality, zones, domain mapping, attribute class or banned synonyms —
 * none of which are visible in rendered output — and it never writes an object
 * map. `agent → Persona` is the standing example: the DOM only ever carries
 * the UI word, and recovering the domain name is exactly what a human
 * ratification checkpoint is for.
 */

import { provenanceHeader } from "../provenance.mjs";
import { writeSurvey, yamlList } from "../survey-io.mjs";

/** Field names that are chrome wherever they appear. */
const CHROME = /^(show|hide|open|close|menu|toggle|expand|collapse|\W*)$/i;

/**
 * How alike two member shapes are, 0..1 — the DEPTA half.
 *
 * Signatures are compared as token multisets rather than strings so that one
 * extra row inside a card costs similarity instead of identity. Plain MDR
 * compares signatures for equality, which is what splits one object into
 * three when a subset of its cards carry an optional field.
 */
export function shapeSimilarity(a, b) {
  const toks = (s) => s.split(/[(),]/).filter(Boolean);
  const A = toks(a);
  const B = toks(b);
  if (!A.length || !B.length) return 0;
  const pool = [...B];
  let shared = 0;
  for (const t of A) {
    const at = pool.indexOf(t);
    if (at !== -1) {
      shared++;
      pool.splice(at, 1);
    }
  }
  return (2 * shared) / (A.length + B.length);
}

/**
 * Merge groups whose members are the same thing rendered two ways.
 *
 * Containers must match as well as shapes: two lists of genuinely different
 * objects can look alike, and merging on shape alone would collapse them into
 * one noun nobody would recognise.
 */
export function alignGroups(groups, { threshold = 0.65 } = {}) {
  const merged = [];
  for (const g of groups) {
    const hit = merged.find(
      (m) =>
        m.containerPath === g.containerPath &&
        shapeSimilarity(m.signature, g.signature) >= threshold,
    );
    if (hit) {
      hit.members.push(...g.members);
      hit.alignedFrom = (hit.alignedFrom ?? [hit.signature]).concat(g.signature);
    } else {
      merged.push({ ...g, members: [...g.members] });
    }
  }
  return merged;
}

/**
 * Which leaves vary across members — those are fields; constants are chrome.
 *
 * Position is matched by order within the member, which is also what makes the
 * result a RANKING: render order is the only evidence of salience a DOM
 * carries, and `card_fields` is defined as the ranked card render.
 */
export function fieldsOf(members, { minVaried = 2 } = {}) {
  const width = Math.min(...members.map((m) => m.leaves.length));
  if (!Number.isFinite(width) || width < minVaried) return [];
  const fields = [];
  for (let i = 0; i < width; i++) {
    const values = members.map((m) => m.leaves[i]?.text ?? "");
    const distinct = new Set(values.filter(Boolean));
    if (distinct.size <= 1) continue; // constant across members → a label
    const sample = values.find(Boolean) ?? "";
    if (CHROME.test(sample)) continue;
    fields.push({
      rank: fields.length + 1,
      sample,
      varies: distinct.size,
      shape: shapeOf([...distinct]),
    });
  }
  return fields;
}

/** A coarse hint at what a field holds. Recorded, never asserted. */
export function shapeOf(values) {
  if (values.every((v) => /^\d[\d.,]*$/.test(v))) return "number";
  if (values.every((v) => /^\S+$/.test(v) && v.length < 40)) return "token";
  if (values.some((v) => v.length > 60)) return "prose";
  return "text";
}

/**
 * Candidate objects from aligned groups.
 *
 * `name` is the nearest preceding heading when the capture recorded one; the
 * container path otherwise. Both are evidence a reviewer can check against the
 * page, which is the point — a candidate nobody can verify is a guess wearing
 * a schema.
 */
export function candidateObjects(groups, { route = null, headings = [] } = {}) {
  const out = [];
  for (const g of alignGroups(groups)) {
    const fields = fieldsOf(g.members);
    if (fields.length < 2) continue; // one varying field is a list, not an object
    // A scope filter — All 26 / System 16 / Org 6 — repeats, varies, and is
    // not a record. A label and a count cannot distinguish a card from a
    // control, so a group needs a third field or one carrying real text. This
    // is a precision choice, stated rather than tuned silently: a genuine
    // two-token object is missed, and a human adding one costs less than a
    // ledger seeded with toolbar furniture.
    const substantive = fields.some((f) => f.shape === "text" || f.shape === "prose");
    if (fields.length < 3 && !substantive) continue;
    const name = nameFor(g, headings);
    out.push({
      // An unnamed candidate is still a finding — a repeated structure IS
      // there. Naming it `div mt-1 5` from its container class would dress
      // noise as a noun and hand a reviewer something to delete rather than
      // something to adjudicate. The evidence path is how they find it.
      name: name ?? "(unnamed)",
      named: Boolean(name),
      // Alternative spellings, recorded as evidence rather than asserted in
      // place of what the page says. See nounsFor.
      headingNouns: nounsFor(name, route).headingNouns,
      routeNouns: nounsFor(name, route).routeNouns,
      members: g.members.length,
      cardFields: fields.map((f) => f.sample).slice(0, 6).join(" | "),
      fieldCount: fields.length,
      representation: representationOf(g),
      route,
      evidence: g.containerPath,
      alignedShapes: (g.alignedFrom ?? [g.signature]).length,
    });
  }
  return out;
}

/**
 * The heading the capture found, else the container as a fallback label.
 *
 * A heading is usually plural and often parenthesised with a count —
 * "Built-in Actions (21)". Both are stripped because a candidate NOUN is what
 * design-model adjudicates; the count is evidence and lives in `members`.
 */
function nameFor(group, headings) {
  const raw =
    group.heading ??
    headings.find((x) => group.containerPath.startsWith(x.scope ?? ""))?.text;
  if (!raw) return null;
  const cleaned = raw.replace(/\s*\(\s*\d+\s*\)\s*$/, "").trim();
  return cleaned || null;
}

/**
 * Plural -> singular, for the last word only.
 *
 * Deliberately small. It handles the endings an English UI actually produces
 * and returns the word untouched otherwise, because a wrong singular is worse
 * than none: it invents a noun a reviewer will adjudicate against nothing on
 * the page. Words ending -ss/-us/-is are NOT plurals (address, status,
 * analysis) and are the reason this is not a bare `replace(/s$/)`.
 */
// Words that end in -s and are NOT plurals. Without this, `studio.atlas`
// yields "atla" and `series` yields "sery" — invented nouns a reviewer would
// adjudicate against nothing on the page. Atlas is a real route here, which is
// how this list stopped being hypothetical.
// Only the words the -ss/-us/-is rule below does NOT already cover. Keeping
// redundant entries here would imply the rule misses them.
const NOT_PLURAL = new Set([
  "atlas", "canvas", "alias", "bias", "gas", "lens", "news", "series", "species",
]);

const IRREGULAR = new Map([
  ["people", "person"],
  ["children", "child"],
  ["indices", "index"],
  ["matrices", "matrix"],
]);

export function singularise(word) {
  const w = String(word ?? "").trim();
  if (!w) return w;
  const lower = w.toLowerCase();
  if (IRREGULAR.has(lower)) return IRREGULAR.get(lower);
  if (NOT_PLURAL.has(lower)) return w;
  if (/(ss|us|is)$/i.test(w)) return w;
  if (/ies$/i.test(w)) return `${w.slice(0, -3)}y`;
  if (/(ches|shes|xes|zes|ses)$/i.test(w)) return w.slice(0, -2);
  if (/s$/i.test(w)) return w.slice(0, -1);
  return w;
}

/** Singularise a phrase by its head word: "Built-in Actions" -> "built-in action". */
export function singularisePhrase(phrase) {
  const parts = String(phrase ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  parts[parts.length - 1] = singularise(parts[parts.length - 1]);
  return parts.join(" ").toLowerCase();
}

/**
 * The noun a route implies: `agent-framework.workflows` -> `workflow`.
 *
 * This is the fix for the naming bug the first real sweep exposed. `nameFor`
 * returns the nearest heading, and a heading names a GROUPING, not a type:
 * the workflows page headed "Standard SDLC" yielded a candidate called
 * Standard SDLC, so the ratified `workflow` read as declared-and-never-
 * observed when it was on screen the whole time.
 *
 * A route segment is weaker evidence than a heading about what a given group
 * IS, which is why the diff uses it in one direction only. Parameter segments
 * name no object. A bare context segment names no object either.
 */
const PARAM_SEGMENT = /^(slug|id|uuid|key|\*|:.*)$/i;

export function routeNoun(route) {
  // capture walks each route once per state, so the raw route arrives as
  // `agent-framework.workflows@empty`. Left in, the state becomes part of the
  // noun — "workflows@error" — which is the invented-noun failure this
  // function exists to avoid. baseRoute strips it later; too late for naming.
  const segments = String(route ?? "")
    .replace(/@.*$/, "")
    .split(/[./]/)
    .filter(Boolean)
    .filter((seg) => !PARAM_SEGMENT.test(seg));
  // One segment is the context itself, and a context is not an object.
  if (segments.length < 2) return null;
  return singularisePhrase(segments[segments.length - 1].replace(/-/g, " "));
}

/**
 * The spellings a reviewer might adjudicate this candidate to.
 *
 * `name` stays exactly what the page says — it is the evidence, and it is
 * checkable. These are alternatives recorded ALONGSIDE it, never a
 * replacement: adjudicating the noun is design-model's job, not this stage's.
 */
export function nounsFor(name, route) {
  const heading = name ? singularisePhrase(name) : null;
  const fromRoute = routeNoun(route);
  return {
    headingNouns: heading ? [heading] : [],
    routeNouns: fromRoute && fromRoute !== heading ? [fromRoute] : [],
  };
}

/**
 * The constitution's representation table, run backwards.
 *
 * Only the forms a render can actually evidence. Cardinality is NOT derivable
 * — a card linking to one thing says nothing about the inverse multiplicity —
 * so it is absent rather than guessed.
 */
export function representationOf(group) {
  const nested = group.members.some((m) => m.leaves.length > 8);
  return nested ? "embedded-list" : "link";
}

export async function run(ctx) {
  const captured = ctx.records ?? [];
  const objects = [];
  for (const { route, groups, headings } of captured) {
    objects.push(...candidateObjects(groups, { route, headings }));
  }
  // Same noun rendered on two routes is one candidate with two pieces of
  // evidence, not two candidates a human has to notice are the same.
  //
  // States are NOT separate evidence. capture walks each route once per state
  // (loaded / empty / error / no-permission), so summing members counted the
  // same list four times — 704 rows where the page shows at most a fraction of
  // that. Found on CruisePaperwork; waypoint-web's single-state fixtures could
  // not surface it. The count is the LARGEST observation, not the total.
  const baseRoute = (r) => String(r ?? "").split("@")[0];
  const byName = new Map();
  for (const o of objects) {
    const prev = byName.get(o.name);
    if (prev) {
      prev.members = Math.max(prev.members, o.members);
      const seen = new Set(prev.route.split(", "));
      seen.add(baseRoute(o.route));
      prev.route = [...seen].sort().join(", ");
      // The same noun on two routes carries BOTH routes' evidence. Keeping
      // only the first would drop exactly the signal this merge exists to
      // accumulate — an object rendered on /workflows and /workflows/:id
      // should end up carrying `workflow` either way round.
      prev.routeNouns = [...new Set([...(prev.routeNouns ?? []), ...(o.routeNouns ?? [])])].sort();
      prev.headingNouns = [...new Set([...(prev.headingNouns ?? []), ...(o.headingNouns ?? [])])].sort();
    } else {
      byName.set(o.name, { ...o, route: baseRoute(o.route) });
    }
  }
  const rows = [...byName.values()].sort((a, b) => b.members - a.members);
  const prov = ctx.provenanceFor("audit/derive-objects");

  return {
    artifacts: [
      writeSurvey(
        ctx.repoRoot,
        "observed-objects.yaml",
        [
          provenanceHeader(prov, [
            "CANDIDATE OBJECTS, and only what a render can evidence. Names,",
            "ranked card fields and representation form are derivable;",
            "cardinality, zone, domain mapping, attribute class and banned",
            "synonyms are NOT, and are absent rather than guessed (FR-DA-045).",
            "Proposal input to /waypoint.design-model — never an object map.",
          ]),
          "version: 1",
          yamlList("candidateObjects", rows, { style: "block" }),
          "",
        ].join("\n"),
      ),
    ],
    // runStages pipes `exports` into ctx; validate reads ctx.objects for the
    // baseline offer.
    exports: { objects: rows },
  };
}
