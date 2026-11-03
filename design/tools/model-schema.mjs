/**
 * The design model schema — ONE shape, two instances (FR-MP-010, ADR-MP-1).
 *
 * Plain data. No class, no methods. A `Model` that knew how to load itself
 * would make MP-NFR-002's purity untestable: any method could reach for the
 * filesystem and the guarantee would rest on review rather than on the shape.
 *
 * Provenance is carried per ROW, not per file, because a file-level stamp
 * cannot describe a model that will eventually mix sources. `declared` rows
 * come from the ratified record; `observed` rows are measured and carry the
 * evidence a reviewer needs to check them.
 */

/** Fields a measurement can NEVER evidence. Frozen: a later pass that starts
 *  inferring one of these is asserting something the DOM cannot show. */
export const MODEL_HOLES = Object.freeze([
  "archetype",        // inferring list/detail from geometry is the renderer deciding
  "cardinality",      // a rendered collection shows count, never the rule
  "zone",             // shared/ui-only/domain-only is an adjudication
  "attribute_class",  // core vs metadata is a ranking judgement
  "severity",         // recoverable/irreversible is policy
  "surface",          // dialog/drawer/inline/page comes from the decision table
  "canonical_verb",   // mapping a label to a verb pre-empts adjudication
]);

/** Keys that mark approval. A current model carries none of them, ever. */
const APPROVAL_KEYS = Object.freeze([
  "approved", "approved_at", "approved_by",
  "ratified", "ratified_at", "ratified_by",
  "rejected", "rejected_at", "rejected_by",
]);

export const PROVENANCE = Object.freeze({
  DECLARED: "declared",   // from the ratified record
  OBSERVED: "observed",   // measured from the running application
});

/**
 * A field the source cannot evidence. NOT the same as measured-as-empty, and
 * the diff has to tell them apart: "not knowable from measurement" and "we
 * looked and there was nothing" are different claims.
 */
export function hole(reason) {
  if (!reason || typeof reason !== "string") {
    throw new TypeError("hole() needs a reason — an unexplained null is the thing this prevents");
  }
  return { value: null, hole: reason };
}

/** True for a hole produced by hole(). */
export function isHole(v) {
  return Boolean(v) && typeof v === "object" && v.hole !== undefined && v.value === null;
}

/** An empty model of the given provenance. */
export function emptyModel(context, provenance) {
  return { version: 1, context, provenance, objects: [], screens: [], ctas: [] };
}

/**
 * Returns problems as an array. Deliberately does NOT throw: a caller
 * validating a machine-written file wants the whole list, not the first defect.
 */
export function validateModel(model) {
  const problems = [];
  if (!model || typeof model !== "object") return ["model is not an object"];
  if (model.version !== 1) problems.push(`unknown version: ${model.version}`);
  if (!model.context) problems.push("model has no context");
  if (!Object.values(PROVENANCE).includes(model.provenance)) {
    problems.push(`provenance must be declared or observed, got ${model.provenance}`);
  }

  for (const part of ["objects", "screens", "ctas"]) {
    if (!Array.isArray(model[part])) {
      problems.push(`${part} must be an array`);
      continue;
    }
    for (const [i, row] of model[part].entries()) {
      const at = `${part}[${i}]`;
      if (!Object.values(PROVENANCE).includes(row.provenance)) {
        problems.push(`${at} has no row provenance`);
      }
      // FR-MP-070 — no code path by which a machine-written row acquires approval.
      for (const key of APPROVAL_KEYS) {
        if (key in row) problems.push(`${at} carries an approval key: ${key}`);
      }
      if (row.provenance === PROVENANCE.OBSERVED) {
        for (const key of ["tier", "commit", "captured_at", "evidence"]) {
          if (row[key] === undefined) problems.push(`${at} is observed but has no ${key}`);
        }
      }
    }
  }
  return problems;
}
