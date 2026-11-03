/**
 * build-board — the flow board's data file (design-preflight T10).
 *
 * DERIVED, never authored. Regenerates from the screen contracts, the slices
 * that reference them, and the object map's navigation. Conforms to
 * design/diagrams/schemas/board.schema.json.
 *
 * Every edge names the recorded source it came from. There are exactly three,
 * and an edge that cannot name one is not drawn — the board shows what the
 * artifacts say, not what a layout engine guesses:
 *
 *   cta         consecutive screens inside one slice. A slice models
 *               screen → command → event → read model → screen, so its own
 *               ordering IS the transition.
 *   navigation  the object map's navigation.reachability, mapped from objects
 *               to the screens that carry them.
 *   machine     a statechart transition between screens. Studio's machines
 *               model states WITHIN a screen (loading/full/error), so none are
 *               emitted here; the source is supported for contexts whose
 *               machines cross screens.
 *
 * Usage: node design/tools/build-board.mjs <context>
 */

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  boardEdges,
  parseReachability,
  parseScreen,
  parseSlice,
  parseSliceScreens,
} from "./parsers.mjs";

// Re-exported: reachability used to be parsed HERE, which quietly made this a
// second parser (AD-2). It now lives in parsers.mjs with the rest; the name
// stays on this module's surface so existing callers are unaffected.
export { parseReachability };

const DESIGN_DIR = process.env.GATE_DESIGN_DIR ?? "design";

/** Screens of a context, in filename order — that order is the layout. */
export function loadScreens(designDir, context) {
  const dir = join(designDir, "screens");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith(`${context}.`) && f.endsWith(".yaml"))
    .sort()
    .map((f) => {
      const meta = parseScreen(readFileSync(join(dir, f), "utf8"));
      return {
        id: meta.screen,
        label: meta.screen,
        ...(meta.archetype ? { archetype: meta.archetype } : {}),
        state: meta.mockup?.state ?? "proposed",
        ...(meta.mockup?.artifact ? { mockup: meta.mockup.artifact } : {}),
      };
    })
    .filter((n) => n.id);
}

/** Slices of a context with their screen references and CTA verb. */
export function loadSlices(designDir, context) {
  const dir = join(designDir, "flows");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith(`${context}.`) && f.endsWith(".yaml"))
    .sort()
    .map((f) => {
      const src = readFileSync(join(dir, f), "utf8");
      // cta and object come from parseSlice — this used to run its own two
      // regexes over the same bytes, which is a parser by any other name.
      const { object, cta } = parseSlice(src);
      return { file: f, cta, object, screens: parseSliceScreens(src) };
    });
}

/** Board data for one context. Pure given the file contents. */
export function buildBoard(designDir, context) {
  const nodes = loadScreens(designDir, context);
  const slices = loadSlices(designDir, context);
  const objectsPath = join(designDir, "objects", `${context}.yaml`);
  const reachability = existsSync(objectsPath)
    ? parseReachability(readFileSync(objectsPath, "utf8"))
    : [];
  // Edge derivation lives in parsers.mjs so the Atlas read model and this
  // file cannot disagree about what the board shows (T14).
  const edges = boardEdges(nodes, slices, reachability);
  const blocked = nodes.filter((n) => n.state !== "approved").map((n) => n.id);
  return {
    title: `${context} — flow board`,
    context,
    nodes: nodes.map((n, i) => ({ ...n, rank: i })),
    edges,
    readiness: {
      consumable: blocked.length === 0,
      ...(blocked.length > 0 ? { blocked_by: blocked } : {}),
    },
  };
}

function main() {
  const [context] = process.argv.slice(2);
  if (!context) {
    console.error("usage: node design/tools/build-board.mjs <context>");
    return 2;
  }
  const board = buildBoard(DESIGN_DIR, context);
  if (board.nodes.length === 0) {
    console.error(`no screens for context '${context}' — run /waypoint.design-flow first`);
    return 1;
  }
  const outDir = join(DESIGN_DIR, "diagrams", "board");
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, `${context}.yaml`);
  writeFileSync(out, `${JSON.stringify(board, null, 2)}\n`);
  const r = board.readiness;
  console.log(
    `board written: ${out} — ${board.nodes.length} screens, ${board.edges.length} edges, ` +
      (r.consumable ? "consumable" : `blocked by ${r.blocked_by.join(", ")}`),
  );
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
