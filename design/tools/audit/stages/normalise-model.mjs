/**
 * Normalise survey output into a CURRENT model (FR-MP-020, task-002).
 *
 * An eighth stage rather than a new pipeline (ADR-MP-2). Two consequences are
 * the point: it inherits the runner's provenance headers and resumability, and
 * it structurally cannot see the design record — this module imports nothing
 * from design/glossary, design/objects or design/screens, which is what
 * guarantees a current model carries nothing declared.
 *
 * The holes are the product. archetype, cardinality, zone, attribute class,
 * severity, surface and canonical verb are never emitted (MODEL_HOLES), because
 * each is an adjudication a human owes and a guess would have to be un-picked.
 */
import { provenanceHeader } from "../provenance.mjs";
import { basename } from "node:path";
import { writeSurvey, yamlList } from "../survey-io.mjs";
import { PROVENANCE, hole } from "../../model-schema.mjs";

/** `/queue@empty` -> `/queue`. A state is a state OF a screen, not a screen. */
const baseRoute = (r) => String(r ?? "").split("@")[0];
/** `/queue@empty` -> `empty`; a bare route is the loaded state. */
const stateOf = (r) => String(r ?? "").split("@")[1] ?? "loaded";

/**
 * Observed collections -> model objects.
 * Multi-route structures keep EVERY route: a list appearing under both a parent
 * route and its child is how master-detail is evidenced, not duplication.
 */
