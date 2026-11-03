/**
 * A review sheet: every mockup in one context, on one page.
 *
 * The mockup gate asks a human to approve each screen, and a context that
 * ratified 31 flow slices produces 23 screens at once. Twenty-three links is
 * not a review — it is an afternoon of tab management, and the predictable
 * outcome is approval by fatigue, which is the exact failure the gate exists
 * to prevent (a stamp nobody really looked at).
 *
 * So: one page, grouped by archetype, because sibling screens of the same
 * shape are meant to behave identically (heuristic review item 4) and that
 * is only checkable when they are side by side.
 *
 * This AUTHORS NOTHING. Each panel is the generated mockup verbatim, isolated
 * in an iframe so twenty-three stylesheets cannot bleed into each other. If a
 * screen looks wrong here it looks wrong in the artifact too.
 *
 * Usage: node render-review-sheet.mjs <context>
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { parseScreen } from "./parsers.mjs";

const DESIGN = "design";

/** Order archetypes so a reviewer meets the same shape consecutively. */
const ARCHETYPE_ORDER = ["dashboard", "list", "detail", "form", "wizard"];

export function collectScreens(context, { designDir = DESIGN } = {}) {
  const screensDir = join(designDir, "screens");
  const rows = [];
  for (const file of readdirSync(screensDir).sort()) {
    if (!file.startsWith(`${context}.`) || !file.endsWith(".yaml")) continue;
    const src = readFileSync(join(screensDir, file), "utf8");
    const meta = parseScreen(src);
    const base = file.replace(/\.yaml$/, "");
    const mockupPath = join(designDir, "mockups", `${base}.html`);
    let html = null;
    try {
      html = readFileSync(mockupPath, "utf8");
    } catch {
      // A screen with no render is reported, not skipped: an absent panel in
      // a review sheet reads as "nothing to see", which is a lie.
    }
    rows.push({
      screen: meta.screen ?? base,
      archetype: meta.archetype ?? "unknown",
      approved: Boolean(meta.mockup?.content_hash),
      html,
      ctas: html ? (html.match(/data-wp-cta/g) ?? []).length : 0,
      fields: html ? (html.match(/data-wp-field/g) ?? []).length : 0,
    });
  }
  return rows.sort(
    (a, b) =>
      (ARCHETYPE_ORDER.indexOf(a.archetype) + 1 || 99) -
        (ARCHETYPE_ORDER.indexOf(b.archetype) + 1 || 99) ||
      a.screen.localeCompare(b.screen),
  );
}

const escapeAttr = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;");

export function renderReviewSheet(context, rows) {
  const pending = rows.filter((r) => !r.approved).length;
  const byArchetype = new Map();
  for (const r of rows) {
    const list = byArchetype.get(r.archetype) ?? [];
    list.push(r);
    byArchetype.set(r.archetype, list);
  }

  const sections = [...byArchetype.entries()]
    .map(([archetype, group]) => {
      const panels = group
        .map((r) => {
          const body = r.html
            ? `<iframe title="${escapeAttr(r.screen)}" srcdoc="${escapeAttr(r.html)}"></iframe>`
            : `<p class="missing">No mockup rendered for this screen.</p>`;
          return `<section class="panel">
  <header>
    <h3>${r.screen}</h3>
    <span class="meta">${r.archetype} · ${r.ctas} annotated CTA${r.ctas === 1 ? "" : "s"} · ${r.fields} field${r.fields === 1 ? "" : "s"}</span>
    <span class="state ${r.approved ? "ok" : "pending"}">${r.approved ? "approved" : "awaiting approval"}</span>
  </header>
  ${body}
</section>`;
        })
        .join("\n");
      return `<h2>${archetype} <span class="count">${group.length}</span></h2>\n${panels}`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${context} — mockup review sheet</title>
<style>
  :root { color-scheme: light dark; --ink:#1a1a1a; --muted:#666; --line:#e2e2e2; --bg:#fafafa; --ok:#2D6A4F; --pending:#9C6B1E; }
  @media (prefers-color-scheme: dark) { :root { --ink:#eee; --muted:#9a9a9a; --line:#333; --bg:#161616; } }
  body { margin:0; padding:28px; background:var(--bg); color:var(--ink);
         font:14px/1.5 ui-sans-serif, system-ui, sans-serif; }
  h1 { font-size:20px; margin:0 0 4px; }
  .lede { color:var(--muted); max-width:62ch; margin:0 0 24px; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.08em;
       color:var(--muted); margin:32px 0 12px; border-bottom:1px solid var(--line); padding-bottom:6px; }
  h2 .count { color:var(--ink); font-weight:400; }
  .panel { border:1px solid var(--line); border-radius:8px; overflow:hidden; margin-bottom:20px; background:canvas; }
  .panel header { display:flex; gap:12px; align-items:baseline; flex-wrap:wrap;
                  padding:10px 14px; border-bottom:1px solid var(--line); }
  .panel h3 { font-size:14px; margin:0; font-family:ui-monospace, monospace; }
  .meta { color:var(--muted); font-size:12px; }
  .state { margin-left:auto; font-size:11px; text-transform:uppercase; letter-spacing:.06em; }
  .state.ok { color:var(--ok); } .state.pending { color:var(--pending); }
  iframe { width:100%; height:560px; border:0; display:block; background:#fff; }
  .missing { padding:24px; color:var(--pending); margin:0; }
</style></head>
<body>
  <h1>${context} — mockup review</h1>
  <p class="lede">${rows.length} screens, ${pending} awaiting approval. Each panel is the
  generated mockup exactly as it renders in its own artifact; nothing here is
  hand-drawn. Grouped by archetype, because sibling screens of the same shape
  are meant to behave identically and that is only checkable side by side.</p>
  ${sections}
</body></html>
`;
}

const [context] = process.argv.slice(2);
if (!context) {
  console.error("usage: render-review-sheet.mjs <context>");
  process.exit(1);
}
const rows = collectScreens(context);
if (rows.length === 0) {
  console.error(`no screens found for context ${context}`);
  process.exit(1);
}
mkdirSync(join(DESIGN, "mockups"), { recursive: true });
const out = join(DESIGN, "mockups", `${context}.review-sheet.html`);
writeFileSync(out, renderReviewSheet(context, rows));
console.log(
  `review sheet: ${out} (${rows.length} screens, ${rows.filter((r) => !r.approved).length} awaiting approval)`,
);
