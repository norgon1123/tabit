/**
 * render-mockup — the pre-code picture of a screen (design-preflight C5).
 *
 * Renders design/mockups/{context}.{screen}.html from the artifacts that
 * already specify the screen: the screen contract (archetype, wireframe,
 * copy), every slice whose CTA lands on it (commands, severity, surface,
 * field lineage), the seam ledger (vocabulary), the object map (ranked
 * card_fields), and the built tokens.
 *
 * Three rules it exists to keep:
 *   - ZERO LOGIC. No script tag. The annotation overlay is CSS attribute
 *     selectors over the same data-wp-* attributes the gate reads, so the
 *     visible and machine-readable forms cannot disagree (DP-FR-003).
 *   - DERIVED BINDINGS. Every data-wp-* value is read from an artifact. A
 *     binding the artifacts do not contain fails review (DP-FR-002).
 *   - SYNTHETIC FIXTURES. Sample values are generated from read-model SHAPES,
 *     never a live database. A mockup is committed and publishable, so real
 *     data in one is permanent (DP-NFR-003).
 *
 * Usage: node design/tools/render-mockup.mjs <context> <screen>
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseCtas, parseObjectMap, parseReachability, parseScreen, parseScreenCopy, parseScreenRoutes, parseSliceScreens } from "./parsers.mjs";
import { renderModel } from "./render-model.mjs";

const DESIGN_DIR = process.env.GATE_DESIGN_DIR ?? "design";

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Slices referencing this screen, sorted by filename — the AD-4 derivation. */
export function contributingSlices(designDir, context, screen) {
  const dir = join(designDir, "flows");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith(`${context}.`) && f.endsWith(".yaml"))
    .sort()
    .map((f) => ({ file: f, src: readFileSync(join(dir, f), "utf8") }))
    .filter(({ src }) => parseSliceScreens(src).includes(screen));
}

/** Field lineage a slice records for one screen: [{field, reads_from}]. */
export function sliceFieldsFor(src, screen) {
  const fields = [];
  let inScreens = false;
  let current = null;
  let pending = null;
  for (const raw of src.split("\n")) {
    const line = raw.replace(/#.*$/, "").trimEnd();
    if (!line.trim()) continue;
    if (/^\S/.test(line)) {
      inScreens = /^screens:/.test(line);
      current = null;
      pending = null;
      continue;
    }
    if (!inScreens) continue;
    const t = line.trim();

    const head = t.match(/^-\s+screen:\s*([\w-]+)/);
    if (head) {
      current = head[1];
      pending = null;
      continue;
    }
    if (current !== screen) continue;

    // Inline form: `- { field: x, reads_from: y }`
    const inline = t.match(/^-\s*\{\s*field:\s*([^,}]+?)\s*,\s*reads_from:\s*([^}]+?)\s*\}$/);
    if (inline) {
      fields.push({ field: inline[1].trim(), reads_from: inline[2].trim() });
      pending = null;
      continue;
    }
    // Block form: `- field: x` then `  reads_from: y` on the following line.
    const head2 = t.match(/^-\s*(?:\{\s*)?field:\s*(.+?)\s*\}?$/);
    if (head2) {
      pending = { field: head2[1].trim(), reads_from: null };
      fields.push(pending);
      continue;
    }
    const rf = t.match(/^reads_from:\s*(\S+)/);
    if (rf && pending) {
      pending.reads_from = rf[1];
      pending = null;
    }
  }
  return fields;
}

/** Tokens as CSS custom properties; aliases ({a.b.c}) resolve to primitives. */
export function tokensToCss(tokensJson) {
  const flat = {};
  const walk = (obj, prefix = "") => {
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith("$")) continue;
      if (v && typeof v === "object") {
        if ("$value" in v) flat[`${prefix}${k}`] = String(v.$value);
        else walk(v, `${prefix}${k}-`);
      }
    }
  };
  walk(tokensJson);
  const resolve = (val, depth = 0) => {
    const m = /^\{(.+)\}$/.exec(val);
    if (!m || depth > 8) return val;
    return resolve(flat[m[1].replace(/\./g, "-")] ?? val, depth + 1);
  };
  return Object.entries(flat)
    .map(([k, v]) => `    --${k}: ${resolve(v)};`)
    .sort()
    .join("\n");
}

/** Sentence-case label from a canonical verb + ledger noun, per the doctrine. */
/** Canonical verb + ledger noun, sentence case, 1-3 words. */
export function ctaLabel(verb, object) {
  // `write-off` is one ledger verb; its label is two words. Dropping this
  // turned "Write off variance" into "Write-off variance".
  const v = String(verb ?? "").trim().replace(/-/g, " ");
  const o = String(object ?? "").trim();
  return `${v.charAt(0).toUpperCase()}${v.slice(1)} ${o}`.trim();
}

/**
 * Plausible sample values.
 *
 * Still synthetic — a committed mockup must never carry real data (DP-NFR-003)
 * — but shaped like the attribute it fills, and varied per row. "Sample value
 * 1" in every cell is what made the last set read as a schematic rather than a
 * page: a reviewer cannot judge column widths, wrapping or alignment against
 * placeholder text that is all the same length.
 */
const WORDS = ["Analyst", "Architect", "Reviewer", "Planner", "Scaffold", "Publisher", "Auditor", "Curator"];
const PHRASES = [
  "Runs before implementation and records what it found",
  "Reusable across projects; overridden per organisation",
  "Generated at init and refreshed on every bundle pull",
  "Read far more often than written",
];
const SCOPES = ["system", "org", "project"];
const DATES = ["12 Mar 2026", "04 Feb 2026", "28 Jan 2026", "19 Dec 2025"];

export function fixtureFor(field, i = 0, object = "") {
  const n = String(field).toLowerCase();
  const pick = (arr) => arr[i % arr.length];
  if (/(^|[-_ ])(date|at)$/.test(n) || n.includes("published") || n.includes("updated") || n.includes("created")) {
    return pick(DATES);
  }
  if (n.includes("scope") || n.includes("tier") || n.includes("visibility")) return pick(SCOPES);
  if (n.includes("enabled") || n.includes("active") || n.includes("published?")) return i % 3 === 2 ? "Disabled" : "Enabled";
  // Base stays 24 — the recorded contract — and varies from there so rows differ.
  if (n.includes("count") || n.includes("size") || n.includes("order")) return String(24 + i * 7);
  if (n.includes("type") || n.includes("kind") || n.includes("archetype")) return pick(["Document", "Diagram", "Report", "Template"]);
  if (n.includes("description") || n.includes("definition") || n.includes("note")) return pick(PHRASES);
  if (n.includes("content") || n.includes("rendered")) return "";
  if (n.includes("choice")) return pick(["3 choices", "5 choices", "2 choices"]);
  if (n.includes("name") || n.includes("title") || n.includes("slug")) {
    const base = pick(WORDS);
    return object && !base.toLowerCase().includes(object.toLowerCase()) ? `${base}` : base;
  }
  return pick(["Reviewed", "Pending", "Ready", "Draft"]);
}

const sevTone = (s) => (s === "irreversible" || s === "irreversible-high-value" ? "danger" : "");

/**
 * Buttons. Budget-aware: exactly one primary per view, the rest secondary,
 * destructive severities get the critical treatment from the token set.
 */
/**
 * A CTA's roles, rendered.
 *
 * `roles:` sat on every CTA row and reached no surface, so nobody could see
 * that a control was gated — which is how 39 of 59 role references came to
 * name roles that do not exist. An access claim nothing displays is an access
 * claim nobody checks.
 *
 * The default role is omitted deliberately: annotating every control with
 * "developer" would bury the four that are actually restricted.
 */
const DEFAULT_ROLE = "developer";

/**
 * `roles` arrives as an ARRAY from a YAML reader and as the STRING "[member]"
 * from parseCtas, which is regex-based and keeps flow lists verbatim. Both are
 * real inputs, so both are normalised here rather than at each call site —
 * assuming the array shape is what broke every mockup the first time.
 */