export function normaliseObjects(candidates = [], prov = {}) {
  return candidates
    .filter((c) => c && c.name)
    .map((c) => ({
      name: c.name,
      named: c.named !== false,
      // Alternative spellings, carried as evidence. The diff uses them to
      // recognise a declared object the heading spells differently; it never
      // replaces `name`, which is what the page actually says.
      heading_nouns: c.headingNouns ?? [],
      route_nouns: c.routeNouns ?? [],
      card_fields: String(c.cardFields ?? "").split(" | ").filter(Boolean),
      members: c.members ?? 0,
      representation: c.representation ?? null,
      routes: String(c.route ?? "").split(", ").map(baseRoute).filter(Boolean).sort(),
      // Never inferred (MODEL_HOLES).
      cardinality: hole("a rendered collection shows a count, never the rule"),
      zone: hole("shared/ui-only/domain-only is an adjudication"),
      attribute_class: hole("core vs metadata is a ranking judgement"),
      provenance: PROVENANCE.OBSERVED,
      tier: prov.tier ?? null,
      commit: prov.commit ?? null,
      captured_at: prov.captured ?? null,
      evidence: c.evidence ?? null,
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * Routes x states -> screens. STATES FOLD IN: 76 skeletons become 19 screens
 * with up to 4 states each. Treating them as separate screens is the defect
 * class FR-DA-045 shipped and CruisePaperwork exposed — 704 members where the
 * page shows 42.
 */
export function normaliseScreens(routes = [], skeletons = {}, prov = {}) {
  const byRoute = new Map();
  for (const r of routes) {
    const path = baseRoute(r.path ?? r);
    if (!path) continue;
    if (!byRoute.has(path)) {
      byRoute.set(path, {
        route: path,
        states: [],
        geometry: null,
        archetype: hole("inferring list/detail from geometry is the renderer deciding"),
        provenance: PROVENANCE.OBSERVED,
        tier: prov.tier ?? null,
        commit: prov.commit ?? null,
        captured_at: prov.captured ?? null,
        evidence: null,
      });
    }
    const screen = byRoute.get(path);
    const state = r.state ?? stateOf(r.path ?? r);
    if (!screen.states.includes(state)) screen.states.push(state);
  }
  // Geometry comes from the LOADED capture: an empty-state skeleton describes
  // the empty state, not the screen.
  //
  // Skeleton keys are DOTTED screen keys (`agent-framework.actions.slug`) and
  // routes are slashed paths (`/agent-framework/actions/:slug`). Matching one
  // against the other directly attached geometry to nothing — 49 screens, 0
  // regions — and the synthetic fixtures the folds were tested against used
  // the same format for both, so nothing caught it until a real sweep.
  const keyFor = (path) =>
    String(path ?? "")
      .replace(/^\//, "")
      .split("/")
      .map((seg) => seg.replace(/^:/, ""))
      .filter(Boolean)
      .join(".") || "root";
  for (const [path, screen] of byRoute) {
    const want = keyFor(path);
    const key = Object.keys(skeletons).find((k) => !k.includes("@") && k === want);
    if (key) {
      screen.geometry = skeletons[key];
      screen.evidence = key;
    }
    screen.states.sort();
  }
  return [...byRoute.values()].sort((a, b) => (a.route < b.route ? -1 : 1));
}

/**
 * Harvested controls -> model CTAs. Labels stay VERBATIM (ADR-DA-4 extended):
 * canonicalising "Received29" to a verb pre-empts an adjudication, and the
 * rendered string is also what the banned-synonym check needs.
 */
export function normaliseCtas(flows = {}, prov = {}) {
  const rows = flows.candidateCtas ?? [];
  return rows
    .filter((c) => c && c.label)
    .map((c) => ({
      label: c.label,
      screen: baseRoute(c.screen),
      element: c.element ?? null,
      occurrences: c.occurrences ?? 1,
      command: c.candidateCommand ?? null,
      confidence: c.confidence ?? 0,
      // Never inferred (MODEL_HOLES).
      canonical_verb: hole("mapping a label to a verb pre-empts adjudication"),
      severity: hole("recoverable vs irreversible is policy, not observation"),
      surface: hole("the surface comes from the decision table at design time"),
      provenance: PROVENANCE.OBSERVED,
      tier: prov.tier ?? null,
      commit: prov.commit ?? null,
      captured_at: prov.captured ?? null,
      evidence: c.screen ?? null,
    }))
    .sort((a, b) =>
      a.screen !== b.screen ? (a.screen < b.screen ? -1 : 1) : a.label < b.label ? -1 : 1,
    );
}

/** The whole fold. Pure — every input is an argument. */
export function currentModelFrom({ context, candidates, routes, skeletons, flows, prov }) {
  return {
    version: 1,
    context,
    provenance: PROVENANCE.OBSERVED,
    objects: normaliseObjects(candidates, prov),
    screens: normaliseScreens(routes, skeletons, prov),
    ctas: normaliseCtas(flows, prov),
  };
}

export async function run(ctx) {
  const prov = ctx.provenanceFor("audit/normalise-model");
  // The names the STAGES export, not the names this stage first guessed at.
  // It read ctx.routes, ctx.candidateObjects and ctx.observedFlows; the
  // runner exports routeRows, objects and candidateCtas. Every unit test
  // called the folds directly, so the stage produced an empty model named
  // "unknown" the first time it ran end to end — and said nothing, because
  // an empty model is a valid model.
  const context =
    ctx.context ?? basename(ctx.repoRoot ?? "") ?? "unknown";
  const model = currentModelFrom({
    context,
    candidates: ctx.objects ?? [],
    routes: ctx.routeRows ?? [],
    skeletons: ctx.skeletons ?? {},
    flows: { candidateCtas: ctx.candidateCtas ?? [] },
    prov,
  });
  if (!model.screens.length && !model.objects.length) {
    // An empty model is indistinguishable from a model of an empty app, and
    // only one of those is worth writing.
    return {
      artifacts: [],
      findings: [
        {
          kind: "model-empty",
          evidence: `routes=${(ctx.routeRows ?? []).length} objects=${(ctx.objects ?? []).length} skeletons=${Object.keys(ctx.skeletons ?? {}).length}`,
          suggests:
            "run capture and derive-objects first, or check that the app rendered content — an unauthenticated sweep captures shells",
        },
      ],
      exports: { currentModel: model },
    };
  }

  return {
    artifacts: [
      writeSurvey(
        ctx.repoRoot,
        `model/${context}.yaml`,
        [
          provenanceHeader(prov, [
            "A CURRENT MODEL — what ships, normalised from this survey. One",
            "schema with the target model; two instances (FR-MP-010). Machine",
            "written and NEVER approvable: no code path gives a row here an",
            "approval state (FR-MP-070).",
            "Holes are explicit and are the product: archetype, cardinality,",
            "zone, attribute class, severity and surface are adjudications a",
            "human owes, not gaps to fill in.",
          ]),
          "version: 1",
          `context: ${context}`,
          "provenance: observed",
          yamlList("objects", model.objects, { style: "block" }),
          yamlList("screens", model.screens, { style: "block" }),
          yamlList("ctas", model.ctas, { style: "block" }),
          "",
        ].join("\n"),
      ),
    ],
    exports: { currentModel: model },
  };
}
