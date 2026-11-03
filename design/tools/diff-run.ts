/**
 * The diff's calling stage (task-006 step 4, FR-MP-050, D-3).
 *
 * `diffModels` is pure and writes nothing — that is what lets the same fold
 * serve the CLI, a test and eventually the Studio. Something still has to read
 * two models and write the result, and task-006 put that HERE rather than in
 * the fold. Until this file existed there was no caller at all: `design/diff/`
 * was in the sync classifier and in the DesignArtifactKind enum, and nothing
 * ever produced a file for either to recognise.
 *
 * TypeScript, not .mjs, because `projectTarget` is TypeScript and duplicating
 * a projection in a second language is exactly the drift the model pair
 * exists to prevent.
 *
 * Usage:
 *   npx tsx scripts/design-tools/diff-run.ts              every ratified context
 *   npx tsx scripts/design-tools/diff-run.ts studio        one context
 *   npx tsx scripts/design-tools/diff-run.ts --check       write nothing; exit 1 on findings
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";

import { projectTarget } from "@/server/interactors/design/project-target";
// The pure fold ships as .mjs so the seeded tool and the app import the same
// file rather than two builds of it.
import { diffModels } from "./diff-models.mjs";

const ROOT = process.cwd();
const OBJECTS_DIR = join(ROOT, "design", "objects");
const SCREENS_DIR = join(ROOT, "design", "screens");
const FLOWS_DIR = join(ROOT, "design", "flows");
const DIFF_DIR = join(ROOT, "design", "diff");
const COVERAGE = join(ROOT, "design", "coverage.yaml");

type Row = Record<string, unknown>;

const read = (p: string) => YAML.parse(readFileSync(p, "utf8")) as Row;
const listing = (dir: string) =>
  existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".yaml")) : [];

/**
 * The current model is REPO-scoped, not context-scoped: the audit writes one
 * `model/{repo}.yaml` covering every route the sweep reached. Scoping it to a
 * context is an inference, so it is stated here rather than buried — the first
 * path segment is taken to name the context.
 *
 * THE MODEL SPELLS A ROUTE TWO WAYS, and reading only one silently drops the
 * other. Screens carry a URL PATH (`/agent-framework/actions`); objects carry
 * a dotted KEY (`agent-framework.actions`); a CTA carries neither and names
 * its `screen`. Matching only the dotted form scoped 0 of 49 screens into
 * every context while the object counts looked right — a diff that reported
 * "23 declared screens, none observed" against a sweep that had photographed
 * all of them.
 */