export function gatingRoles(cta) {
  const raw = cta?.roles;
  const list = Array.isArray(raw)
    ? raw
    : String(raw ?? "")
        .replace(/^\[|\]$/g, "")
        .split(",");
  const roles = list
    .map((r) => String(r).trim().replace(/^["']|["']$/g, ""))
    .filter((r) => r && r !== DEFAULT_ROLE);
  return roles.length ? roles : null;
}

function roleAttrs(cta) {
  const roles = gatingRoles(cta);
  return roles ? ` data-wp-roles="${esc(roles.join(" "))}"` : "";
}

function roleNote(cta) {
  const roles = gatingRoles(cta);
  return roles ? ` · ${esc(roles.join(", "))} only` : "";
}

export function renderCtas(ctas, sids = {}, { primaryIndex = 0 } = {}) {
  const sidFor = (name) => sids[name] ?? null;
  return ctas
    .map((c, i) => {
      const kind = sevTone(c.severity) || (i === primaryIndex ? "primary" : "secondary");
      const lead = c.verb === "create" && kind === "primary" ? icon("plus") : "";
      return `      <button type="button" class="btn btn--${kind}"
        data-wp-object="${esc(sidFor(c.object) ?? c.object)}"
        data-wp-cta="${esc(c.verb)}"
        data-wp-command="${esc(c.command ?? "")}"
        data-wp-severity="${esc(c.severity ?? "")}"
        data-wp-surface="${esc(c.surface ?? "")}"${roleAttrs(c)}${c.toast ? ` data-wp-toast="${esc(c.toast)}"` : ""}>${lead}${esc(ctaLabel(c.verb, c.object))}<span class="annot-note">${esc(c.verb)} · ${esc(c.severity ?? "")} · ${esc(c.surface ?? "")}${roleNote(c)}<br>${esc(c.command ?? "")}${c.toast ? `<br>toast: ${esc(c.toast)}` : ""}</span></button>`;
    })
    .join("\n");
}

/**
 * A list's column headers, from the SAME source as its cells — the object
 * map's ranked card_fields. Headers used to come from the contributing slices
 * while cells came from card_fields, so three slices landing on one screen
 * produced three identical headers above four columns of data.
 */
export function headerCells(cols, cardFields = []) {
  const names = cardFields?.length ? cardFields : cols.map((f) => f.field.split(" ")[0]);
  return names.map((n) => `<th>${esc(n)}</th>`).join("");
}

const titleCase = (s) => String(s).replace(/[-_]/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());

/**
 * A rail entry reads as the collection it opens: `action-library` is
 * "Actions", not "Action Library". Screens that are not libraries keep their
 * own name, because pluralising `bundle-preview` would invent a plural the
 * ledger does not have.
 */
/**
 * Icons, inline.
 *
 * The product draws lucide line icons; the previous placeholder was a bordered
 * square, which reads as an unchecked checkbox and turned every rail entry and
 * toolbar control into something that looks selectable. Inline SVG keeps the
 * mockup self-contained (DP-NFR-002: no external reference, no script) while
 * showing the affordance the page actually has.
 */
const ICON_PATHS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/>',
  book: '<path d="M3 4.5A1.5 1.5 0 0 1 4.5 3H10v18H4.5A1.5 1.5 0 0 1 3 19.5z"/><path d="M21 4.5A1.5 1.5 0 0 0 19.5 3H14v18h5.5a1.5 1.5 0 0 0 1.5-1.5z"/>',
  building: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
  bot: '<rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 8V4M9 13h.01M15 13h.01M9 17h6"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  branch: '<circle cx="6" cy="5" r="2.5"/><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="12" r="2.5"/><path d="M6 7.5v9M8.5 19h4a3 3 0 0 0 3-3v-1.5"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  shield: '<path d="M12 3 5 6v6c0 4 3 7.5 7 9 4-1.5 7-5 7-9V6z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>',
  eye: '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.5"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  gauge: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="m12 14 4-4"/>',
};

export function icon(name) {
  const d = ICON_PATHS[name] ?? ICON_PATHS.layers;
  return `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}

/**
 * Which icon a rail entry gets.
 *
 * Keyed off the ledger noun in the label, so the rail cannot show an icon for
 * a collection that is not there. Unmatched entries fall through to a neutral
 * mark rather than borrowing a meaning they do not have.
 */
export function navIcon(label) {
  const l = String(label).toLowerCase();
  if (/overview|dashboard/.test(l)) return "gauge";
  if (/agent|persona/.test(l)) return "bot";
  if (/action|command/.test(l)) return "zap";
  if (/workflow|flow/.test(l)) return "branch";
  if (/template|document/.test(l)) return "file";
  if (/architecture|standard|principle/.test(l)) return "shield";
  if (/option|variable|setting/.test(l)) return "gear";
  if (/preview|bundle/.test(l)) return "eye";
  return "layers";
}

/**
 * The values a facet filter offers.
 *
 * Read from the same fixture shapes the cells use, so a pill row can never
 * offer a value no row could hold. Synthetic like every other sample value.
 */
export function facetValues(field) {
  return [0, 1, 2].map((i) => fixtureFor(field, i)).filter((v, i, a) => v && a.indexOf(v) === i);
}

export function navLabel(screenName) {
  const lib = /^(.*)-library$/.exec(screenName);
  if (!lib) return titleCase(screenName);
  const base = titleCase(lib[1]);
  return /s$/.test(base) ? base : `${base}s`;
}

/**
 * The body of a screen, in the shape its archetype contracts to.
 *
 * `list` renders a real table because that is what a list IS on screen — a
 * stack of labelled spans cannot show column alignment, wrapping or row
 * density, which is most of what a reviewer is judging.
 */
export function renderFields(fields, object, archetype = "list", attrs = null, rel = null, known = null) {
  const sid = typeof object === "object" ? object.sid : null;
  const name = typeof object === "object" ? object.name : object;
  const objAttr = sid ?? name;
  if (!fields.length && !attrs?.length) return "";

  const readsFor = (attr) =>
    fields.find((f) => f.field.includes(attr))?.reads_from ?? fields[0]?.reads_from ?? null;
  const resolves = (attr) => sid && (!known || known.indexOf(attr) >= 0);
  const bind = (attr) =>
    resolves(attr)
      ? `data-wp-attr="${esc(sid)}#${esc(attr)}"`
      : `data-wp-field="${esc(attr)}"`;
  const note = (attr) =>
    `<span class="annot-note">${esc(attr)}<br>← ${esc(readsFor(attr) ?? "(no read model)")}</span>`;

  if (archetype === "list") {
    const columns = attrs?.length ? attrs : fields.map((f) => f.field);
    const relAttrs = rel
      ? ` data-wp-rel="${esc(rel.from)}&gt;${esc(name)}" data-wp-rel-as="${esc(rel.as)}"`
      : "";
    // Which card region a field lands in comes from the field itself: the
    // ranked first is the card's name, prose is its body, an enumerable is a
    // badge, and anything left is a meta row. The object map's RANK decides
    // the card, rather than the renderer deciding per screen.
    const isProse = (a) => /desc|definition|note|summary|purpose/i.test(a);
    const isFacet = (a) => /scope|type|kind|status|state|tier|enabled|active/i.test(a);
    const titleAttr = columns[0];
    const proseAttr = columns.slice(1).find(isProse) ?? null;
    const facetAttrs = columns.slice(1).filter((a) => a !== proseAttr && isFacet(a));
    const metaAttrs = columns.slice(1).filter((a) => a !== proseAttr && !isFacet(a));

    const cell = (attr, i, extra = "") =>
      `${bind(attr)} data-wp-reads-from="${esc(readsFor(attr) ?? "")}"${extra}`;

    const cards = [0, 1, 2]
      .map((i) => {
        const nm = fixtureFor(titleAttr, i, name);
        return `        <article class="row" data-wp-object="${esc(objAttr)}"${relAttrs}>
          <div class="card-h">
            <span class="card-ic" aria-hidden="true">${icon(navIcon(name))}</span>
            <div class="card-id">
              <h3 class="card-t" ${cell(titleAttr, i)}>${esc(nm)}${note(titleAttr)}</h3>
              <p class="card-slug">${esc(nm.toLowerCase().replace(/\s+/g, "-"))}</p>
            </div>
          </div>
${proseAttr ? `          <p class="card-d" ${cell(proseAttr, i)}>${esc(fixtureFor(proseAttr, i, name))}${note(proseAttr)}</p>` : ""}
${metaAttrs.length ? `          <dl class="card-meta">
${metaAttrs.map((a) => `            <div><dt>${esc(titleCase(a))}</dt><dd ${cell(a, i)}>${esc(fixtureFor(a, i, name))}${note(a)}</dd></div>`).join("\n")}
          </dl>` : ""}
${facetAttrs.length ? `          <div class="card-badges">${facetAttrs.map((a) => {
            const vals = facetValues(a);
            const v = fixtureFor(a, i, name);
            // Hue is for CATEGORIES. A two-valued field is a state, and
            // colouring "Disabled" violet says it belongs to a group rather
            // than that it is off.
            const tone = vals.length > 2 ? vals.indexOf(v) % 3 : 0;
            return `<span class="badge f${tone}" ${cell(a, i)}>${esc(v)}${note(a)}</span>`;
          }).join("")}</div>` : ""}
          <span class="rowmenu" aria-hidden="true">···</span>
        </article>`;
      })
      .join("\n");
    return `      <div class="cards">
${cards}
      </div>`;
  }

  // A form states each field ONCE as a labelled control — a dialog is not a
  // list, and rendering it as rows was what made confirm dialogs read like
  // tables. `row` stays archetype-true: three on a list, one on a detail.
  const items = attrs?.length && archetype !== "form" ? attrs : fields.map((f) => f.field);
  if (archetype === "form") {
    return `    <div class="facts" data-wp-object="${esc(objAttr)}">
${items
  .map(
    (attr, i) => `      <div class="fact">
        <label ${bind(attr)} data-wp-reads-from="${esc(readsFor(attr) ?? "")}">${esc(titleCase(attr))}
          <span class="control">${esc(fixtureFor(attr, i, name))}</span>${note(attr)}</label>
      </div>`,
  )
  .join("\n")}
    </div>`;
  }
  return `    <div class="row"><dl class="facts" data-wp-object="${esc(objAttr)}">
${items
  .map(
    (attr, i) => `      <div class="fact">
        <dt ${bind(attr)} data-wp-reads-from="${esc(readsFor(attr) ?? "")}">${esc(titleCase(attr))}</dt>
        <dd>${esc(fixtureFor(attr, i, name)) || '<span class="ph"></span>'}${note(attr)}</dd>
      </div>`,
  )
  .join("\n")}
    </dl></div>`;
}

/**
 * The page.
 *
 * Close-to-production on purpose: a developer looks at this to decide whether
 * a screen is right BEFORE it is built, and an archetype skeleton cannot carry
 * that decision. Every colour, radius, space and face comes from
 * design/tokens — so converting the token set converts every mockup, and
 * nothing here needs to know which palette is current.
 *
 * Still zero script. The annotation overlay is a checkbox and a sibling
 * selector over the same data-wp-* attributes the gate reads, so the visible
 * and machine-readable forms cannot disagree (DP-FR-003/005).
 */
export function renderHtml({ context, screen, archetype, copy, ctas, fields, object, objectSid, sids = {}, cardFields = [], knownAttrs = null, rel = null, tokensCss, wireframe, approval, nav = [], route = null }) {
  const state = approval?.state ?? "proposed";
  const isDialog = archetype === "form";
  const cols = fields;
  // The product titles a library page with the collection, not the screen id:
  // `action-library` is the contract's name for the screen; "Actions" is what
  // the heading says. Other archetypes keep their own name.
  const pageTitle = archetype === "list" ? navLabel(screen) : titleCase(screen);
  // The archetype contract decides where the primary action lives and what it
  // is: a list creates, a detail edits the thing you are looking at, and a
  // dashboard has NO primary action because it only navigates. Picking
  // `create` everywhere put "Create agent" in the header of a detail page.
  const pickPrimary = () => {
    if (archetype === "dashboard") return null;
    if (archetype === "detail") {
      return ctas.find((c) => c.verb === "edit") ?? ctas.find((c) => c.verb === "view") ?? null;
    }
    return ctas.find((c) => c.verb === "create") ?? ctas[0] ?? null;
  };
  const primary = pickPrimary();
  const rest = ctas.filter((c) => c !== primary);
  const empties = Object.entries(copy ?? {}).filter(
    ([k, v]) => k !== "errors" && k !== "description" && v,
  );
  const moduleName = titleCase(context);
  const plural = `${object}${/s$/.test(object) ? "" : "s"}`;
  // A list's filter chips come from the object's own enumerable attributes —
  // the same place its columns come from. Inventing a filter row would put a
  // control on the page that no artifact asks for.
  const facets = (cardFields ?? []).filter((f) => /scope|type|kind|status|state|tier/i.test(f));

  const body = isDialog
    ? `      <div class="scrim">
        <section class="dialog" data-wp-screen="${esc(screen)}" data-wp-object="${esc(objectSid ?? object)}" aria-label="${esc(screen)}">
          <h2 class="dialog-title">${esc(pageTitle)}?</h2>
${renderFields(cols, { name: object, sid: objectSid }, archetype, cardFields, rel, knownAttrs)}
          <p class="dialog-warn">This cannot be undone.</p>
          <div class="dialog-actions bar--footer">
            <button type="button" class="btn btn--secondary">Cancel</button>
${renderCtas(ctas.slice(0, 1), sids)}
          </div>
        </section>
      </div>`
    : `      <section class="page" data-wp-screen="${esc(screen)}" data-wp-object="${esc(objectSid ?? object)}" aria-label="${esc(screen)}">
${archetype === "detail"
  ? `        <div class="idbar">
          <span class="back">${icon("back")}</span>
          <h1 class="id-title">${esc(fixtureFor("name", 0, object))}</h1>
${route ? `          <code class="id-path">${esc(route)}</code>` : ""}
          <span class="badge is-accent">Built-in</span>
          <span class="badge">${esc(fixtureFor("scope", 0, object))}</span>
          <div class="actions">
${primary ? renderCtas([primary], sids) : ""}
          </div>
        </div>`
  : `        <div class="page-head">
          <div>
            <h1 class="page-title">${esc(pageTitle)}</h1>
${copy?.description ? `            <p class="page-sub">${esc(copy.description)}</p>` : ""}
          </div>
          <div class="actions">
${primary ? renderCtas([primary], sids) : ""}
          </div>
        </div>`}
${archetype === "list"
  ? `        <div class="toolbar">
          <span class="field-search">${icon("search")}Search ${esc(plural)}...</span>
${facets.map((f) => `          <span class="tb-rule"></span>
          <span class="segs" role="radiogroup" aria-label="Filter by ${esc(f)}"><span class="seg is-on">All</span>${facetValues(f).map((v) => `<span class="seg">${esc(v)}</span>`).join("")}</span>`).join("\n")}
          <span class="tb-spacer"></span>
          <span class="toolbar-end">3 ${esc(plural)}</span>
          <span class="viewtog"><span class="is-on">${icon("grid")}</span><span>${icon("list")}</span></span>
        </div>
        <p class="sec-h">All ${esc(plural)} (3)</p>`
  : ""}
${archetype === "dashboard"
  ? `        <div class="stats">
${["Agents 12", "Actions 34", "Workflows 8", "Principles 21", "Templates 15"].map((t) => {
      const [k, v] = t.split(" ");
      return `          <div class="stat"><span class="stat-n">${esc(v)}</span><span class="stat-k">${esc(k)}</span></div>`;
    }).join("\n")}
        </div>`
  : ""}
        <div class="${archetype === "detail" ? "split" : archetype === "list" ? "list-region" : ""}">
          <div class="${archetype === "list" ? "listwrap" : "panel"}">
${renderFields(cols, { name: object, sid: objectSid }, archetype, cardFields, rel, knownAttrs)}
${rest.length && archetype === "list"
  ? `            <div class="rowmenu-pop" role="menu" aria-label="Row actions">
${renderCtas(rest, sids, { primaryIndex: -1 })}
            </div>`
  : ""}
${archetype === "detail" ? `            <div class="content-block"><span class="content-label">${esc(titleCase(object))} content <i>read-only</i></span><div class="content-frame"></div></div>` : ""}
          </div>
${archetype === "detail"
  ? `          <aside class="side">
            <h3 class="side-h">Related</h3>
            <div class="side-row"><span>Bundle</span><i>&#8250;</i></div>
            <div class="side-row"><span>Overrides</span><i>2</i></div>
          </aside>`
  : ""}
        </div>
${rest.length && archetype !== "list"
  ? `        <div class="rowbar">${renderCtas(rest, sids, { primaryIndex: -1 })}\n        </div>`
  : ""}
      </section>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(screen)} — ${esc(context)} mockup</title>
<!-- GENERATED by design/tools/render-mockup.mjs. Do not hand-edit: every
     data-wp-* value is read from the screen, its contributing slices, the
     ledger and the object map, and the gate checks that correspondence.
     Fixture values are synthetic. Colour, type and spacing come from
     design/tokens — change the tokens, not this file.

     The SHELL — top bar, module rail, content ground — reproduces the
     application's real frame, because a screen shown without it reads as a
     different product. Rail entries are the context's own list screens, so
     the frame is derived like everything else rather than drawn. -->
<style>
  :root {
${tokensCss}
    --bg: var(--semantic-color-bg, #fbfcfd);
    --surface: var(--semantic-color-surface, #f0f3f5);
    --raised: var(--semantic-color-raised, #f7f9fa);
    --ink: var(--semantic-color-ink, #242527);
    --ink-soft: var(--semantic-color-ink-soft, #4d5359);
    --ink-muted: var(--semantic-color-ink-muted, #8b949c);
    --line: var(--semantic-color-border, #dfe5e9);
    --line-strong: var(--semantic-color-border-strong, #c3ccd2);
    --accent: var(--semantic-color-accent, #2e4b61);
    --accent-hover: var(--semantic-color-accent-hover, #22384a);
    --accent-wash: var(--semantic-color-accent-wash, #eaeff3);
    --on-accent: var(--semantic-color-on-accent, #fbfcfd);
    --critical: var(--semantic-color-critical, #8c3b2f);
    --good: var(--semantic-color-good, #3f6b52);
    --r: var(--semantic-radius-control, 3px);
    --rs: var(--semantic-radius-surface, 6px);
    --body-font: var(--semantic-font-body);
    --mono: var(--semantic-font-mono);
    --annot: #6a7b88;
    --annot-rule: #c2ced6;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink);
    font-family: var(--body-font); font-size: 14px; line-height: 1.5;
    -webkit-font-smoothing: antialiased; }

  .meta-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 16px;
    padding: 10px 20px; background: var(--raised); border-bottom: 1px solid var(--line);
    font-family: var(--mono); font-size: 11px; color: var(--ink-muted); }
  .meta-bar b { color: var(--ink-soft); font-weight: 500; }
  .state { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px;
    border-radius: var(--semantic-radius-pill, 999px); font-size: 10px;
    letter-spacing: .08em; text-transform: uppercase; border: 1px solid currentColor; }
  .state--proposed { color: var(--semantic-color-warn, #8a6216); }
  .state--approved { color: var(--good); }
  .toggle { margin-left: auto; display: inline-flex; align-items: center; gap: 7px; cursor: pointer;
    user-select: none; color: var(--ink-soft); }
  .tgl { width: 26px; height: 14px; border-radius: 999px; background: var(--line-strong);
    position: relative; transition: background .12s; }
  .tgl::after { content: ""; position: absolute; top: 2px; left: 2px; width: 10px; height: 10px;
    border-radius: 999px; background: var(--bg); transition: transform .12s; }
  #annot:checked ~ .meta-bar .tgl { background: var(--accent); }
  #annot:checked ~ .meta-bar .tgl::after { transform: translateX(12px); }

  /* ---- the application frame ----------------------------------------- */
  /* Full bleed. A centred card with a page margin around it is a picture OF
     an app; the product fills its viewport, so the mockup does too. */
  .app { display: flex; flex-direction: column; min-height: 100vh; background: var(--bg); }

  /* h-16 / px-6 / gap-4 — the workspace header's own values. */
  .topbar { display: flex; align-items: center; gap: 16px; height: 64px; flex: 0 0 auto;
    padding: 0 24px; background: var(--raised); border-bottom: 1px solid var(--line); }
  .topbar .logo { width: 32px; height: 32px; border-radius: 999px; background: var(--accent); flex: 0 0 auto; }
  .topbar .ws { font-size: 15px; color: var(--ink-soft); }
  .topbar .sep { color: var(--line-strong); }
  .topbar .mod { font-size: 15px; font-weight: 600; letter-spacing: -.01em; }
  .topbar .caret { color: var(--ink-muted); font-size: 11px; }
  .topbar .right { margin-left: auto; display: flex; align-items: center; gap: 16px;
    color: var(--ink-muted); font-size: 14px; }
  .topbar .t-link { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px;
    border-radius: var(--r); }
  .topbar .org { display: inline-flex; align-items: center; gap: 8px; padding: 7px 12px;
    border: 1px solid var(--line-strong); border-radius: var(--rs); font-size: 14px; color: var(--ink); }
  .topbar .avatar { width: 32px; height: 32px; border-radius: 999px; background: var(--accent);
    color: var(--on-accent); font-size: 12px; display: grid; place-items: center; }
  .i { width: 16px; height: 16px; flex: 0 0 auto; }
  .card-ic .i { width: 22px; height: 22px; }

  .shell { display: flex; flex: 1 1 auto; min-height: 0; }

  /* Module rail — w-60 over its own dark slab, grouped, with count badges.
     The active entry is a filled pill (bg-slate-700 text-white), not an
     accent stripe: reproducing the wrong affordance is still a wrong page. */
  .rail { width: 240px; flex: 0 0 240px; background: var(--semantic-color-nav, #141a21);
    border-right: 1px solid var(--line); padding: 16px 0 24px; }
  .rail-g { margin-bottom: 24px; padding-top: 6px; }
  .rail-h { font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase;
    color: var(--ink-muted); padding: 0 12px; margin: 0 0 12px; }
  .rail-i { display: flex; align-items: center; justify-content: space-between; gap: 8px;
    margin: 0 8px 4px; padding: 8px 12px; border-radius: var(--rs);
    font-size: 14px; color: var(--ink-soft); }
  .rail-i > span:first-child { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
  .rail-i.is-on { background: var(--semantic-color-nav-raised, #28323d); color: var(--ink); }
  .rail-n { font-size: 11.5px; padding: 1px 8px; border-radius: 999px;
    background: var(--semantic-color-nav-badge, #475569); color: var(--ink); }

  .main { flex: 1 1 auto; min-width: 0; background: var(--bg); overflow: hidden; }
  .page { padding: 24px; }

  /* mb-6, title text-xl/600, description text-sm muted mt-1 */
  .page-head { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; }
  .page-title { margin: 0; font-family: var(--semantic-font-display); font-size: 20px;
    font-weight: 600; letter-spacing: -.015em; }
  .page-sub { margin: 4px 0 0; font-size: 14px; color: var(--ink-muted); max-width: 80ch; }
  .actions { margin-left: auto; display: flex; gap: 8px; flex: 0 0 auto; }

  .btn { font: inherit; font-size: 14px; font-weight: 500; padding: 8px 12px;
    border-radius: var(--r); border: 1px solid transparent; cursor: pointer; position: relative;
    display: inline-flex; align-items: center; gap: 8px; }
  .btn--primary { background: var(--accent); color: var(--on-accent); }
  .btn--secondary { background: var(--raised); color: var(--ink); border-color: var(--line-strong); }
  .btn--danger { background: var(--raised); color: var(--critical); border-color: var(--critical); }

  /* EntityToolbar: search (w-64) · rule · pill group · rule · pill group ·
     spacer · count · view toggle. The rules are load-bearing — they are what
     separates two pill groups that would otherwise read as one. */
  .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-bottom: 24px; }
  .field-search { display: inline-flex; align-items: center; gap: 8px; width: 256px; flex: 0 0 auto;
    height: 36px; padding: 0 12px; background: var(--raised); border: 1px solid var(--line-strong);
    border-radius: var(--r); color: var(--ink-muted); font-size: 14px; }
  .tb-rule { width: 1px; height: 20px; background: var(--line-strong); flex: 0 0 auto; }
  .segs { display: inline-flex; align-items: center; gap: 6px; }
  .seg { padding: 4px 10px; font-size: 12px; font-weight: 500; color: var(--ink-muted);
    border-radius: 999px; }
  .seg.is-on { background: var(--surface); color: var(--ink); }
  .tb-spacer { flex: 1 1 auto; }
  .toolbar-end { color: var(--ink-muted); font-size: 12px; }
  .viewtog { display: inline-flex; gap: 2px; }
  .viewtog span { display: grid; place-items: center; width: 30px; height: 30px;
    border-radius: var(--r); color: var(--ink-muted); }
  .viewtog span.is-on { background: var(--surface); color: var(--ink); }

  .sec-h { font-size: 12px; font-weight: 500; letter-spacing: .06em; text-transform: uppercase;
    color: var(--ink-muted); margin: 0 0 16px; }

  .listwrap { display: contents; }

  /* Card grid — grid gap-6 lg:grid-cols-3, card rounded-lg border p-6 with a
     4px identity edge. This is the product's DEFAULT list view; the divided
     row list is the alternate behind the view toggle. */
  .cards { display: grid; gap: 24px; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); }
  .cards > .row { position: relative; padding: 24px; background: var(--raised);
    border: 1px solid var(--line); border-radius: var(--rs); }
  .card-h { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
  .card-ic { flex: 0 0 auto; display: grid; place-items: center; color: var(--accent); }
  .card-id { min-width: 0; }
  .card-t { margin: 0; font-size: 17px; font-weight: 600; letter-spacing: -.01em;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .card-slug { margin: 1px 0 0; font-family: var(--mono); font-size: 13px; color: var(--ink-muted);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .card-badges { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px;
    margin-top: 14px; }
  .card-badges .badge { border: 0; background: var(--surface); }
  .badge.f0 { color: var(--semantic-color-facet-0, #8d9aa6); }
  .badge.f1 { color: var(--semantic-color-facet-1, #a78bfa); }
  .badge.f2 { color: var(--semantic-color-facet-2, #34d399); }
  .card-d { margin: 0; font-size: 14px; color: var(--ink-muted); }
  .card-meta { margin: 14px 0 0; display: grid; gap: 8px; font-size: 14px; }
  .card-meta > div { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .card-meta dt { margin: 0; color: var(--ink-muted); }
  .card-meta dd { margin: 0; font-family: var(--mono); font-size: 12px; }
  .cards > .row .rowmenu { position: absolute; top: 18px; right: 16px; color: var(--ink-muted);
    letter-spacing: 1px; }
  .tablewrap { border: 1px solid var(--line); border-radius: var(--rs); overflow: hidden; background: var(--raised); }
  .table { width: 100%; border-collapse: collapse; }
  .table th { text-align: left; font-size: 10.5px; letter-spacing: .09em; text-transform: uppercase;
    color: var(--ink-muted); font-weight: 600; padding: 10px 16px; background: var(--surface);
    border-bottom: 1px solid var(--line); white-space: nowrap; }
  .table td { padding: 13px 16px; border-bottom: 1px solid var(--line); vertical-align: top; font-size: 13.5px; }
  .table tr:last-child td { border-bottom: none; }
  .cell--lead { font-weight: 600; color: var(--ink); }
  .cell--end { width: 36px; text-align: right; color: var(--ink-muted); }
  .rowmenu { letter-spacing: 1px; }

  /* Detail: identity bar, then a labelled field strip, then content. */
  .idbar { display: flex; align-items: center; gap: 12px; margin: -26px -30px 0; padding: 14px 30px;
    border-bottom: 1px solid var(--line); background: var(--raised); }
  .idbar .back { color: var(--ink-muted); font-size: 15px; }
  .id-title { margin: 0; font-family: var(--semantic-font-display); font-size: 19px; font-weight: 600;
    letter-spacing: -.015em; }
  .id-path { font-family: var(--mono); font-size: 12px; color: var(--ink-muted); }
  .badge { font-size: 11px; padding: 2px 9px; border-radius: 999px; background: var(--surface);
    border: 1px solid var(--line-strong); color: var(--ink-soft); }
  .badge.is-accent { background: var(--accent-wash); border-color: var(--accent); color: var(--accent); }

  .split { display: grid; grid-template-columns: minmax(0,1fr) 288px; gap: 20px; align-items: start;
    margin-top: 22px; }
  .panel { border: 1px solid var(--line); border-radius: var(--rs); background: var(--raised); padding: 18px 20px; }
  .facts { margin: 0; display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); }
  .fact { min-width: 0; }
  .fact dt, .facts label { margin: 0 0 5px; display: block; font-size: 10.5px; letter-spacing: .09em;
    text-transform: uppercase; color: var(--ink-muted); font-weight: 600; }
  .fact dd { margin: 0; font-size: 13.5px; }
  .control { display: block; margin-top: 4px; padding: 8px 11px; font-size: 13.5px;
    color: var(--ink); background: var(--bg); border: 1px solid var(--line-strong);
    border-radius: var(--r); }
  .ph { display: block; height: 10px; width: 60%; background: var(--surface); border-radius: var(--r); }
  .content-block { margin-top: 22px; border-top: 1px solid var(--line); padding-top: 16px; }
  .content-label { font-size: 10.5px; letter-spacing: .09em; text-transform: uppercase;
    color: var(--ink-muted); font-weight: 600; }
  .content-label i { font-style: normal; margin-left: 8px; opacity: .7; letter-spacing: .06em; }
  /* The product renders file content in a ruled editor pane, so the frame is
     a surface rather than an empty box. */
  .content-frame { margin-top: 10px; height: 190px; border: 1px solid var(--line);
    border-radius: var(--r); background: var(--bg);
    background-image: repeating-linear-gradient(var(--surface) 0 1px, transparent 1px 21px);
    background-position: 0 14px; }
  .side { border: 1px solid var(--line); border-radius: var(--rs); background: var(--raised); padding: 16px 18px; }
  .side-h { margin: 0 0 10px; font-size: 10.5px; letter-spacing: .09em; text-transform: uppercase; color: var(--ink-muted); font-weight: 600; }
  .side-row { display: flex; justify-content: space-between; padding: 9px 0;
    border-top: 1px solid var(--line); font-size: 13px; color: var(--ink-soft); }
  .side-row i { font-style: normal; color: var(--ink-muted); }

  .stats { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
  .stat { flex: 1 1 130px; border: 1px solid var(--line); border-radius: var(--rs);
    background: var(--raised); padding: 14px 16px; }
  .stat-n { display: block; font-family: var(--semantic-font-display); font-size: 24px;
    font-weight: 600; letter-spacing: -.02em; }
  .stat-k { font-size: 12px; color: var(--ink-muted); }

  .rowbar { display: flex; gap: 8px; margin-top: 16px; flex-wrap: wrap; }

  /* The row overflow, drawn open. A mockup is a still, so a closed menu would
     hide exactly the CTAs the reviewer is here to check. */
  /* Anchored under the top-right card's overflow, where it would open. */
  .list-region { position: relative; }
  .list-region .rowmenu-pop { position: absolute; top: calc(100% + 6px); right: 14px; margin: 0; }
  .rowmenu-pop { width: 208px; margin: -1px 0 0 auto; padding: 5px;
    background: var(--raised); border: 1px solid var(--line-strong); border-radius: var(--rs);
    box-shadow: 0 10px 28px rgba(0,0,0,.34); display: grid; gap: 1px; position: relative; z-index: 2; }
  .rowmenu-pop .btn { background: none; border: none; text-align: left; padding: 7px 10px;
    color: var(--ink-soft); font-size: 13px; border-radius: var(--r); }
  .rowmenu-pop .btn--danger { color: var(--critical); }

  .scrim { background: rgba(9,11,14,.52); padding: 64px 24px; display: grid; place-items: center; min-height: 420px; }
  .dialog { width: min(460px, 100%); background: var(--raised); border-radius: var(--rs);
    border: 1px solid var(--line-strong); padding: 22px; box-shadow: 0 16px 48px rgba(0,0,0,.34); }
  .dialog-title { margin: 0 0 16px; font-family: var(--semantic-font-display); font-size: 17px; font-weight: 600; }
  .dialog .facts { grid-template-columns: 1fr; gap: 13px; }
  .dialog-warn { margin: 16px 0 0; font-size: 13px; color: var(--critical); }
  .dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }

  .states { padding: 0 30px 40px; }
  .states h3 { font-size: 10.5px; letter-spacing: .09em; text-transform: uppercase;
    color: var(--ink-muted); margin: 0 0 8px; }
  .states .state-row { background: var(--raised); border: 1px solid var(--line); border-radius: var(--rs);
    padding: 10px 14px; margin-bottom: 6px; font-size: 13px; }
  .states .state-row b { font-family: var(--mono); font-size: 11px; color: var(--ink-muted);
    font-weight: 500; margin-right: 10px; }

  /* annotation overlay — CSS only, same attributes the gate reads */
  .annot-note { display: none; }
  #annot:checked ~ .screen .annot-note,
  #annot:checked ~ .states .annot-note { display: block; font-family: var(--mono);
    font-size: 10px; line-height: 1.35; color: var(--annot); margin-top: 4px;
    padding-left: 6px; border-left: 2px solid var(--annot-rule); word-break: break-word;
    font-weight: 400; text-transform: none; letter-spacing: 0; }
  #annot:checked ~ .screen [data-wp-severity="irreversible"] { border-color: var(--critical); }
  #annot, #hifi { position: absolute; opacity: 0; pointer-events: none; }
  #hifi:checked ~ .meta-bar label[for="hifi"] .tgl { background: var(--accent); }
  #hifi:checked ~ .meta-bar label[for="hifi"] .tgl::after { transform: translateX(12px); }
  /* The second stylesheet: unchecked strips the page back to a wireframe over
     the SAME DOM, so the two views cannot show different structure. */
  #hifi:not(:checked) ~ .screen { box-shadow: none; }
  #hifi:not(:checked) ~ .screen .topbar,
  #hifi:not(:checked) ~ .screen .rail,
  #hifi:not(:checked) ~ .screen .idbar,
  #hifi:not(:checked) ~ .screen .stat,
  #hifi:not(:checked) ~ .screen .side { background: none; }
  #hifi:not(:checked) ~ .screen .rail-i.is-on { background: none; }
  #hifi:not(:checked) ~ .screen .logo,
  #hifi:not(:checked) ~ .screen .avatar { background: none; border: 1px dashed var(--line-strong); color: var(--ink-muted); }
  #hifi:not(:checked) ~ .screen .btn { background: none !important; color: var(--ink) !important;
    border: 1px dashed var(--line-strong) !important; }
  #hifi:not(:checked) ~ .screen .table th { background: none; }
  #hifi:not(:checked) ~ .screen .seg.is-on { background: none; }
  #hifi:not(:checked) ~ .screen .content-frame,
  #hifi:not(:checked) ~ .screen .field-search,
  #hifi:not(:checked) ~ .screen .badge { background: none; border-style: dashed; }
</style>
</head>
<body>
<input type="checkbox" id="annot">
<input type="checkbox" id="hifi" checked>
<div class="meta-bar">
  <span><b>context</b> ${esc(context)}</span>
  <span><b>screen</b> ${esc(screen)}</span>
  <span><b>archetype</b> ${esc(archetype)}</span>
  <span class="state state--${esc(state)}">${esc(state)}</span>
  ${approval?.approved_by ? `<span><b>by</b> ${esc(approval.approved_by)}</span>` : ""}
  <label class="toggle" for="hifi"><span class="tgl"></span>High fidelity</label>
  <label class="toggle" for="annot" style="margin-left:0"><span class="tgl"></span>Show OOUX bindings</label>
</div>

<div class="screen app arch-${esc(archetype)}">
  <div class="topbar">
    <span class="logo"></span><span class="ws">WayPoint</span>
    <span class="sep">|</span><span class="mod">${esc(moduleName)}</span><span class="caret">&#9662;</span>
    <span class="right">
      <span class="t-link">${icon("book")}Docs</span>
      <span class="org">${icon("building")}CoPoint AI <i style="font-style:normal;opacity:.6">&#9662;</i></span>
      <span class="avatar">DU</span>
    </span>
  </div>
  <div class="shell">
${nav.length ? `    <nav class="rail">
      <div class="rail-g">
        <p class="rail-h">${esc(moduleName)}</p>
${nav.map((n) => `        <div class="rail-i${n.active ? " is-on" : ""}"><span>${icon(navIcon(n.label))}${esc(n.label)}</span>${n.count ? `<span class="rail-n">${esc(n.count)}</span>` : ""}</div>`).join("\n")}
      </div>
    </nav>` : ""}
    <main class="main">
${body}
    </main>
  </div>
</div>

<div class="states">
  <h3>Empty and error states</h3>
${empties.map(([k, v]) => `  <div class="state-row"><b>${esc(k)}</b>${esc(v)}</div>`).join("\n")}
${(copy?.errors ?? []).map((e) => `  <div class="state-row"><b>${esc(e.case ?? "error")}</b>${esc(e.message ?? "")}</div>`).join("\n")}
</div>
</body>
</html>
`;
}

/**
 * Everything a screen's picture is derived from.
 *
 * Split out of buildMockup so the wireframe in the contract and the rendered
 * mockup read the SAME derivation. They had drifted — the contracts drew a
 * table with column headers while the renderer drew the card grid the product
 * ships — and a wireframe that contradicts its own mockup is worse than none:
 * it is the artifact a reviewer reads first.
 */
/**
 * The success toast a CTA's own slice authored.
 *
 * Read from the slice rather than derived, because the toast is AUTHORED copy
 * — the feedback grammar says what shape it takes, not what it says. Nothing
 * rendered it until now, which is how `Action reorderd` sat in the record
 * unread.
 */
export function toastFor(designDir, context, cta) {
  const dir = join(designDir, "flows");
  if (!existsSync(dir)) return null;
  for (const f of readdirSync(dir)) {
    if (!f.startsWith(`${context}.`) || !f.endsWith(".yaml")) continue;
    const src = readFileSync(join(dir, f), "utf8");
    const scalar = (k) =>
      (src.match(new RegExp(`^${k}:\\s*(.*)$`, "m")) ?? [])[1]?.replace(/\s+#.*$/, "").trim();
    if (scalar("cta") !== cta.verb || scalar("object") !== cta.object) continue;
    const raw = (src.match(/^\s{2}success:\s*(.*)$/m) ?? [])[1]
      ?.replace(/\s+#.*$/, "")
      .trim()
      .replace(/^["']|["']$/g, "");
    if (!raw || /^(null|~|none)/i.test(raw)) return null;
    return raw;
  }
  return null;
}

export function deriveScreen(designDir, context, screen) {
  const screenPath = join(designDir, "screens", `${context}.${screen}.yaml`);
  if (!existsSync(screenPath)) {
    throw new Error(
      `no screen contract at ${screenPath} — run /waypoint.design-flow ${context} ${screen} first`,
    );
  }
  const screenSrc = readFileSync(screenPath, "utf8");
  const meta = parseScreen(screenSrc);

  /**
   * The module rail.
   *
   * Its entries are the context's list and dashboard screens — the places the
   * product navigates TO. Reading them from the screens directory keeps the
   * frame derived like the rest of the mockup: add a library screen and it
   * appears in every sibling's rail, with no second list to maintain.
   */
  const screensDir = join(designDir, "screens");
  const navAll = existsSync(screensDir)
    ? readdirSync(screensDir)
        .filter((f) => f.startsWith(`${context}.`) && f.endsWith(".yaml"))
        .map((f) => {
          const name = f.slice(context.length + 1, -5);
          const m = parseScreen(readFileSync(join(screensDir, f), "utf8"));
          return { name, archetype: m.archetype };
        })
        .filter((n) => n.archetype === "list" || n.archetype === "dashboard")
    : [];
  // A detail or a confirm dialog is not itself a destination, so the rail
  // highlights the library it belongs to — `action-detail` lights `Actions`.
  const stem = screen.replace(/-(detail|delete-confirm|confirm|edit|create|new)$/, "");
  const nav = navAll
    .sort((a, b) => (a.archetype === "dashboard" ? -1 : b.archetype === "dashboard" ? 1 : a.name.localeCompare(b.name)))
    .map((n, i) => ({
      label: navLabel(n.name),
      // Synthetic, but stable per entry and never all the same — a rail of
      // identical counts reads as a placeholder rather than a page.
      count: n.archetype === "dashboard" ? "" : String(3 + ((i * 7) % 23)),
      active: n.name === screen || n.name === `${stem}-library`,
    }));

  const slices = contributingSlices(designDir, context, screen);
  const fields = slices.flatMap(({ src }) => sliceFieldsFor(src, screen));

  // CTA rows come from the ledger, filtered to the CTAs these slices carry —
  // the ledger is the source for command/severity/surface, never the slice.
  const ledgerPath = join(designDir, "glossary", `${context}.yaml`);
  const ledgerCtas = existsSync(ledgerPath) ? parseCtas(readFileSync(ledgerPath, "utf8")) : [];
  // Match on the (object, verb) PAIR. Filtering by verb alone let a shared
  // verb collide across objects: three slices here carry `view`, and the
  // ledger lists `atlas view` before `artifact view`, so every screen whose
  // slices mention `view` bound the atlas and rendered the atlas's CTAs.
  // Each slice names its own object, so the pair is always available.
  const reachable = new Set(
    slices
      .map(({ src }) => {
        const verb = (src.match(/^cta:\s*(\S+)/m) ?? [])[1];
        // `(.+)` not `(\S+)`: ledger nouns can be several words — `init option`
        // truncated to `init`, the (object, verb) pair never matched, and both
        // init-option screens bound the fallback object `item` with zero
        // attributes. parsers.mjs has always captured the whole value.
        const obj = (src.match(/^object:\s*(.+)$/m) ?? [])[1]?.replace(/\s*#.*$/, "").trim();
        return verb && obj ? `${obj}\u0000${verb}` : null;
      })
      .filter(Boolean),
  );
  const ctas = ledgerCtas
    .filter((c) => reachable.has(`${c.object}\u0000${c.verb}`))
    // The authored success toast, from the slice that owns this CTA. It is
    // rendered as an ANNOTATION rather than as chrome: where a toast sits is
    // doctrine (top-right, 5s), but what a static mockup does with one is a
    // design decision nobody has directed. An annotation makes the authored
    // copy reviewable without asserting a layout.
    .map((c) => ({ ...c, toast: toastFor(designDir, context, c) }));
  const object = ctas[0]?.object ?? "item";

  // The object map supplies three things the mockup cannot invent: the sid
  // every annotation points at, the ranked card_fields a list renders, and
  // which relationship this screen's region satisfies. All three are read,
  // never derived from the screen's own prose.
  const objectsPath = join(designDir, "objects", `${context}.yaml`);
  const objectsSrc = existsSync(objectsPath) ? readFileSync(objectsPath, "utf8") : null;
  const objectMap = objectsSrc ? parseObjectMap(objectsSrc) : { objects: {} };
  const sids = Object.fromEntries(
    Object.entries(objectMap.objects ?? {})
      .filter(([, v]) => v.sid)
      .map(([k, v]) => [k, v.sid]),
  );
  const objectSid = sids[object] ?? null;
  const cardFields = objectMap.objects?.[object]?.card_fields ?? [];
  const knownAttrs = (objectMap.objects?.[object]?.attributes ?? []).map((a) =>
    typeof a === "object" ? a.name : a,
  );

  // `navigation.reachability` already records how each object is reached and
  // as what representation — so the DOM binding for the relationship is read
  // from there rather than guessed from the archetype.
  const reach = objectsSrc ? parseReachability(objectsSrc) : [];
  const row = reach.find((r) => r.object === object && r.representation && r.representation !== "none");
  const rel = row && sids[row.via] ? { from: sids[row.via], as: row.representation } : null;

  const parsedCopy = parseScreenCopy(screenSrc);
  // `description` is page copy, not a state — spreading only `empty` dropped
  // it silently, so the contracts carried a description no page ever showed.
  const copy = { ...parsedCopy.empty, description: parsedCopy.description, errors: parsedCopy.errors };
  const wf = screenSrc.match(/^wireframe: \|\n((?:[ \t].*\n?)*)/m);

  const tokensPath = join(designDir, "tokens", "waypoint.tokens.json");
  const tokensCss = existsSync(tokensPath)
    ? tokensToCss(JSON.parse(readFileSync(tokensPath, "utf8")))
    : "";

  return {
    approval: meta.mockup,
    context,
    screen,
    archetype: meta.archetype ?? "unspecified",
    copy,
    ctas,
    fields,
    object,
    objectSid,
    sids,
    cardFields,
    knownAttrs,
    rel,
    tokensCss,
    nav,
    route: parseScreenRoutes(screenSrc).find((r) => r.path)?.path ?? null,
    wireframe: wf ? wf[1].replace(/^ {2}/gm, "").trimEnd() : null,
  };
}

export function buildMockup(designDir, context, screen) {
  // Routed through renderModel so there is ONE dispatch (D-2): a declared
  // screen takes the archetype branch, a measured one takes geometry, and
  // neither caller chooses. deriveScreen's output IS the archetype branch's
  // input, so the 26 pins stay byte-identical — the renderer did not change,
  // only who decides which renderer runs.
  const derived = deriveScreen(designDir, context, screen);
  const model = {
    version: 1,
    context,
    provenance: "declared",
    objects: [],
    screens: [{ name: screen, archetype: derived.archetype, derived }],
    ctas: [],
  };
  return renderModel(model, screen, {
    renderArchetype: (s) => renderHtml(s.derived),
  }).html;
}

function main() {
  const [context, screen] = process.argv.slice(2);
  if (!context || !screen) {
    console.error("usage: node design/tools/render-mockup.mjs <context> <screen>");
    return 2;
  }
  let html;
  try {
    html = buildMockup(DESIGN_DIR, context, screen);
  } catch (error) {
    // A missing contract is the expected first-run case, not a crash: say what
    // to do rather than printing a stack trace at someone.
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  const outDir = join(DESIGN_DIR, "mockups");
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, `${context}.${screen}.html`);
  writeFileSync(out, html);
  console.log(`mockup written: ${out}`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}

/* ------------------------------------------------------------------ *
 * Wireframes
 *
 * Drawn from `deriveScreen` — the same inputs the mockup renders from — so
 * the contract's picture and the artboard cannot describe different layouts.
 * The wireframe stays the coarser statement: it shows the regions, the shell
 * and where the CTAs land, not the fidelity. What it can no longer do is
 * claim a shape the renderer does not produce.
 * ------------------------------------------------------------------ */

const WF_W = 92;
const WF_RAIL = 17;
const WF_MAIN = WF_W - WF_RAIL - 1;

const wfCut = (s, n) => (s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s);
const wfPad = (s, n) => wfCut(String(s), n).padEnd(n);
const wfRule = (n, ch = "─") => ch.repeat(Math.max(0, n));

/** A bordered box; every row is exactly `w + 2` wide so boxes can sit in a row. */
function wfBox(lines, w, heading) {
  const top = heading
    ? `┌ ${heading} ${wfRule(w - heading.length - 2)}┐`
    : `┌${wfRule(w)}┐`;
  return [top, ...lines.map((l) => `│ ${wfPad(l, w - 2)} │`), `└${wfRule(w)}┘`];
}

/** Two boxes side by side, the shorter padded to the taller. */
function wfBeside(a, b, gap = 1) {
  const h = Math.max(a.length, b.length);
  return Array.from({ length: h }, (_, i) =>
    `${wfPad(a[i] ?? "", a[0].length)}${" ".repeat(gap)}${wfPad(b[i] ?? "", b[0].length)}`);
}

function wfFrame(rail, main, topbar) {
  const rows = Math.max(rail.length, main.length);
  const out = [
    `┌${wfRule(WF_W)}┐`,
    `│${wfPad(` ${topbar}`, WF_W)}│`,
    `├${wfRule(WF_RAIL)}┬${wfRule(WF_MAIN)}┤`,
  ];
  for (let i = 0; i < rows; i += 1) {
    out.push(`│${wfPad(rail[i] ?? "", WF_RAIL)}│${wfPad(main[i] ?? "", WF_MAIN)}│`);
  }
  out.push(`└${wfRule(WF_RAIL)}┴${wfRule(WF_MAIN)}┘`);
  return out;
}

/** Three cards side by side — the list archetype's real body. */
function wfCards(object, cols) {
  const cw = Math.floor((WF_MAIN - 2) / 3) - 1;
  const inner = cw - 4;
  const title = cols[0] ?? "name";
  const prose = cols.slice(1).find((f) => /desc|definition|note|summary/i.test(f));
  const facet = cols.slice(1).find((f) => /scope|type|kind|status|state|tier|enabled/i.test(f));
  const meta = cols.slice(1).find((f) => f !== prose && f !== facet);

  const cells = [0, 1, 2].map((i) => {
    const name = fixtureFor(title, i, object);
    return [
      `⬡ ${wfPad(name, inner - 7)}  ···`,
      `  ${wfPad(name.toLowerCase().replace(/\s+/g, "-"), inner - 2)}`,
      "",
      ...(prose ? [wfPad(fixtureFor(prose, i, object), inner)] : []),
      ...(meta ? [wfPad(`${titleCase(meta)}  ${fixtureFor(meta, i, object)}`, inner)] : []),
      ...(facet ? [`[${fixtureFor(facet, i, object)}]`.padStart(inner)] : []),
    ];
  });

  const depth = Math.max(...cells.map((c) => c.length));
  const lines = [` ${cells.map(() => `┌${wfRule(cw - 2)}┐`).join(" ")}`];
  for (let r = 0; r < depth; r += 1) {
    lines.push(` ${cells.map((c) => `│ ${wfPad(c[r] ?? "", cw - 4)} │`).join(" ")}`);
  }
  lines.push(` ${cells.map(() => `└${wfRule(cw - 2)}┘`).join(" ")}`);
  return lines;
}

export function buildWireframe(designDir, context, screen) {
  const d = deriveScreen(designDir, context, screen);
  const { archetype, object, ctas, cardFields, copy, nav, route } = d;
  const moduleName = titleCase(context);
  const plural = `${object}${/s$/.test(object) ? "" : "s"}`;
  const cols = cardFields?.length ? cardFields : d.fields.map((f) => f.field);

  const primary =
    archetype === "dashboard" ? null
      : archetype === "detail"
        ? (ctas.find((c) => c.verb === "edit") ?? ctas.find((c) => c.verb === "view") ?? null)
        : (ctas.find((c) => c.verb === "create") ?? ctas[0] ?? null);
  const rest = ctas.filter((c) => c !== primary);
  const label = (c) => ctaLabel(c.verb, c.object);

  const tbLeft = `WayPoint │ ${moduleName} ▾`;
  const tbRight = "Docs  CoPoint AI ▾  (DU)";
  const topbar = tbLeft + " ".repeat(Math.max(1, WF_W - 2 - tbLeft.length - tbRight.length)) + tbRight;

  const rail = [` ${wfCut(moduleName.toUpperCase(), WF_RAIL - 2)}`];
  for (const n of nav) rail.push(` ${n.active ? "▸" : "·"} ${wfPad(n.label, WF_RAIL - 6)}${n.count ?? ""}`);

  let main;
  if (archetype === "form") {
    // A dialog is the page dimmed behind a scrim; the wireframe says so
    // rather than drawing a page that is not what you see.
    const dw = WF_MAIN - 24;
    const pair = `[ Cancel ]  [ ${primary ? label(primary) : "Confirm"} ]`;
    main = [
      "",
      ...wfBox(
        [
          ...(cols.length ? cols : ["name"]).slice(0, 3).flatMap((f) => [
            titleCase(f).toUpperCase(),
            `[ ${wfPad(fixtureFor(f, 0, object), dw - 8)}]`,
          ]),
          "",
          "This cannot be undone.",
          pair.padStart(dw - 2),
        ],
        dw,
        `${titleCase(screen)}?`,
      ).map((l) => `${" ".repeat(9)}${l}`),
      "",
      `${" ".repeat(9)}(over the dimmed parent screen)`,
    ];
  } else if (archetype === "dashboard") {
    const stats = [["Agents", 12], ["Actions", 34], ["Workflows", 8], ["Principles", 21], ["Templates", 15]];
    const sw = Math.floor(WF_MAIN / stats.length) - 1;
    main = [
      ` ${titleCase(screen)}`,
      "",
      ` ${stats.map(() => `┌${wfRule(sw - 2)}┐`).join("")}`,
      ` ${stats.map(([, n]) => `│ ${wfPad(n, sw - 4)} │`).join("")}`,
      ` ${stats.map(([k]) => `│ ${wfPad(k, sw - 4)} │`).join("")}`,
      ` ${stats.map(() => `└${wfRule(sw - 2)}┘`).join("")}`,
      "",
      ...(primary ? [` [ ${label(primary)} ]`] : [" (navigation only — no primary action)"]),
    ];
  } else if (archetype === "detail") {
    const lw = 44;
    const rw = WF_MAIN - lw - 6;
    const idRight = `[ ${primary ? label(primary) : "—"} ]`;
    const idLeft = ` ← ${fixtureFor("name", 0, object)}   ${route ?? ""}   (Built-in) (${fixtureFor("scope", 0, object)})`;
    const left = wfBox(
      [
        ...(cols.length ? cols : ["name"]).slice(0, 4)
          .map((f, i) => `${titleCase(f).toUpperCase()}   ${fixtureFor(f, i, object)}`),
        "",
        `${titleCase(object).toUpperCase()} CONTENT   read-only`,
        `┌${wfRule(lw - 6)}┐`,
        `│${" ".repeat(lw - 6)}│`,
        `└${wfRule(lw - 6)}┘`,
      ],
      lw,
    );
    const right = wfBox(["Bundle              ›", "Overrides           2"], rw, "RELATED");
    main = [
      `${wfPad(idLeft, WF_MAIN - idRight.length - 2)}${idRight}`,
      ` ${wfRule(WF_MAIN - 2)}`,
      ...wfBeside(left, right).map((l) => ` ${l}`),
      "",
      ...(rest.length ? [` ${rest.map((c) => `[ ${label(c)} ]`).join(" ")}`] : []),
    ];
  } else {
    const facets = (cardFields ?? []).filter((f) => /scope|type|kind|status|state|tier/i.test(f));
    main = [
      `${wfPad(` ${navLabel(screen)}`, WF_MAIN - 22)}[ + ${wfPad(primary ? label(primary) : "—", 15)}]`,
      ...(copy?.description ? [` ${wfCut(copy.description, WF_MAIN - 2)}`] : []),
      "",
      ` [ ⌕ Search ${wfPad(`${plural}…`, 16)}]${facets.length ? `   All · ${facetValues(facets[0]).join(" · ")}` : ""}`,
      `${" ".repeat(WF_MAIN - 24)}3 ${wfPad(plural, 14)} ▦ ☰`,
      ` ALL ${plural.toUpperCase()} (3)`,
      ...wfCards(object, cols),
    ];
  }

  const lines = wfFrame(rail, main, topbar);
  if (archetype === "list" && rest.length) {
    lines.push(`      ··· row overflow → ${rest.map(label).join(" · ")}`);
  }
  return lines.join("\n");
}
