/**
 * Diff a current model against a target model (FR-MP-050, task-006).
 *
 * Pure and total (ADR-MP-5): same inputs, same findings, same order, no I/O.
 * The calling stage reads and writes; this function only folds. That is what
 * lets one implementation serve the CLI, a test, and eventually the Studio.
 *
 * EVERY FINDING NAMES A CHOICE AND STOPS. None recommends, none picks a side.
 * Where two route families serve one declared screen the finding carries both
 * and adjudicates neither — the discipline FR-DA-046 already follows, and the
 * reason its `notComputed` entry exists.
 *
 * Finding order is stable by construction, sorted by (kind, context, subject),
 * so design/diff/{context}.yaml produces a reviewable git diff rather than a
 * reshuffle on every run.
 */
import { isHole } from "./model-schema.mjs";

/** A value that is present and real — not a hole, not null. */
const known = (v) => v !== null && v !== undefined && !isHole(v);
/** Compare user-facing names the way a reader would. */
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Does one normalised name MENTION another — as whole words, never as a
 * substring?
 *
 * `norm` turns a value into space-separated tokens, and the plausible-match
 * rules below were asking `includes()` on the joined string. That made
 * "studio projectslug" contain "projects", so declaring a screen called
 * `projects` immediately produced a competing-route-families finding against
 * `/studio/:projectSlug` — one word happening to begin with another.
 *
 * A mention is a contiguous run of whole tokens. "voyage worklist" still
 * mentions "voyage", which is the hint these rules exist to catch; "projectslug"
 * no longer mentions "projects", which was never a hint at all.
 */
export function mentions(haystack, needle) {
  const hay = String(haystack ?? "").split(" ").filter(Boolean);
  const want = String(needle ?? "").split(" ").filter(Boolean);
  if (!want.length || want.length > hay.length) return false;
  return hay.some((_, i) => want.every((w, j) => hay[i + j] === w));
}

/**
 * A route's identity is its SHAPE: literal segments plus the POSITIONS of its
 * parameters. Names are labels on those positions, not part of what the route
 * matches — `/studio/{project}/{context}/diff` and
 * `/studio/:projectSlug/:context/diff` serve exactly the same URLs.
 *
 * Three placeholder spellings reach this function, and normalising them is NOT
 * why it exists: `norm` already flattened `[projectSlug]`, `{projectSlug}` and
 * `:projectSlug` to the same string, because it strips every non-alphanumeric.
 * What it could not do was tell that `{project}` and `:projectSlug` name one
 * position, so a route declared by hand and the same route observed from Next
 * read as two — and the model diff reported a screen's own route as undeclared.
 *
 * `[...rest]` and `[[...rest]]` become `*`: a catch-all matches a different set
 * of URLs from a single segment and must not compare equal to one.
 */
export function routeShape(path) {
  return String(path ?? "")
    .replace(/\[\[?\.\.\.[^\]]+\]?\]/g, "*")
    .replace(/\[([^\]]+)\]/g, ":$1")
    .replace(/\{([^}]+)\}/g, ":$1")
    .split("/")
    .filter(Boolean)
    .map((seg) => (seg.startsWith(":") ? ":" : seg === "*" ? "*" : seg.toLowerCase()))
    .join("/");
}

/** The parameter names a route carries, in order. Labels, never identity. */
export function routeParams(path) {
  return String(path ?? "")
    .replace(/\[\[?\.\.\.([^\]]+)\]?\]/g, "{$1}")
    .replace(/\[([^\]]+)\]/g, "{$1}")
    .replace(/:([A-Za-z0-9_]+)/g, "{$1}")
    .split("/")
    .filter((seg) => /^\{.+\}$/.test(seg))
    .map((seg) => seg.slice(1, -1));
}

function finding(kind, subject, detail, evidence = {}) {
  return { kind, subject, detail, evidence };
}

/* ── structural ──────────────────────────────────────────────── */