export function contextOfRoute(route: unknown): string | null {
  const raw = String(route ?? "").trim();
  if (!raw) return null;
  // `/agent-framework/actions` and `agent-framework.actions` and the bare
  // `agent-framework` a CTA's `screen` carries all reduce to one head.
  const head = raw.replace(/^\//, "").split(/[./]/).filter(Boolean)[0];
  return head ?? null;
}

export function scopeCurrentTo(context: string, full: Row | null): Row | null {
  if (!full) return null;
  const inCtx = (route: unknown) =>
    String(route ?? "")
      .split(",")
      .some((r) => contextOfRoute(r) === context);
  const anyInCtx = (routes: unknown) =>
    Array.isArray(routes) ? routes.some(inCtx) : inCtx(routes);
  return {
    ...full,
    context,
    screens: ((full.screens as Row[]) ?? []).filter((s) => inCtx(s.route)),
    objects: ((full.objects as Row[]) ?? []).filter((o) => anyInCtx(o.routes ?? o.route)),
    ctas: ((full.ctas as Row[]) ?? []).filter((c) => inCtx(c.screen ?? c.route)),
  };
}

/** The repo's current model, whichever repo the audit ran against. */
export function loadCurrent(): Row | null {
  const dir = join(ROOT, "design", "survey", "model");
  const files = listing(dir);
  return files.length ? read(join(dir, files[0])) : null;
}

/** Screens and CTAs the record declares for one context. */
export function loadDeclared(context: string) {
  // A dialog and a section are NOT served at a URL, and a screen contract says
  // so in its `route.relation`. Reading only `route.path` made their absent
  // path look like a gap in the record, so the diff reported studio's gallery,
  // publish-dialog and delete-confirm as `declared-screen-unrouted` — three of
  // its fourteen findings, every one of them noise. There is no route to add:
  // the gallery is a SECTION of the atlas by design.
  //
  // They are dropped from the route comparison rather than carried with a
  // hole, because every question that comparison asks — is this served, does
  // a route family compete for it, does a shipped route declare it — is a
  // question about a URL, and these have none to answer with.
  const NON_ROUTABLE = new Set(["dialog", "section", "drawer", "inline"]);
  const declaredScreens = listing(SCREENS_DIR)
    .filter((f) => f.startsWith(`${context}.`))
    .map((f) => read(join(SCREENS_DIR, f)));

  const screens = declaredScreens
    .filter((d) => {
      const route = (d.route as Row) ?? {};
      return route.path !== undefined || !NON_ROUTABLE.has(String(route.relation ?? ""));
    })
    .map((d) => ({
      screen: String(d.screen ?? ""),
      archetype: (d.archetype as string) ?? null,
      route: ((d.route as Row)?.path as string) ?? null,
    }));

  const surfaces = declaredScreens.length - screens.length;

  const ctas = listing(FLOWS_DIR)
    .filter((f) => f.startsWith(`${context}.`))
    .map((f) => read(join(FLOWS_DIR, f)))
    .flatMap((d) => {
      // Slice schema v1 carries ONE cta per file; v2 may carry a list. Both
      // shapes are read, because migrating every slice to prove this runner
      // works would be a change the runner does not need.
      const rows = Array.isArray(d.ctas) ? (d.ctas as Row[]) : d.cta ? [d] : [];
      return rows.map((c) => ({
        object: String(c.object ?? ""),
        verb: String(c.cta ?? c.verb ?? c.canonical_verb ?? ""),
        command: (c.command as string) ?? null,
        severity: (c.severity as string) ?? null,
        surface: (c.surface as string) ?? null,
        why: (c.why as string) ?? null,
      }));
    });

  return { screens, ctas, surfaces };
}

/** Contexts with an object map — the only ones a target can be projected from. */
export function ratifiedContexts(): string[] {
  return listing(OBJECTS_DIR)
    .map((f) => f.replace(/\.yaml$/, ""))
    .filter((c) => !c.startsWith("_"))
    .sort();
}

function stamps(context: string) {
  if (!existsSync(COVERAGE)) return { by: null, at: null };
  const cov = read(COVERAGE) as Row;
  const ctxs = (cov.contexts as Row) ?? cov;
  const entry = (ctxs?.[context] as Row) ?? {};
  return {
    by: (entry.ratified_by as string) ?? null,
    at: entry.ratified_at ? String(entry.ratified_at) : null,
  };
}

export function diffForContext(context: string, current: Row | null) {
  const objectMap = read(join(OBJECTS_DIR, `${context}.yaml`));
  const { screens, ctas, surfaces } = loadDeclared(context);
  const { by, at } = stamps(context);
  const target = projectTarget({
    context,
    objectMap: objectMap as never,
    screens: screens as never,
    ctas: ctas as never,
    ratifiedBy: by,
    ratifiedAt: at,
  });
  const scoped = scopeCurrentTo(context, current);
  // No observation at all is NOT an empty diff — it is an unrun audit, and
  // reporting every declared object as missing would dress the extractor's
  // absence as a finding (audit D-9). diffModels already declines that, and
  // recording `observed: false` is how a reader tells the two apart.
  const findings = scoped ? diffModels(scoped, target) : [];
  return { target, scoped, findings, surfaces };
}

function render(context: string, target: Row, scoped: Row | null, findings: Row[]) {
  const doc = {
    version: 1,
    context,
    // The provenance PAIR, without which a finding cannot be interpreted:
    // a gap between a stale observation and a fresh record is a different
    // fact from a gap between two current ones.
    provenance: {
      current: scoped
        ? { provenance: scoped.provenance ?? "observed", commit: scoped.commit ?? null }
        : null,
      target: {
        provenance: "declared",
        ratified_by: (target as Row).ratified_by ?? null,
        ratified_at: (target as Row).ratified_at ?? null,
      },
      observed: Boolean(scoped),
    },
    counts: {
      findings: findings.length,
      declared_objects: ((target.objects as Row[]) ?? []).length,
      observed_objects: ((scoped?.objects as Row[]) ?? []).length,
      declared_screens: ((target.screens as Row[]) ?? []).length,
      observed_screens: ((scoped?.screens as Row[]) ?? []).length,
    },
    findings,
  };
  return `${YAML.stringify(doc, { lineWidth: 0 })}`;
}

export function main(argv = process.argv.slice(2)) {
  const check = argv.includes("--check");
  const named = argv.filter((a) => !a.startsWith("--"));
  const contexts = named.length ? named : ratifiedContexts();
  const current = loadCurrent();

  if (!current) {
    console.log("no current model under design/survey/model — run the audit first");
  }
  if (!check) mkdirSync(DIFF_DIR, { recursive: true });

  let total = 0;
  for (const context of contexts) {
    if (!existsSync(join(OBJECTS_DIR, `${context}.yaml`))) {
      console.log(`  ${context.padEnd(18)} no object map — skipped`);
      continue;
    }
    const { target, scoped, findings, surfaces } = diffForContext(context, current);
    total += findings.length;
    const body = render(context, target as never, scoped, findings);
    if (!check) writeFileSync(join(DIFF_DIR, `${context}.yaml`), body);
    // No silent caps: a surface excluded from the route comparison is said
    // out loud, because "7 screens declared" and "4 of them have URLs" are
    // different claims and a reader is owed both.
    const dropped = surfaces ? `  (+${surfaces} non-routable surface(s))` : "";
    const note = (scoped ? "" : "  (no observation — declared-only)") + dropped;
    console.log(`  ${context.padEnd(18)} ${String(findings.length).padStart(3)} finding(s)${note}`);
  }

  console.log("");
  console.log(
    check
      ? `${total} finding(s) — nothing written (--check)`
      : `${total} finding(s) across ${contexts.length} context(s) → design/diff/`,
  );
  // A diff is a REPORT, not a gate. Findings name a choice and stop, so a
  // non-zero count is information, never a build failure — except under
  // --check, which exists for a caller that wants the opposite.
  return check && total > 0 ? 1 : 0;
}

const isMain =
  process.argv[1] !== undefined && process.argv[1].endsWith("diff-run.ts");
if (isMain) process.exit(main());
