/**
 * design parsers — the YAML-subset and content readers shared by every
 * consumer of the design artifacts (design-preflight AD-2, rule:design.one-parser).
 *
 * ONE parser module, three consumers:
 *   1. scripts/design-tools/gate-check.mjs  — enforcement, in this repo
 *   2. design/tools/parsers.mjs             — the seeded copy, in each project
 *   3. the platform sync interactor         — populates DesignArtifact.parsed (T11)
 *
 * The projection cannot disagree with the gate because both are this function
 * over the same bytes. A second parser is a defect, not an optimization.
 *
 * PURE. No node:fs, no Prisma, no Next, no npm dependencies — `node:crypto` is
 * the single built-in, and only for the content hash. IO belongs to the tools
 * that call these.
 *
 * Parser subset (deliberate, plan R2): flat maps, lists of flat maps, and
 * opaque literal blocks extracted by top-level key. Nesting is not supported;
 * DC-FR-052 is the release valve when it is needed.
 */

import { createHash } from "node:crypto";

/** Parse `contexts:` two-level map from coverage.yaml. */
export function parseCoverage(src) {
  const contexts = {};
  let inContexts = false;
  let current = null;
  for (const raw of src.split("\n")) {
    const line = raw.replace(/#.*$/, "").trimEnd();
    if (!line.trim()) continue;
    const indent = raw.length - raw.trimStart().length;
    if (indent === 0) {
      inContexts = line.startsWith("contexts:");
      current = null;
      continue;
    }
    if (!inContexts) continue;
    if (indent === 2 && line.trim().endsWith(":")) {
      current = line.trim().slice(0, -1);
      contexts[current] = {};
      continue;
    }
    if (current) {
      const m = line.trim().match(/^([\w-]+):\s*(.+)$/);
      if (m) {
        const v = m[2].replace(/^\[|\]$/g, "");
        contexts[current][m[1]] = m[1] === "ratified_sids"
          ? v.split(",").map((x) => x.trim()).filter(Boolean)
          : v;
      }
    }
  }
  return contexts;
}

/** Parse debt entries (list of flat maps). */
export function parseDebt(src) {
  const entries = [];
  let cur = null;
  for (const raw of src.split("\n")) {
    const line = raw.replace(/#.*$/, "").trimEnd();
    if (!line.trim()) continue;
    const t = line.trim();
    if (t.startsWith("- ")) {
      cur = {};
      entries.push(cur);
      const m = t.slice(2).match(/^([\w-]+):\s*(.*)$/);
      if (m && cur) cur[m[1]] = m[2];
    } else if (cur) {
      const m = t.match(/^([\w-]+):\s*(.*)$/);
      if (m) {
        cur[m[1]] = m[2].startsWith("[")
          ? m[2].replace(/^\[|\]$/g, "").split(",").map((x) => x.trim()).filter(Boolean)
          : m[2];
      }
    }
  }
  return entries;
}

/** Parse a flow slice: fields with reads_from. */
export function parseSlice(src) {
  const fields = [];
  let object = null;
  // Top-level only: `cta:` names the action this slice records, and it is the
  // label a board edge carries. Read here rather than with a fourth inline
  // regex in whichever tool happens to need it (AD-2).
  const cta = (src.match(/^cta:\s*(\S+)/m) ?? [])[1] ?? null;
  for (const raw of src.split("\n")) {
    const t = raw.replace(/#.*$/, "").trim();
    const mo = t.match(/^object:\s*(.+)$/);
    if (mo) object = mo[1];
    const mf = t.match(/^- field:\s*(.+)$/);
    if (mf) fields.push({ field: mf[1], reads_from: null });
    const mr = t.match(/^reads_from:\s*(.+)$/);
    if (mr && fields.length > 0) fields[fields.length - 1].reads_from = mr[1];
  }
  return { object, cta, fields };
}

export function parseCtas(src) {
  const rows = [];
  let inCtas = false;
  let cur = null;
  for (const raw of src.split("\n")) {
    const line = raw.replace(/#.*$/, "").trimEnd();
    if (!line.trim()) continue;
    const indent = raw.length - raw.trimStart().length;
    if (indent === 0) {
      inCtas = line.startsWith("ctas:");
      cur = null;
      continue;
    }
    if (!inCtas) continue;
    const t = line.trim();
    if (t.startsWith("- ")) {
      cur = {};
      rows.push(cur);
      const m = t.slice(2).match(/^([\w-]+):\s*(.*)$/);
      if (m) cur[m[1]] = m[2];
    } else if (cur) {
      const m = t.match(/^([\w-]+):\s*(.*)$/);
      if (m) cur[m[1]] = m[2];
    }
  }
  return rows;
}

export function parseQoc(src) {
  const heading = (name) => src.search(new RegExp(`^## ${name}\\b`, "m"));
  const options = heading("Options");
  const criteria = heading("Criteria");
  const decision = heading("Decision");
  if (options < 0 || decision < 0) return null; // structurally unparseable
  const optionsBody = src.slice(options, [criteria, decision].filter((i) => i > options).sort((a, b) => a - b)[0] ?? src.length);
  const optionCount = (optionsBody.match(/^(\d+\.|- )/gm) ?? []).length;
  return { optionCount, criteriaBeforeDecision: criteria >= 0 && criteria < decision };
}

/** Slice content with the `mockup:` block removed, lines right-trimmed, \n endings. */
export function sliceWithoutMockup(src) {
  const lines = src.split("\n");
  const out = [];
  let inMockup = false;
  for (const raw of lines) {
    if (/^mockup:/.test(raw)) {
      inMockup = true;
      continue;
    }
    if (inMockup && /^\S/.test(raw)) inMockup = false;
    if (!inMockup) out.push(raw.replace(/\s+$/, ""));
  }
  return out.join("\n");
}

/** AD-2 hash contract: sha256 hex[0:12] of the mockup-free, right-trimmed
 *  slice with trailing newlines stripped. */
export function sliceContentHash(src) {
  return createHash("sha256")
    .update(sliceWithoutMockup(src).replace(/\n+$/, ""))
    .digest("hex")
    .slice(0, 12);
}

/** Top-level v2 block presence + the mockup flat map. */
export function parseSliceMeta(src) {
  const has = (key) => new RegExp(`^${key}:`, "m").test(src);
  const meta = {
    archetype: (src.match(/^archetype:\s*(\S+)/m) ?? [])[1] ?? null,
    hasWireframe: has("wireframe"),
    mockup: null,
  };
  const block = src.match(/^mockup:\n((?: .*\n?)*)/m);
  if (block) {
    const mockup = {};
    for (const line of block[1].split("\n")) {
      const m = line.trim().match(/^([\w-]+):\s*(.+)$/);
      if (m) mockup[m[1]] = m[2];
    }
    meta.mockup = mockup;
  }
  return meta;
}

/** Parse the ledger YAML subset: returns { terms: { name: {k:v|[]} } }. */
export function parseLedgerSubset(src) {
  const terms = {};
  let inTerms = false;
  let current = null;
  let pendingListKey = null;
  for (const raw of src.split("\n")) {
    const line = raw.replace(/#.*$/, "").trimEnd();
    if (!line.trim()) continue;
    const indent = raw.length - raw.trimStart().length;
    if (indent === 0) {
      inTerms = line.startsWith("terms:");
      current = null;
      pendingListKey = null;
      continue;
    }
    if (!inTerms) continue;
    if (indent === 2 && line.trim().endsWith(":")) {
      current = line.trim().slice(0, -1);
      terms[current] = {};
      pendingListKey = null;
      continue;
    }
    if (!current) continue;
    const t = line.trim();
    if (indent >= 4 && t.startsWith("- ")) {
      if (pendingListKey) {
        terms[current][pendingListKey].push(t.slice(2).trim());
      }
      continue;
    }
    const m = t.match(/^([\w-]+):\s*(.*)$/);
    if (!m) continue;
    const [, key, valueRaw] = m;
    pendingListKey = null;
    if (valueRaw === "" ) {
      terms[current][key] = [];
      pendingListKey = key;
    } else if (valueRaw.startsWith("[")) {
      terms[current][key] = valueRaw
        .replace(/^\[|\]$/g, "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      terms[current][key] = valueRaw.replace(/^["']|["']$/g, "");
    }
  }
  return { terms };
}

// ---------------------------------------------------------------------------
// Screen artifacts (design-preflight SD-4, AD-3, AD-4)
// ---------------------------------------------------------------------------

/**
 * Screen source with the approval-workflow blocks removed.
 *
 * `mockup:` and `rejections:` are excluded from the hash because both are
 * state ABOUT the approval, not the design being approved — recording a
 * rejection must not invalidate the thing it rejects.
 *
 * `route:` is excluded on the same principle, by QOC-design-011. An approval
 * covers what the screen LOOKS LIKE — archetype, wireframe, copy, walkthrough.
 * A route is where the screen is addressed from; changing `/studio/artifact/[id]`
 * to a nested path moves no pixel. Hashing it would send eight approved mockups
 * to `stale` for a change no reviewer could see, which is the same failure
 * QOC-design-007 fixed for comments.
 */
/**
 * Strip YAML comments for hashing purposes (AD-3, revised 2026-09-19 by
 * QOC-design-007).
 *
 * An approval covers the DESIGN — the archetype, the wireframe, the copy, the
 * walkthrough. It does not cover the prose explaining why. Before this, a
 * comment was hashed content, so editing a note above the `mockup:` block
 * invalidated a human's approval and demanded they approve the same design
 * again. That happened twice while building this feature, which is two more
 * times than a rule that trains people to re-stamp without looking should get.
 *
 * WHAT IS NOT A COMMENT, and must survive:
 *   - `#` inside a block scalar (`wireframe: |`). Box-drawing art and copy
 *     legitimately contain it; stripping there would mangle the very content
 *     the hash exists to protect.
 *   - `#` inside a quoted value — "Issue #12" is copy a user reads.
 *
 * A line that is ONLY a comment is dropped entirely rather than left blank,
 * so adding or removing a note does not shift the hash either way.
 */
export function withoutComments(src) {
  const out = [];
  let blockIndent = null;
  for (const raw of src.split("\n")) {
    const indent = raw.length - raw.trimStart().length;

    // Inside a block scalar: every more-indented line is content, verbatim.
    if (blockIndent !== null) {
      if (raw.trim() === "" || indent > blockIndent) {
        out.push(raw.replace(/\s+$/, ""));
        continue;
      }
      blockIndent = null;
    }
    if (/^\s*[\w-]+:\s*[|>][-+]?\s*$/.test(raw)) {
      blockIndent = indent;
      out.push(raw.replace(/\s+$/, ""));
      continue;
    }

    // Outside a block scalar: find a `#` that is not inside quotes.
    let quote = null;
    let cut = -1;
    for (let i = 0; i < raw.length; i += 1) {
      const c = raw[i];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === "#") {
        cut = i;
        break;
      }
    }
    if (cut === -1) {
      out.push(raw.replace(/\s+$/, ""));
      continue;
    }
    const kept = raw.slice(0, cut).replace(/\s+$/, "");
    // A whole-line comment leaves nothing — drop the line rather than keep a
    // blank, so a comment's presence never moves the hash.
    if (kept !== "") out.push(kept);
  }
  return out.join("\n");
}

/**
 * The slice content that belongs to ONE screen's approval (QOC-design-010).
 *
 * AD-3 as first written hashed contributing slice files WHOLE, so editing the
 * delete-confirm block of the delete slice staled the gallery too — a person
 * re-approved a screen on which nothing had moved. The chain's first run on a
 * real feature made that cost felt (commit 728f4914), and QOC-design-010
 * directed the scope-down.
 *
 * What a screen's approval covers, per contributing slice:
 *   - every top-level key (`object`, `cta`, `command`, `severity`, `surface`,
 *     `feedback`, `labels`, …) — those bind EVERY screen the slice feeds, so
 *     a severity or surface change still re-opens everyone, as it must
 *   - only THIS screen's `- screen:` block — a sibling's field list is not
 *     this screen's design (the QOC-design-007 principle, wider radius)
 *
 * FAILS CLOSED: an unnamed screen, or one this slice does not carry, returns
 * the whole file. Under-invalidating silently is worse than the disease.
 */
export function screenScopedSliceContent(sliceSrc, screen) {
  if (!screen || !parseSliceScreens(sliceSrc).includes(screen)) return sliceSrc;
  const out = [];
  let inScreens = false;
  let keepBlock = false;
  for (const raw of sliceSrc.split("\n")) {
    // MATCH against the comment-stripped line; EMIT the raw one. The shipped
    // slices write \`- screen: gallery   # updated by the event\`, and matching
    // the raw line let a trailing comment defeat block detection — blocks
    // mis-attached to whichever screen came before, which is the silent
    // under-invalidation the QOC named as worse than the disease. Found by
    // the migration itself: the single-screen slice changed and the
    // three-screen one did not, exactly inverted.
    const line = raw.replace(/#.*$/, "").trimEnd();
    const isTop = /^\S/.test(line);
    if (isTop) {
      inScreens = /^screens:/.test(line);
      keepBlock = false;
      out.push(raw);
      continue;
    }
    if (!inScreens) {
      out.push(raw);
      continue;
    }
    const m = line.match(/^(\s*)-\s+screen:\s*([\w-]+)\s*$/);
    if (m) {
      keepBlock = m[2] === screen;
      if (keepBlock) out.push(raw);
      continue;
    }
    if (keepBlock) out.push(raw);
  }
  return out.join("\n");
}

export function screenWithoutApproval(src) {
  const out = [];
  let skipping = false;
  for (const raw of src.split("\n")) {
    if (/^(mockup|rejections|route):/.test(raw)) {
      skipping = true;
      continue;
    }
    if (skipping && /^\S/.test(raw)) skipping = false;
    if (!skipping) out.push(raw.replace(/\s+$/, ""));
  }
  return out.join("\n");
}

/**
 * The AD-3 hash: the screen plus every slice that contributes to it.
 *
 * Supersedes md-ux-craft AD-2, which hashed a single slice on the assumption
 * that one slice equals one screen. Studio disproves that — `gallery` is named
 * by three slices — so an approval scoped to one of them would stay valid while
 * another changed the screen underneath it.
 *
 * `sliceSources` must already be ordered (callers sort by filename) so the hash
 * is stable; deriving the set by scanning rather than recording it is AD-4, and
 * means adding a CTA to a screen invalidates its approval by itself.
 */
export function screenContentHash(screenSrc, sliceSources = []) {
  // Comments are stripped from BOTH sides: a note added to a contributing
  // slice is no more a design change than one added to the screen.
  // Each part is trimmed of trailing blank lines BEFORE joining. Trimming
  // only the joined string leaves a part's trailing blanks buried in the
  // middle, where they still move the digest — which is how removing a
  // comment at the end of a file changed the hash even though the comment
  // itself was stripped. Found by adding a comment to an approved screen and
  // watching the gate fail anyway.
  // Each slice contributes only what binds THIS screen (QOC-design-010):
  // its shared top-level keys and this screen's own block. The screen's name
  // is read from the source being hashed, so every caller keeps its signature.
  const screenName = parseScreen(screenSrc).screen;
  const parts = [withoutComments(screenWithoutApproval(screenSrc))]
    .concat(
      sliceSources.map((sliceSrc) =>
        withoutComments(screenScopedSliceContent(sliceSrc, screenName)),
      ),
    )
    .map((part) => part.replace(/\n+$/, ""));
  return createHash("sha256")
    .update(parts.join("\n"))
    .digest("hex")
    .slice(0, 12);
}

/** Screen ids a slice references (schema v3: `- screen: <id>` under `screens:`). */
export function parseSliceScreens(src) {
  const ids = [];
  let inScreens = false;
  for (const raw of src.split("\n")) {
    const line = raw.replace(/#.*$/, "").trimEnd();
    if (!line.trim()) continue;
    if (/^\S/.test(line)) {
      inScreens = /^screens:/.test(line);
      continue;
    }
    if (!inScreens) continue;
    const m = line.trim().match(/^-\s+screen:\s*([\w-]+)$/);
    if (m) ids.push(m[1]);
  }
  return ids;
}

/** Screen artifact metadata: archetype, approval state, and the rejection log. */
export function parseScreen(src) {
  const scalar = (key) => (src.match(new RegExp(`^${key}:\\s*(\\S+)`, "m")) ?? [])[1] ?? null;
  const meta = {
    context: scalar("context"),
    screen: scalar("screen"),
    archetype: scalar("archetype"),
    hasWireframe: /^wireframe:/m.test(src),
    copyVariants: [],
    mockup: null,
    rejections: [],
  };
  const copy = src.match(/^copy:\n((?:[ \t].*\n?)*)/m);
  if (copy) {
    for (const line of copy[1].split("\n")) {
      const m = line.match(/^\s{4}([\w_]+):/);
      if (m) meta.copyVariants.push(m[1]);
    }
  }
  const mockup = src.match(/^mockup:\n((?: .*\n?)*)/m);
  if (mockup) {
    const block = {};
    for (const line of mockup[1].split("\n")) {
      const m = line.trim().match(/^([\w-]+):\s*(.+)$/);
      if (m) block[m[1]] = m[2];
    }
    meta.mockup = block;
  }
  const rej = src.match(/^rejections:\n((?:[ \t].*\n?)*)/m);
  if (rej) {
    let cur = null;
    for (const raw of rej[1].split("\n")) {
      const t = raw.trim();
      if (!t) continue;
      if (t.startsWith("- ")) {
        cur = {};
        meta.rejections.push(cur);
        const m = t.slice(2).match(/^([\w-]+):\s*(.*)$/);
        if (m) cur[m[1]] = m[2];
      } else if (cur) {
        const m = t.match(/^([\w-]+):\s*(.*)$/);
        if (m) cur[m[1]] = m[2];
      }
    }
  }
  return meta;
}

/**
 * A screen's empty, no-result and error copy.
 *
 * `parseScreen` records only WHICH variants exist, because the gate only ever
 * needed the names. The renderer grew its own regex for the text, which read
 * `copy.empty.*` and silently ignored `copy.errors` — so every mockup showed
 * four empty states and none of the recorded error cases. One parser, both
 * callers (AD-2).
 */
export function parseScreenCopy(src) {
  const out = { empty: {}, errors: [] };
  const block = src.match(/^copy:\n((?:[ \t].*\n?)*)/m);
  if (!block) return out;
  let section = null;
  let cur = null;
  for (const raw of block[1].split("\n")) {
    if (!raw.trim()) continue;
    const head = raw.match(/^\s{2}([\w_]+):\s*$/);
    if (head) { section = head[1]; cur = null; continue; }
    if (section === "errors") {
      const item = raw.match(/^\s{4}-\s*([\w-]+):\s*"?(.*?)"?\s*$/);
      if (item) { cur = { [item[1]]: item[2] }; out.errors.push(cur); continue; }
      const kv = raw.match(/^\s{6}([\w-]+):\s*"?(.*?)"?\s*$/);
      if (kv && cur) cur[kv[1]] = kv[2];
      continue;
    }
    // A two-space scalar is copy that belongs to the page itself rather than
    // to a state — the description under the page title.
    const scalar = raw.match(/^\s{2}([\w_]+):\s*"(.*)"\s*$/);
    if (scalar) { out[scalar[1]] = scalar[2]; continue; }
    const kv = raw.match(/^\s{4}([\w_]+):\s*"?(.*?)"?\s*$/);
    if (kv) out.empty[kv[1]] = kv[2];
  }
  return out;
}

/**
 * OOUX bindings emitted by a mockup (design-preflight DP-FR-004).
 *
 * Attribute-prefix regex, not an HTML parser: the gate ships with zero npm
 * dependencies (DP-NFR-002), and `data-wp-*` is flat by construction precisely
 * so this stays a scan rather than a parse.
 *
 * Returns null when the input has no bindings at all and no <html> —
 * an unreadable mockup is a finding, never a silent pass (DP-FR-051).
 */
export function parseMockupBindings(html) {
  if (typeof html !== "string" || (!/data-wp-/.test(html) && !/<html/i.test(html))) return null;
  const attrs = (tag) => {
    const out = {};
    for (const m of tag.matchAll(/data-wp-([\w-]+)="([^"]*)"/g)) out[m[1]] = m[2];
    return out;
  };
  const screenTag = html.match(/<[^>]*data-wp-screen="[^"]*"[^>]*>/);
  const controls = [];
  for (const tag of html.matchAll(/<(?:button|a)\b[^>]*>/g)) {
    const a = attrs(tag[0]);
    if (a.cta) controls.push(a);
  }
  const fields = [];
  for (const tag of html.matchAll(/<[^>]*data-wp-field="[^"]*"[^>]*>/g)) {
    fields.push(attrs(tag[0]));
  }
  return {
    screen: screenTag ? attrs(screenTag[0]).screen ?? null : null,
    controls,
    fields,
    hasScript: /<script/i.test(html),
  };
}

// ── Object maps ──────────────────────────────────────────────────────────
//
// The object map carries what a consuming developer actually asks for:
// which attributes are core vs metadata, what a card shows, how one object
// is reached from another. Before T13 this file reached the projection with
// `parsed: {}` — stored but unqueryable — so `design_context("studio.artifact")`
// would have had to re-read and scan the YAML at request time. These readers
// close that gap inside the one parser module rather than beside it.

/** Strip a trailing `#` comment, ignoring `#` inside quoted strings. */
function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === "#") {
      return line.slice(0, i).trimEnd();
    }
  }
  return line.trimEnd();
}

/** Split on commas that are not inside quotes or parentheses. */
function splitTopLevel(body) {
  const out = [];
  let buf = "";
  let quote = null;
  let depth = 0;
  for (const c of body) {
    if (quote) {
      if (c === quote) quote = null;
      buf += c;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; buf += c; continue; }
    if (c === "(" || c === "[") depth += 1;
    if (c === ")" || c === "]") depth -= 1;
    if (c === "," && depth === 0) { out.push(buf); buf = ""; continue; }
    buf += c;
  }
  if (buf.trim()) out.push(buf);
  return out.map((s) => s.trim()).filter(Boolean);
}

const unquote = (v) => {
  const t = v.trim();
  if (t.length > 1 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0]) {
    return t.slice(1, -1);
  }
  return t;
};

/** `{ name: sections, class: core, rank: 1 }` → object. Values keep their text. */
export function parseFlowMap(text) {
  const body = text.trim().replace(/^\{/, "").replace(/\}$/, "");
  const row = {};
  for (const pair of splitTopLevel(body)) {
    const m = pair.match(/^([\w-]+):\s*([\s\S]*)$/);
    if (!m) continue;
    const value = unquote(m[2]);
    row[m[1]] = value === "" ? null : value;
  }
  return row;
}

/** `[a, b, c]` → array; `[]` → []. */
function parseFlowList(text) {
  const body = text.trim().replace(/^\[/, "").replace(/\]$/, "");
  return splitTopLevel(body).map(unquote);
}

/**
 * Object map → { version, context, objects, navigation }.
 *
 * `objects` is keyed by object name so a lookup is a key access, not a find.
 * Each carries definition, attributes (with class/rank), card_fields,
 * default_sort, nested and relationships (with representation).
 */
export function parseObjectMap(src) {
  const out = { version: null, context: null, objects: {}, navigation: {} };
  const lines = src.split("\n");

  // Top-level scalars.
  const top = (key) => {
    const m = src.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
    return m ? unquote(stripComment(m[1])) : null;
  };
  out.version = top("version");
  out.context = top("context");

  let section = null;       // "objects" | "navigation" | null
  let current = null;       // current object name
  let listKey = null;       // attributes | relationships
  let folded = null;        // { key, parts } while reading a `>-` block
  let foldIndent = 0;

  for (const raw of lines) {
    if (!raw.trim()) { if (folded) folded.parts.push(""); continue; }
    const indent = raw.length - raw.trimStart().length;

    // A folded scalar swallows every MORE-indented line verbatim.
    if (folded) {
      if (indent > foldIndent) { folded.parts.push(raw.trim()); continue; }
      out.objects[folded.owner][folded.key] = folded.parts.join(" ").trim();
      folded = null;
    }

    const line = stripComment(raw);
    if (!line.trim()) continue;

    if (indent === 0) {
      section = line.startsWith("objects:") ? "objects"
        : line.startsWith("navigation:") ? "navigation"
        : null;
      current = null;
      listKey = null;
      continue;
    }

    if (section === "navigation") {
      const m = line.trim().match(/^([\w-]+):\s*(.*)$/);
      if (indent === 2 && m) {
        listKey = m[1];
        if (m[2] === "") { out.navigation[m[1]] = []; }
        else if (m[2].startsWith("[")) { out.navigation[m[1]] = parseFlowList(m[2]); listKey = null; }
        else { out.navigation[m[1]] = unquote(m[2]); listKey = null; }
        continue;
      }
      if (listKey && line.trim().startsWith("- ")) {
        const item = line.trim().slice(2).trim();
        out.navigation[listKey].push(item.startsWith("{") ? parseFlowMap(item) : unquote(item));
      }
      continue;
    }

    if (section !== "objects") continue;

    // `  artifact:` — a new object.
    if (indent === 2 && line.trim().endsWith(":")) {
      current = line.trim().slice(0, -1);
      out.objects[current] = {
        definition: null, attributes: [], card_fields: [],
        default_sort: null, nested: [], relationships: [],
      };
      listKey = null;
      continue;
    }
    if (!current) continue;

    // `    - { ... }` under attributes/relationships.
    if (line.trim().startsWith("- ")) {
      if (!listKey) continue;
      const item = line.trim().slice(2).trim();
      out.objects[current][listKey].push(item.startsWith("{") ? parseFlowMap(item) : unquote(item));
      continue;
    }

    const m = line.trim().match(/^([\w-]+):\s*(.*)$/);
    if (!m) continue;
    const [, key, valueRaw] = m;
    listKey = null;

    if (valueRaw === ">-" || valueRaw === ">" || valueRaw === "|" || valueRaw === "|-") {
      folded = { owner: current, key, parts: [] };
      foldIndent = indent;
      continue;
    }
    if (valueRaw === "") { out.objects[current][key] = []; listKey = key; continue; }
    if (valueRaw.startsWith("[")) { out.objects[current][key] = parseFlowList(valueRaw); continue; }
    const v = unquote(valueRaw);
    out.objects[current][key] = v === "null" ? null : v;
  }

  if (folded) out.objects[folded.owner][folded.key] = folded.parts.join(" ").trim();
  return out;
}

/**
 * `navigation.reachability` rows: how each object is reached, and as what.
 * Kept as its own export because the board reads only this slice — it was
 * living in build-board.mjs, which made it a second parser (AD-2).
 */
export function parseReachability(src) {
  const nav = parseObjectMap(src).navigation;
  const rows = Array.isArray(nav.reachability) ? nav.reachability : [];
  return rows
    .filter((r) => r && typeof r === "object" && r.object)
    .map((r) => ({
      object: r.object,
      via: r.via ?? null,
      representation: r.representation ?? null,
    }));
}

// ── Explanation readers (T13) ────────────────────────────────────────────
//
// `design_explain` answers "why is it this way", which means reading the
// prose the gate only ever counted: a QOC's title and its decision, and a
// screen's walkthrough findings. These are additive — parseQoc's existing
// shape is untouched, so the gate checks that depend on it cannot shift.

/** Title, question, and decision text of a QOC record. */
export function parseQocNarrative(src) {
  const title = (src.match(/^#\s+(.+)$/m) ?? [])[1] ?? null;
  const section = (name) => {
    const re = new RegExp(`^##\\s+${name}\\b.*$`, "m");
    const m = src.match(re);
    if (!m || m.index === undefined) return null;
    const start = m.index + m[0].length;
    const rest = src.slice(start);
    const next = rest.search(/^##\s+/m);
    return rest.slice(0, next < 0 ? rest.length : next).trim() || null;
  };
  // A ratified resolution supersedes the decision; report both so a consumer
  // can see that a decision was revisited rather than silently replaced.
  const resolutionHeading = (src.match(/^##\s+(Resolution\b.*)$/m) ?? [])[1] ?? null;
  return {
    title,
    question: section("Question"),
    decision: section("Decision"),
    resolution: resolutionHeading ? section("Resolution") : null,
    resolutionHeading,
  };
}

/**
 * `walkthrough:` entries — the heuristic review's findings and how each was
 * resolved. Advisory by doctrine, but they are the record of what a human
 * noticed, which is exactly what a later implementer needs.
 */
export function parseWalkthrough(src) {
  const block = src.match(/^walkthrough:\n((?:[ \t].*\n?|\n)*)/m);
  if (!block) return [];
  const rows = [];
  let cur = null;
  let foldKey = null;
  let foldParts = [];
  const flush = () => {
    if (cur && foldKey) cur[foldKey] = foldParts.join(" ").replace(/\s+/g, " ").trim();
    foldKey = null;
    foldParts = [];
  };
  for (const raw of block[1].split("\n")) {
    if (!raw.trim()) continue;
    const t = raw.trim();
    const isItem = t.startsWith("- ");
    const body = isItem ? t.slice(2).trim() : t;
    const m = body.match(/^([\w-]+):\s*(.*)$/);
    if (isItem) {
      flush();
      cur = {};
      rows.push(cur);
    }
    if (!cur) continue;
    if (m) {
      const [, key, value] = m;
      if (value === ">-" || value === ">" || value === "|" || value === "|-") {
        flush();
        foldKey = key;
        foldParts = [];
      } else {
        flush();
        cur[key] = value;
      }
      continue;
    }
    if (foldKey) foldParts.push(t);
  }
  flush();
  return rows;
}

// ── Board edges (T14) ────────────────────────────────────────────────────
//
// Extracted from build-board so the Atlas and the generated board data file
// derive edges through ONE function. Reimplementing it in the read model
// silently dropped T10's narrowing rule and drew 9 edges where the board
// draws 6 — the same fan-out defect T10 had already fixed. Derivation needs
// the discipline AD-2 puts on parsing: one implementation, many callers.
//
// PURE. Takes already-parsed data, does no IO.

/**
 * A reachability row records a REPRESENTATION, and representations land on
 * particular screen shapes: an embedded-list or a count is rendered by the
 * object's list screen, a link or inline-card by its detail screen.
 */
function wantedArchetype(rep) {
  if (rep === "embedded-list" || rep === "count") return "list";
  if (rep === "link" || rep === "inline-card") return "detail";
  return null;
}

/**
 * Edges between screens, from the three recorded sources only. An edge that
 * cannot name its source is not drawn — the board shows what the artifacts
 * say, not what a layout engine guesses.
 *
 * THIS FILE IS A RENDER TEMPLATE. It is seeded to every project through the
 * bundle, which renders templates with Liquid — so a literal `{` followed by
 * another `{` opens an output tag and fails tokenization. JSDoc's object-shape
 * syntax produces exactly that, so shapes are written in prose here:
 *
 *   screens       Array of { id, archetype } — archetype may be null
 *   slices        Array of { object, screens, cta } — object and cta nullable
 *   reachability  Array of { object, via, representation }
 */
export function boardEdges(screens, slices, reachability = []) {
  const known = new Set(screens.map((n) => n.id));
  const archetypeOf = new Map(screens.map((n) => [n.id, n.archetype ?? null]));
  const edges = [];
  const seen = new Set();
  const push = (from, to, via, label) => {
    if (from === to || !known.has(from) || !known.has(to)) return;
    const key = `${from}>${to}>${via}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ from, to, via, ...(label ? { label } : {}) });
  };

  // 1. cta — a slice's own screen ordering is the transition it records.
  for (const s of slices) {
    for (let i = 0; i < s.screens.length - 1; i += 1) {
      push(s.screens[i], s.screens[i + 1], "cta", s.cta ?? undefined);
    }
  }

  // 2. navigation — reachability rows, objects mapped to the screens whose
  //    slices carry them, narrowed by the recorded representation.
  const screensOf = (obj) =>
    Array.from(new Set(slices.filter((s) => s.object === obj).flatMap((s) => s.screens)));
  const narrow = (candidates, rep) => {
    const want = wantedArchetype(rep);
    const match = want ? candidates.filter((id) => archetypeOf.get(id) === want) : [];
    // Fall back only when no screen declares the shape yet — pre-contract
    // screens carry no archetype, so the board is coarse until design.flow
    // reaches them, and coarse-but-labelled beats invented precision.
    return match.length > 0 ? match : candidates;
  };
  for (const row of reachability) {
    for (const from of screensOf(row.via)) {
      for (const to of narrow(screensOf(row.object), row.representation)) {
        push(from, to, "navigation", row.object);
      }
    }
  }

  // 3. machine — supported by the schema; emitted only where a statechart
  //    transitions BETWEEN screens rather than within one.

  edges.sort((a, b) =>
    `${a.from}${a.to}${a.via}`.localeCompare(`${b.from}${b.to}${b.via}`),
  );
  return edges;
}

// ── Familiarity (T16) ────────────────────────────────────────────────────

/**
 * `design/familiarity.yaml` — per-gate-class first contact and learn taps.
 * Machine-written, project-scoped. Returns {} for an absent or empty `seen:`.
 */
export function parseFamiliarity(src) {
  const seen = {};
  let inSeen = false;
  let current = null;
  for (const raw of src.split("\n")) {
    const line = raw.replace(/#.*$/, "").trimEnd();
    if (!line.trim()) continue;
    const indent = raw.length - raw.trimStart().length;
    if (indent === 0) {
      // `seen: {}` is the empty form a fresh project ships with.
      inSeen = /^seen:/.test(line) && !/^seen:\s*\{\s*\}/.test(line);
      current = null;
      continue;
    }
    if (!inSeen) continue;
    if (indent === 2 && line.trim().endsWith(":")) {
      current = line.trim().slice(0, -1);
      seen[current] = {};
      continue;
    }
    if (!current) continue;
    const m = line.trim().match(/^([\w-]+):\s*(.+)$/);
    if (!m) continue;
    const value = m[2].trim();
    seen[current][m[1]] = /^\d+$/.test(value) ? Number(value) : value;
  }
  return seen;
}

/** Serialize familiarity back, deterministically — sorted, no timestamps. */
export function renderFamiliarity(seen, header) {
  const ids = Object.keys(seen).sort((a, b) => a.localeCompare(b));
  const lines = [header.replace(/\n$/, ""), "version: 1"];
  if (ids.length === 0) {
    lines.push("seen: {}");
    return `${lines.join("\n")}\n`;
  }
  lines.push("seen:");
  for (const id of ids) {
    lines.push(`  ${id}:`);
    for (const key of Object.keys(seen[id]).sort((a, b) => a.localeCompare(b))) {
      lines.push(`    ${key}: ${seen[id][key]}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Routes a screen declares (schema v2, QOC-design-011).
 *
 * A screen carries EITHER `path` (addressable) or `parent` + `relation`
 * (a region or overlay of another screen). Two forms are accepted:
 *
 *   route:                      route:
 *     path: /studio/...           - path: /academy/manage/tracks/[trackId]
 *     guards: [...]               - path: /academy/manage/modules/[moduleId]
 *
 * The list form exists because one screen can legitimately serve several
 * routes — academy's manage-editor edits tracks and modules through the same
 * contract. Returns [] when the screen declares no route at all, which is
 * itself a finding for the caller rather than an error here.
 */
export function parseScreenRoutes(src) {
  const block = src.match(/^route:\s*\n((?:[ \t].*\n?|\n(?=[ \t]))*)/m);
  if (!block) return [];
  const body = block[1].replace(/\n+$/, "");
  if (!body.trim()) return [];

  // Comments never carry routing facts; strip before the shape test so a
  // commented-out list item cannot flip the parse between forms.
  const lines = body
    .split("\n")
    .filter((l) => l.trim() && !/^\s*#/.test(l));

  const isList = lines.some((l) => /^\s*-\s/.test(l));
  const chunks = [];
  if (isList) {
    let cur = null;
    for (const raw of lines) {
      if (/^\s*-\s/.test(raw)) {
        if (cur) chunks.push(cur);
        cur = [raw.replace(/^\s*-\s/, "  ")];
      } else if (cur) {
        cur.push(raw);
      }
    }
    if (cur) chunks.push(cur);
  } else {
    chunks.push(lines);
  }

  return chunks.map((chunk) => {
    const text = chunk.join("\n");
    const val = (k) => (text.match(new RegExp(`^\\s*${k}:\\s*(.+)$`, "m")) ?? [])[1]?.trim() ?? null;
    const flat = (k) => {
      const v = val(k);
      return v === null ? null : v.replace(/\s*#.*$/, "").trim();
    };
    const binds = {};
    const bindRaw = flat("binds");
    if (bindRaw) {
      for (const m of bindRaw.matchAll(/([\w-]+)\s*:\s*([^,}]+)/g)) {
        binds[m[1].trim()] = m[2].trim();
      }
    }
    const guardRaw = flat("guards");
    const guards = guardRaw
      ? guardRaw.replace(/^\[|\]$/g, "").match(/\{[^}]*\}|[^,]+/g)?.map((g) => g.trim()).filter(Boolean) ?? []
      : [];
    return {
      path: flat("path"),
      query: flat("query"),
      parent: flat("parent"),
      relation: flat("relation"),
      canonical: flat("canonical"),
      modeOf: flat("mode_of"),
      entry: flat("entry") === "true",
      binds,
      guards,
    };
  });
}

// ── Design graph ─────────────────────────────────────────────────────────
//
// Moved here when the standalone board renderer was retired. Both are pure
// over their inputs, which is what parsers.mjs is for — and keeping them in a
// renderer meant the in-app workspace imported a tool it never rendered with.

/**
 * The data-wp-* bindings a mockup actually carries.
 *
 * Read from the rendered HTML rather than recomputed from the artifacts, on
 * purpose: the workspace must show what the mockup SAYS, so a binding that
 * drifted from its source is visible here instead of being silently corrected.
 */
export function bindingsOf(html) {
  const all = (name) => [
    ...new Set([...html.matchAll(new RegExp(`data-wp-${name}="([^"]*)"`, "g"))].map((m) => m[1])),
  ];
  return {
    objects: all("object"),
    attrs: all("attr"),
    fields: all("field"),
    rels: all("rel"),
    relAs: all("rel-as"),
    ctas: all("cta"),
    commands: all("command"),
    reads: all("reads-from").filter(Boolean),
  };
}

/**
 * Depth from the nearest entry point — what `rank` was always documented to
 * mean. build-board assigns rank by filename, so `artifact-page` sorts to 0
 * and reads as an entry point; the canvas needs the real thing.
 *
 * Three sources, in precedence order: a screen anchored to a parent sits one
 * below it, a screen that is a MODE of another shares its depth (a filter is
 * not a step), and anything else takes its shallowest incoming edge.
 */
export function depths(screens, edges, entry) {
  const reached = new Set();
  const by = Object.fromEntries(screens.map((s) => [s.screen, s]));
  const tail = (v) => (v ? String(v).split(".").pop() : null);
  const parentOf = (n) => tail(by[n]?.routes?.find((r) => r.parent)?.parent);
  const modeOf = (n) => tail(by[n]?.routes?.find((r) => r.modeOf)?.modeOf);
  const d = {};
  for (const e of entry) if (by[e]) { d[e] = 0; reached.add(e); }

  for (let pass = 0; pass < screens.length + 2; pass++) {
    let moved = false;
    for (const s of screens) {
      if (d[s.screen] !== undefined) continue;
      const p = parentOf(s.screen);
      const m = modeOf(s.screen);
      let v;
      if (p && d[p] !== undefined) v = d[p] + 1;
      else if (m && d[m] !== undefined) v = d[m];
      else {
        const nav = edges.filter((e) => e.to === s.screen && e.via === "navigation" && d[e.from] !== undefined);
        const any = edges.filter((e) => e.to === s.screen && d[e.from] !== undefined);
        const pool = nav.length ? nav : any;
        if (pool.length) v = Math.min(...pool.map((e) => d[e.from])) + 1;
      }
      if (v !== undefined) { d[s.screen] = v; reached.add(s.screen); moved = true; }
    }
    if (!moved) break;
  }
  // A screen no chain of edges reaches from an entry point still has to go
  // somewhere on the canvas, so it is parked past the deepest column — but the
  // guess is reported rather than dressed up as a depth. A context that
  // declares no entry points at all reaches nothing, which is the finding.
  const max = Math.max(0, ...Object.values(d));
  const unreachable = [];
  for (const s of screens) {
    if (d[s.screen] === undefined) { d[s.screen] = max + 1; }
    if (!reached.has(s.screen)) unreachable.push(s.screen);
  }
  return { depth: d, unreachable };
}