export function structuralFindings(current, target) {
  const out = [];
  const declared = target.screens ?? [];
  const observed = current.screens ?? [];

  // Screen-count disagreement is reported ONCE for the context, not per screen:
  // it is one question about the context's shape, and N copies of it would bury
  // the findings that name individual objects.
  if (declared.length && observed.length && declared.length !== observed.length) {
    out.push(finding(
      "screen-count",
      current.context,
      `${declared.length} screen(s) declared, ${observed.length} route(s) served`,
      { declared: declared.map((s) => s.name), observed: observed.map((s) => s.route) },
    ));
  }

  // A declared screen with no route cannot be matched to anything served. That
  // is a gap in the RECORD, and it is what route adoption (FR-MP-080) proposes
  // to close — never something this function closes.
  for (const s of declared) {
    if (!known(s.route)) {
      out.push(finding(
        "declared-screen-unrouted",
        s.name,
        "this screen declares no route, so nothing served can be matched to it",
        { archetype: s.archetype ?? null },
      ));
    }
  }

  // A served route no declared screen names. Deliberately NOT called dead code:
  // it may be deep-link-only, or it may be the canonical implementation and the
  // record the thing that is behind.
  // Matched by SHAPE, so a route is not reported as undeclared merely because
  // the record and the code label one position differently.
  const declaredByShape = new Map(
    declared.filter((s) => known(s.route)).map((s) => [routeShape(s.route), s]),
  );
  for (const s of observed) {
    if (declaredByShape.size && !declaredByShape.has(routeShape(s.route))) {
      out.push(finding(
        "route-undeclared",
        s.route,
        "this route ships and no declared screen names it",
        { states: s.states ?? [], evidence: s.evidence ?? null },
      ));
    }
  }

  // Shapes agree, labels do not. Silence here would hide a real disagreement —
  // the record calls a position `project` and the code calls it `projectSlug`,
  // and one of them is what a reader will go looking for. Named, never picked:
  // which spelling is right is a decision about vocabulary, not a typo.
  for (const s of observed) {
    const d = declaredByShape.get(routeShape(s.route));
    if (!d) continue;
    const got = routeParams(s.route);
    const want = routeParams(d.route);
    if (got.length === want.length && got.some((p, i) => p !== want[i])) {
      out.push(finding(
        "route-parameter-named-differently",
        d.name,
        "the record and the served route label the same position differently",
        { declared: d.route, observed: s.route, declaredParams: want, observedParams: got },
      ));
    }
  }

  // Competing families: several served routes plausibly implement ONE declared
  // screen. Both are carried; neither is chosen (ADR-MP-6's discipline).
  for (const d of declared) {
    const family = observed.filter((o) => mentions(norm(o.route), norm(d.name)));
    if (family.length > 1) {
      out.push(finding(
        "competing-route-families",
        d.name,
        `${family.length} served routes could implement this one declared screen — which is canonical is a human decision`,
        { candidates: family.map((o) => o.route) },
      ));
    }
  }
  return out;
}

/* ── objects ─────────────────────────────────────────────────── */

export function objectFindings(current, target) {
  const out = [];
  const declared = target.objects ?? [];
  const observed = current.objects ?? [];
  const declaredByNorm = new Map(declared.map((o) => [norm(o.name), o]));

  // What this observed group may be CALLED. The heading is what the page says
  // and the singular of it is the same claim in the ledger's number; a route
  // noun is NOT included here, because `.../workflows` is evidence that the
  // declared `workflow` is rendered somewhere on that page, never evidence
  // that THIS group is it. Admitting it here would let any unrecognised
  // structure on a well-named route suppress its own object-not-declared
  // finding — the gate would go quiet exactly where it should speak.
  const callable = (o) =>
    [norm(o.name), ...(o.heading_nouns ?? []).map(norm)].filter(Boolean);

  for (const o of observed) {
    if (o.named === false) continue;          // the name is what would be adjudicated
    const direct = callable(o).map((n) => declaredByNorm.get(n)).find(Boolean);
    // "Voyage worklist" plausibly renders the declared `voyage` — a hint, never
    // a verdict (audit D-10). A plausible match is left alone.
    const plausible =
      direct ?? declared.find((d) => callable(o).some((n) => mentions(n, norm(d.name))));
    if (!plausible) {
      out.push(finding(
        "object-not-declared", o.name,
        "this structure ships and the object map does not name it",
        { members: o.members, routes: o.routes, evidence: o.evidence },
      ));
      continue;
    }
    // Rank drift — invisible to every view that shows one side at a time.
    const declaredFields = plausible.card_fields ?? [];
    const observedFields = o.card_fields ?? [];
    if (declaredFields.length && observedFields.length &&
        declaredFields.length !== observedFields.length) {
      out.push(finding(
        "field-count-drift", plausible.name,
        `${declaredFields.length} card field(s) declared, ${observedFields.length} observed`,
        { declared: declaredFields, observed: observedFields, matchedVia: o.name },
      ));
    }
  }

  // Declared but never observed. Reported only when the context produced
  // observations at all — otherwise every row is the audit's own blind spot
  // wearing the costume of a finding (audit D-9).
  if (observed.length) {
    // Route nouns DO count here. This direction asks "is the declared object
    // rendered anywhere?", and a route named for it is exactly that evidence.
    // It is the asymmetry that fixes the naming bug without loosening the
    // finding above: the workflows page headed "Standard SDLC" stops
    // reporting `workflow` as never-observed.
    const observedNorms = observed.flatMap((o) => [
      ...callable(o),
      ...(o.route_nouns ?? []).map(norm),
    ]);
    for (const d of declared) {
      const seen = observedNorms.some((n) => n === norm(d.name) || mentions(n, norm(d.name)));
      if (!seen) {
        out.push(finding(
          "declared-not-observed", d.name,
          "declared, and no render evidences it — an object that only ever appears as a single detail has no repeat group to find, so this may be the extractor's blind spot rather than a gap",
          { card_fields: d.card_fields ?? [] },
        ));
      }
    }
  }
  return out;
}

/* ── the fold ────────────────────────────────────────────────── */

/** Pure and total. Stable order: (kind, subject, detail). */
export function diffModels(current, target) {
  if (!current || !target) return [];
  const context = current.context ?? target.context ?? null;
  return [...structuralFindings(current, target), ...objectFindings(current, target)]
    .map((f) => ({ ...f, context }))
    .sort((a, b) =>
      a.kind !== b.kind ? (a.kind < b.kind ? -1 : 1)
      : a.subject !== b.subject ? (String(a.subject) < String(b.subject) ? -1 : 1)
      : String(a.detail) < String(b.detail) ? -1 : 1,
    );
}
