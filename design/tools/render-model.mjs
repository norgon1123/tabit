/**
 * One renderer over the model (FR-MP-040, task-005).
 *
 * The renderer NEVER decides; the model determines. Each rule below is a
 * consequence of what its input can evidence, not a preference:
 *
 *   archetype present          -> the archetype contract (today's path)
 *   archetype a hole, geometry -> measured geometry, SAME artboard shape
 *   neither                    -> an empty state naming the missing field
 *
 * PURE (MP-NFR-002, rule:design.model-renderer-pure). No fs, no path, no
 * ambient config: two callers must get identical output from identical
 * arguments, or comparing a current model against a target one is worthless.
 *
 * That purity forces a split the plan understated. renderHtml needs copy,
 * tokensCss, wireframe, approval and nav — presentation assets that live in
 * files and that projectTarget does not project. So the MODEL carries
 * structure and a RENDER CONTEXT carries assets. Passing them as arguments is
 * what keeps this function pure while still rendering a real mockup.
 */
import { isHole } from "./model-schema.mjs";

const known = (v) => v !== null && v !== undefined && !isHole(v);

/** Which branch a screen takes, and why. Exported because the diff and the
 *  Studio both need to explain a rendering, not just produce one. */
export function renderModeFor(screen) {
  if (!screen) return { mode: "missing", why: "no screen by that id in this model" };
  if (known(screen.archetype)) {
    return { mode: "archetype", why: `declared archetype: ${screen.archetype}` };
  }
  if (known(screen.geometry)) {
    return { mode: "geometry", why: "no declared archetype; rendering measured geometry" };
  }
  return {
    mode: "empty",
    // Name the missing field. A silent blank reads as "nothing to see".
    why: isHole(screen.archetype)
      ? `archetype is a hole: ${screen.archetype.hole}`
      : "neither an archetype nor measured geometry",
  };
}

/** Find a screen by the id each model kind uses: declared screens have names,
 *  observed screens have routes. */
export function screenIn(model, screenId) {
  return (model?.screens ?? []).find((s) => s.name === screenId || s.route === screenId) ?? null;
}

/**
 * Render measured geometry into the same artboard shape an archetype produces.
 *
 * Region rects are viewport FRACTIONS, so a skeleton stays comparable across
 * viewports — that is the skeleton file's own contract and this honours it
 * rather than re-deriving pixels.
 */
export function renderGeometry(screen, { width = 1440, height = 900 } = {}) {
  const g = screen.geometry ?? {};
  const regions = g.regions ?? [];
  const repeats = g.repeats ?? [];
  const pct = (n) => `${(Number(n) * 100).toFixed(4).replace(/\.?0+$/, "")}%`;

  const boxes = regions.map((r) => {
    const label = [r.tag, r.class].filter(Boolean).join(" ");
    return `    <div class="wp-region" style="left:${pct(r.atX)};top:${pct(r.atY)};` +
      `width:${pct(r.w)};height:${pct(r.h)}" data-wp-region="${label}"><span>${label}</span></div>`;
  });

  const repeatRows = repeats.map(
    (rp) => `    <li>${rp.class} &times;${rp.instances} — ${rp.rowHeight}&times;${rp.width}px</li>`,
  );

  return [
    `<section class="wp-artboard wp-artboard--measured" data-wp-screen="${screen.route ?? screen.name}"`,
    `         data-wp-provenance="observed" data-wp-viewport="${width}x${height}">`,
    `  <header class="wp-artboard__id">`,
    `    <span class="wp-route">${screen.route ?? screen.name}</span>`,
    `    <span class="wp-states">${(screen.states ?? []).join(" · ") || "loaded"}</span>`,
    `  </header>`,
    `  <div class="wp-surface" role="img" aria-label="measured layout, ${regions.length} regions">`,
    ...boxes,
    `  </div>`,
    repeatRows.length ? `  <ul class="wp-repeats">\n${repeatRows.join("\n")}\n  </ul>` : "",
    `</section>`,
  ].filter(Boolean).join("\n");
}

/** The empty state. Names the missing field — a blank region is a review failure. */
export function renderEmpty(screenId, why) {
  return [
    `<section class="wp-artboard wp-artboard--empty" data-wp-screen="${screenId}">`,
    `  <h2>Nothing to render for ${screenId}</h2>`,
    `  <p>${why}</p>`,
    `</section>`,
  ].join("\n");
}

/**
 * Render one screen of either model.
 *
 * `renderArchetype` is injected rather than imported so this module stays free
 * of render-mockup.mjs's file reads. buildMockup supplies the real one; a test
 * can supply a stub and still exercise the dispatch.
 */
export function renderModel(model, screenId, ctx = {}) {
  const screen = screenIn(model, screenId);
  const { mode, why } = renderModeFor(screen);

  if (mode === "archetype") {
    if (typeof ctx.renderArchetype !== "function") {
      return { mode, why, html: renderEmpty(screenId, "no archetype renderer was provided") };
    }
    return { mode, why, html: ctx.renderArchetype(screen, model, ctx) };
  }
  if (mode === "geometry") {
    return { mode, why, html: renderGeometry(screen, ctx.viewport) };
  }
  return { mode, why, html: renderEmpty(screenId, why) };
}
