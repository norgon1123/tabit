/**
 * Capture — the measured half of the audit (agg:design.survey-census).
 *
 * One `DOMSnapshot.captureSnapshot` per route x state yields, in a single
 * round trip: the flattened DOM, whitelisted computed styles, and layout
 * boxes. From those three the stage derives four artifacts:
 *
 *   census    — style values weighted by PAINTED AREA, not frequency
 *   skeleton  — region tree with true proportions and repeat groups
 *   controls  — interactive elements with verbatim labels (feeds derive)
 *   landmarks — the accessibility tree's regions
 *
 * Area weighting is the point. The pilot found 12px to be the most FREQUENT
 * font size while 13px owned the paint: a census that counted nodes would
 * have reported the wrong body size with total confidence. Neither number is
 * visible in any stylesheet.
 *
 * A state that cannot be reached is recorded `unreachable` with the reason.
 * Silently skipping it would make a partial sweep indistinguishable from a
 * complete one — the same class of lie as a gate that checks nothing and
 * exits 0.
 */

import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { candidateModuleDirs } from "../run.mjs";
import { provenanceBlock, provenanceHeader } from "../provenance.mjs";
import {
  markCaptured,
  markUnreachable,
  parseRoutesFile,
  parseRoutesFindings,
  pendingRows,
  renderRoutesFile,
} from "../routes.mjs";
import { readSurvey, writeSurvey, yamlList } from "../survey-io.mjs";

/** Computed styles worth the bytes: the vocabulary a design system governs. */
export const CAPTURED_STYLES = [
  "color",
  "background-color",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "border-radius",
  "border-color",
  "gap",
  "padding-top",
  "padding-left",
  "margin-top",
  "box-shadow",
];

/** Tags that can plausibly BE a region rather than sit inside one. */
const REGION_TAGS = new Set([
  "DIV", "MAIN", "NAV", "ASIDE", "HEADER", "FOOTER",
  "SECTION", "TABLE", "UL", "OL", "FORM", "ARTICLE", "DIALOG",
]);

/**
 * Import Playwright FROM THE AUDITED REPO.
 *
 * The runner is bundle-copied into target repos, and Node resolves modules
 * from the importing file's location — so a naive `import("playwright")`
 * looks in the wrong node_modules and fails on a repo that has it installed.
 * Resolving against the audited repo (and its nested app dirs, because
 * monorepos keep the browser one level in) is what makes T1 work at all.
 */
export async function loadPlaywright(repoRoot) {
  for (const dir of candidateModuleDirs(repoRoot)) {
    for (const pkg of ["playwright", "@playwright/test"]) {
      try {
        const require = createRequire(join(dir, "package.json"));
        const resolved = require.resolve(pkg);
        const mod = await import(`file://${resolved}`);
        const chromium = mod.chromium ?? mod.default?.chromium;
        if (chromium) return { chromium, from: dir, pkg };
      } catch {
        // Not here; try the next candidate. A repo without Playwright is a
        // legitimate T3 audit, not an error.
      }
    }
  }
  return null;
}

/**
 * Relay cross-origin API calls through the browser context.
 *
 * Playwright fulfils a routed request itself, which sidesteps CORS without
 * touching the application or the browser's security flags — the same trick
 * the audited app's own e2e helpers use. Without it a multi-port local stack
 * renders its shell and nothing else.
 */
export async function installRelay(context, envContract) {
  const origins = String(envContract?.relayOrigins ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (origins.length === 0) return 0;
  for (const origin of origins) {
    await context.route(`${origin.replace(/\/$/, "")}/**`, async (route) => {
      try {
        await route.fulfill({ response: await route.fetch() });
      } catch {
        // Teardown can interrupt an in-flight relay; there is nothing left to
        // fulfil and the interruption must not fail the sweep.
      }
    });
  }
  return origins.length;
}

/**
 * Did this sweep actually see the application?
 *
 * A capture where every screen offers the same handful of controls is a
 * capture of navigation chrome — the app booted, the data did not arrive, and
 * every downstream conclusion is about a page nobody uses. Saying so is the
 * difference between a wrong report and a report that knows it is wrong.
 */
export function looksLikeChromeOnly(controls, screenCount) {
  if (screenCount < 3) return null;
  const distinct = new Set(controls.map((c) => String(c.label ?? "").toLowerCase()));
  if (distinct.size > Math.max(6, screenCount / 4)) return null;
  return {
    distinct: distinct.size,
    screens: screenCount,
    sample: [...distinct].slice(0, 5),
  };
}

// ── pure derivations (testable without a browser) ─────────────────────────

/**
 * Fold one snapshot into census rows, weighted by painted area.
 *
 * `snapshot` is CDP's DOMSnapshot shape; keeping this pure is what lets the
 * area-weighting rule — the single most load-bearing decision in the stage —
 * be tested against a fixture instead of a live page.
 */
export function censusFrom(snapshot, styles = CAPTURED_STYLES) {
  const doc = snapshot.documents[0];
  const S = snapshot.strings;
  const layout = doc.layout;
  const rows = new Map();
  for (let i = 0; i < layout.nodeIndex.length; i++) {
    const [, , w, h] = layout.bounds[i];
    const area = Math.max(0, w) * Math.max(0, h);
    const styleIdx = layout.styles[i] ?? [];
    styleIdx.forEach((valIdx, propIdx) => {
      if (valIdx === -1 || valIdx === undefined) return;
      const prop = styles[propIdx];
      const value = S[valIdx];
      if (value === undefined) return;
      const key = `${prop} ${value}`;
      const row = rows.get(key) ?? { property: prop, value, count: 0, area: 0 };
      row.count++;
      row.area += area;
      rows.set(key, row);
    });
  }
  return [...rows.values()];
}

/** Merge census rows across screens, remembering which screens showed each value. */
export function mergeCensus(into, rows, screenKey) {
  for (const r of rows) {
    const key = `${r.property} ${r.value}`;
    const prev = into.get(key);
    if (prev) {
      prev.count += r.count;
      prev.area += r.area;
      prev.screens.add(screenKey);
    } else {
      into.set(key, { ...r, screens: new Set([screenKey]) });
    }
  }
  return into;
}

/**
 * Regions and repeat groups from layout boxes.
 *
 * Repeat detection (same class, >=3 instances, similar height) is what turns
 * "a big box" into "a list of 140px cards" — the fact that made the pilot's
 * skeleton mockups legible, and the fact that proved two approved wireframes
 * had the wrong page shape.
 */
export function skeletonFrom(snapshot, viewport) {
  const doc = snapshot.documents[0];
  const S = snapshot.strings;
  const layout = doc.layout;
  const names = doc.nodes.nodeName;
  const attrs = doc.nodes.attributes;
  const vpArea = viewport.width * viewport.height;

  const boxes = [];
  for (let i = 0; i < layout.nodeIndex.length; i++) {
    const nodeIdx = layout.nodeIndex[i];
    const [x, y, w, h] = layout.bounds[i];
    if (w * h < vpArea * 0.005) continue;
    const tag = S[names[nodeIdx]];
    if (!REGION_TAGS.has(tag)) continue;
    boxes.push({
      x, y, w, h,
      tag: tag.toLowerCase(),
      cls: attrValue(S, attrs[nodeIdx], "class")?.split(" ")[0] ?? "",
      role: attrValue(S, attrs[nodeIdx], "role") ?? null,
    });
  }

  const byCls = new Map();
  for (const b of boxes) {
    if (!b.cls) continue;
    const list = byCls.get(b.cls) ?? [];
    list.push(b);
    byCls.set(b.cls, list);
  }
  const repeats = [];
  const repeated = new Set();
  for (const [cls, group] of byCls) {
    if (group.length < 3) continue;
    const avg = group.reduce((s, g) => s + g.h, 0) / group.length;
    if (avg <= 0) continue;
    if (!group.every((g) => Math.abs(g.h - avg) < avg * 0.35)) continue;
    repeats.push({
      class: cls,
      instances: group.length,
      rowHeight: Math.round(avg),
      width: Math.round(group[0].w),
    });
    repeated.add(cls);
  }

  const regions = boxes
    .filter(
      (b) =>
        b.w * b.h >= vpArea * 0.03 &&
        b.w * b.h <= vpArea * 0.92 &&
        !repeated.has(b.cls),
    )
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .slice(0, 24)
    .map((b) => ({
      atX: round2(b.x / viewport.width),
      atY: round2(b.y / viewport.height),
      w: round2(b.w / viewport.width),
      h: round2(b.h / viewport.height),
      tag: b.tag,
      class: b.cls || null,
      role: b.role,
    }));

  return { regions, repeats };
}

/**
 * Repeat-group MEMBERS, with the text inside them — FR-DA-045's input.
 *
 * `skeletonFrom` answers "there are 12 boxes of class X, 84px tall". That is
 * what a wireframe needs and it is silent on content, so it cannot yield
 * `card_fields`. Deriving objects needs the text inside each member and a path
 * back to the node it came from, which is why this is a THIRD fold over the
 * same snapshot rather than an extension of the skeleton — whose emitted file
 * is a published contract the renderer already consumes (ADR-DA-8).
 *
 * EXTRACTION ONLY. Grouping judgement, partial tree alignment and ranking live
 * in derive-objects.mjs. A protocol-shaped module that decided what counts as
 * an object would own a design judgement it has no business owning.
 */
export function recordsFrom(snapshot, { minMembers = 3, sigDepth = 3 } = {}) {
  const doc = snapshot.documents[0];
  const S = snapshot.strings;
  const N = doc.nodes;
  const str = (i) => (i === undefined || i === -1 ? "" : (S[i] ?? ""));

  // parentIndex is the only tree link in the flat encoding; children are
  // recovered once here rather than re-scanned per candidate.
  const kids = new Map();
  for (let i = 0; i < N.parentIndex.length; i++) {
    const p = N.parentIndex[i];
    if (p === -1 || p === undefined) continue;
    const list = kids.get(p);
    if (list) list.push(i);
    else kids.set(p, [i]);
  }

  const isElement = (i) => N.nodeType[i] === 1;
  const tagOf = (i) => str(N.nodeName[i]).toLowerCase();
  const elemKids = (i) => (kids.get(i) ?? []).filter(isElement);

  /** Tag shape, text-blind — two cards differ structurally or they do not. */
  const signature = (i, depth = 0) => {
    const tag = tagOf(i);
    if (depth >= sigDepth) return tag;
    const inner = elemKids(i).map((k) => signature(k, depth + 1)).join(",");
    return inner ? `${tag}(${inner})` : tag;
  };

  /** Text carried by a member, in document order, verbatim (ADR-DA-4). */
  const leavesOf = (root) => {
    const out = [];
    const walk = (i) => {
      for (const k of kids.get(i) ?? []) {
        if (N.nodeType[k] === 3) {
          const text = str(N.nodeValue[k]).replace(/\s+/g, " ").trim();
          if (text) out.push({ text, tag: tagOf(i), order: out.length });
        } else if (isElement(k)) {
          walk(k);
        }
      }
    };
    walk(root);
    return out;
  };

  /** Enough ancestry to find the node again; not a selector engine. */
  const pathOf = (i) => {
    const parts = [];
    for (let cur = i, hops = 0; cur !== undefined && cur !== -1 && hops < 6; cur = N.parentIndex[cur], hops++) {
      if (!isElement(cur)) continue;
      const cls = attrValue(S, N.attributes[cur], "class")?.split(" ")[0];
      parts.unshift(cls ? `${tagOf(cur)}.${cls}` : tagOf(cur));
    }
    return parts.join(">");
  };

  /**
   * Nearest heading above the group — the candidate object's name.
   *
   * Extraction, not inference: finding the <h2> that sits above a list is
   * reading the page. Deciding that the heading IS the object's name is the
   * inference, and that stays in derive-objects.
   */
  const headingFor = (parent) => {
    // Accessible name first. `aria-label` and `<caption>` exist precisely to
    // name a region, and they survive markup that a heading search cannot:
    // CruisePaperwork renders tables and nav lists where the nearest <h*> is
    // structurally distant, and the first run there named five of six
    // candidates after their container's CSS class.
    for (let cur = parent, hops = 0; cur !== undefined && cur !== -1 && hops < 8; cur = N.parentIndex[cur], hops++) {
      const label = attrValue(S, N.attributes[cur], "aria-label");
      if (label?.trim()) return label.trim();
      if (tagOf(cur) === "table") {
        for (const k of elemKids(cur)) {
          if (tagOf(k) === "caption") {
            const t = leavesOf(k).map((l) => l.text).join(" ").trim();
            if (t) return t;
          }
        }
      }
      // then a heading that precedes this branch at any level
      const sibs = kids.get(N.parentIndex[cur]) ?? [];
      const mine = sibs.indexOf(cur);
      for (let j = mine - 1; j >= 0; j--) {
        const found = findHeading(sibs[j]);
        if (found) return found;
      }
    }
    return null;
  };
  const findHeading = (i) => {
    if (!isElement(i)) return null;
    const HEAD = new Set(["h1", "h2", "h3", "h4"]);
    if (HEAD.has(tagOf(i))) {
      const t = leavesOf(i).map((l) => l.text).join(" ").trim();
      if (t) return t;
    }
    for (const k of elemKids(i)) {
      const found = findHeading(k);
      if (found) return found;
    }
    return null;
  };

  const groups = [];
  for (const [parent, children] of kids) {
    const els = children.filter(isElement);
    if (els.length < minMembers) continue;
    const bySig = new Map();
    for (const el of els) {
      const sig = signature(el);
      const list = bySig.get(sig);
      if (list) list.push(el);
      else bySig.set(sig, [el]);
    }
    for (const [sig, members] of bySig) {
      if (members.length < minMembers) continue;
      const rows = members.map((m) => ({ path: pathOf(m), leaves: leavesOf(m) }));
      // A member with nothing to read cannot contribute an attribute.
      if (rows.every((r) => r.leaves.length === 0)) continue;
      groups.push({
        containerPath: pathOf(parent),
        heading: headingFor(parent),
        signature: sig,
        members: rows,
      });
    }
  }
  return groups;
}

function attrValue(strings, attrArray, name) {
  const a = attrArray ?? [];
  for (let i = 0; i < a.length; i += 2)
    if (strings[a[i]] === name) return strings[a[i + 1]];
  return undefined;
}

const round2 = (n) => Math.round(n * 100) / 100;

export function renderSkeletonFile(screenKey, skeleton, prov) {
  return [
    provenanceHeader(prov, [
      "Region coordinates are viewport FRACTIONS, so a skeleton stays",
      "comparable across viewports. Measured only — a borrowed or authored",
      "geometry belongs in a proposal, never in this file.",
    ]),
    "version: 1",
    `screen: ${screenKey}`,
    `viewport: { width: ${prov.viewport.width}, height: ${prov.viewport.height} }`,
    yamlList("regions", skeleton.regions),
    yamlList("repeats", skeleton.repeats),
    "",
  ].join("\n");
}

export function renderCensusFile(censusMap, prov, extraRows = []) {
  const byProp = {};
  for (const row of censusMap.values()) {
    (byProp[row.property] ??= []).push({
      value: row.value,
      count: row.count,
      areaPx2: Math.round(row.area),
      tier: prov.tier,
      screens: [...row.screens].sort(),
    });
  }
  for (const row of extraRows) {
    (byProp[row.property] ??= []).push(row);
  }
  for (const prop of Object.keys(byProp)) {
    byProp[prop].sort((a, b) => (b.areaPx2 ?? 0) - (a.areaPx2 ?? 0) || b.count - a.count);
  }
  return `${JSON.stringify(
    {
      ...provenanceBlock(prov),
      note:
        "Weighted by painted area: the value that covers the most pixels is " +
        "the one a reader actually sees. T3 rows carry counts only and are " +
        "never comparable to T1 areas.",
      properties: byProp,
    },
    null,
    2,
  )}\n`;
}

// ── the stage ─────────────────────────────────────────────────────────────

/**
 * What `auth:` in the env contract means (FR-DA-030).
 *
 * The vocabulary was documented in the scaffold from the start — "none |
 * dev-open | storage-state path" — and nothing read it. Every gated route
 * therefore captured a redirect, and after the origin guard landed, captured
 * nothing at all.
 *
 * Auth is APP-specific, not framework-specific, so it does not belong in an
 * adapter: two Next.js apps can differ completely in how a session is
 * obtained. It belongs with the human who has credentials, which is what
 * Playwright's storageState already expresses.
 *
 *   none | "" | undefined  -> no session; gated routes will redirect
 *   dev-open               -> no session NEEDED; the app is open in dev
 *   anything else          -> a path to a Playwright storageState JSON
 */
/**
 * Resolve the auth mode a sweep should run under.
 *
 * The `exists` seam is typed here because the default value alone makes
 * TypeScript infer a zero-argument predicate, and every caller that passes a
 * real path-checker then fails the typecheck — which is how main's tsc went
 * red without anyone's test failing.
 *
 * Every branch returns the SAME shape — mode, storageState, detail — because
 * a caller reading `.storageState` should not have to know which branch
 * produced the value.
 *
 * Returns `mode` (none | dev-open | missing | storage-state), `storageState`
 * (a path or null) and `detail` (why, or null).
 *
 * @param {string | undefined} auth
 * @param {object} [deps]
 * @param {(path: string) => boolean} [deps.exists]
 */
export function resolveAuth(auth, { exists = () => false } = {}) {
  const value = String(auth ?? "").trim();
  if (!value || value === "none")
    return { mode: "none", storageState: null, detail: null };
  if (value === "dev-open")
    return { mode: "dev-open", storageState: null, detail: null };
  if (!exists(value)) {
    return {
      mode: "missing",
      storageState: null,
      // Named rather than swallowed: a sweep that silently runs logged-out
      // produces a full set of artifacts that are all the login page, and
      // every one of them looks like a successful capture.
      detail: `auth points at ${value}, which does not exist`,
    };
  }
  return { mode: "storage-state", storageState: value, detail: null };
}

/** Origin of a URL, or null when it cannot be parsed. */
export function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Did a navigation stay on the app under audit?
 *
 * The audit measures ONE application. A page served by a different origin is
 * not that application however similar it looks, and capturing it produces
 * artifacts whose provenance header is a lie.
 */
export function staysOnOrigin(baseUrl, landedUrl) {
  const expected = originOf(baseUrl);
  const landed = originOf(landedUrl);
  if (!expected || !landed) return true;   // unparseable: do not block on it
  return expected === landed;
}

export async function run(ctx) {
  const artifacts = [];
  const findings = [];

  const routesSrc = readSurvey(ctx.repoRoot, "routes.yaml");
  if (!routesSrc) {
    return { artifacts, findings, skipped: "no routes.yaml — run inventory first" };
  }
  let rows = parseRoutesFile(routesSrc);
  // Inventory's cross-check findings live in this file too. Capture rewrites
  // it to persist row statuses, and the first pilot run dropped twenty
  // findings on the floor that way — the write must carry them through.
  const inventoryFindings = parseRoutesFindings(routesSrc);
  const todo = pendingRows(rows, ctx.commit, { force: ctx.force });
  if (todo.length === 0) {
    return { artifacts, findings, skipped: `all ${rows.length} rows captured at ${ctx.commit.slice(0, 8)}` };
  }
  if (ctx.dryRun) {
    return { artifacts, findings, skipped: `dry run — ${todo.length} row(s) would be captured` };
  }

  const pw = await loadPlaywright(ctx.repoRoot);
  if (!pw) {
    return {
      artifacts,
      findings: [
        {
          kind: "capture-unavailable",
          evidence: "playwright not resolvable from the audited repo",
          suggests: "install playwright in the app, or audit at T3 (harvest only)",
        },
      ],
      skipped: "playwright unavailable — T1/T2 capture needs it",
    };
  }

  const prov = ctx.provenanceFor("audit/capture", {
    engine: `playwright@${pw.pkg} from ${pw.from}`,
  });
  const browser = await pw.chromium.launch();

  // A stored session, when the contract names one. Playwright restores
  // cookies and localStorage into the context, so the first navigation is
  // already authenticated and no login is driven during the sweep — which
  // keeps capture a read of the app rather than an interaction with it.
  const authed = resolveAuth(ctx.envContract?.auth, { exists: existsSync });
  if (authed.mode === "missing") {
    findings.push({
      kind: "auth-unusable",
      evidence: authed.detail,
      suggests:
        "run `node design/tools/audit/login.mjs` to create one, or set auth: none " +
        "and accept that gated routes are unreachable",
    });
  }
  const context = await browser.newContext({
    viewport: ctx.viewport,
    ...(authed.storageState ? { storageState: authed.storageState } : {}),
  });
  const page = await context.newPage();
  const relayed = await installRelay(context, ctx.envContract);
  const cdp = await context.newCDPSession(page);
  const census = new Map();
  const skeletons = {};
  const records = [];
  const controls = [];
  const navEdges = [];

  try {
    for (const row of todo) {
      const recipe = recipeFor(ctx, row);
      const screenKey = screenKeyFor(row);
      try {
        // A recipe's `goto` IS the destination. The first version navigated to
        // it and then immediately navigated again to the un-substituted
        // pattern (`/queue/voyage/:voyageId`), so every param-route recipe was
        // inert and the sweep photographed a 404-ish shell while reporting
        // success.
        const target = recipe?.goto ?? urlFor(ctx, row);
        if (recipe?.post) await page.request.post(recipe.post);
        await page.goto(target, { waitUntil: "networkidle", timeout: 30_000 });

        // WHERE DID WE LAND? page.goto follows redirects, and a gated route
        // in an app configured with an absolute production URL redirects
        // OFF-HOST. Without this check the sweep photographed
        // waypoint.copointai.com and stamped every artifact
        // `tier: T1 — measured from the running application` against a local
        // commit that never produced those bytes. Confidently wrong
        // provenance is worse than no measurement: the current model, the
        // diff and the Studio would all have believed it.
        // T2 captures file:// mocks and has no origin to stay within.
        if (ctx.tier !== "T2" && !staysOnOrigin(ctx.envContract?.baseUrl, page.url())) {
          findings.push({
            kind: "capture-left-origin",
            route: row.path,
            state: row.state,
            evidence: `${target} -> ${page.url()}`,
            suggests:
              "the route redirected off baseUrl's origin — usually an unauthenticated " +
              "gated route sending the browser to a hosted login. Set `auth` in " +
              "env-contract.yaml, or accept the route is unreachable in this environment",
          });
          continue;   // capture NOTHING: a foreign page is not this app
        }
        if (recipe?.waitFor) await page.waitForSelector(recipe.waitFor, { timeout: 10_000 });
        const snapshot = await cdp.send("DOMSnapshot.captureSnapshot", {
          computedStyles: CAPTURED_STYLES,
          includeDOMRects: true,
        });
        mergeCensus(census, censusFrom(snapshot), screenKey);
        // FR-DA-045's input. Collected here because the snapshot is already in
        // hand — a second navigation pass would double the sweep against
        // DA-NFR-004 (ADR-DA-8).
        records.push({ route: screenKey, groups: recordsFrom(snapshot) });
        const skeleton = skeletonFrom(snapshot, ctx.viewport);
        skeletons[screenKey] = skeleton;
        artifacts.push(
          writeSurvey(
            ctx.repoRoot,
            `${screenKey}.skeleton.yaml`,
            renderSkeletonFile(screenKey, skeleton, prov),
          ),
        );
        controls.push(...(await harvestControls(page, screenKey)));
        navEdges.push(...(await harvestNavEdges(page, screenKey)));
        await page.screenshot({
          path: join(ctx.repoRoot, "design", "survey", "shots", `${screenKey}.png`),
          fullPage: false,
        });
        rows = markCaptured(rows, row, ctx.commit);
      } catch (err) {
        // Recorded, never swallowed: a partial sweep must not look complete.
        rows = markUnreachable(rows, row, truncate(err.message));
        findings.push({
          kind: "state-unreachable",
          route: row.path,
          state: row.state,
          evidence: truncate(err.message),
          suggests: "add a state recipe to env-contract.yaml, or accept the state does not exist",
        });
      }
    }
  } finally {
    await browser.close();
  }

  const chromeOnly = looksLikeChromeOnly(controls, new Set(controls.map((c) => c.screen)).size);
  if (chromeOnly) {
    findings.push({
      kind: "capture-chrome-only",
      evidence: `${chromeOnly.distinct} distinct control label(s) across ${chromeOnly.screens} screens (${chromeOnly.sample.join(", ")})`,
      suggests: relayed
        ? "the app rendered no content — check the seed recipe and the API health"
        : "set relayOrigins in env-contract.yaml: the SPA's API calls are being blocked cross-origin",
    });
  }

  artifacts.push(
    writeSurvey(ctx.repoRoot, "style-census.json", renderCensusFile(census, prov)),
  );
  artifacts.push(
    writeSurvey(
      ctx.repoRoot,
      "controls.yaml",
      [
        provenanceHeader(prov, [
          "Labels are VERBATIM. Mapping them to canonical verbs happens at",
          "design-flow with a human directing, never here (ADR-DA-4).",
        ]),
        "version: 1",
        yamlList("controls", controls),
        yamlList("navEdges", navEdges),
        "",
      ].join("\n"),
    ),
  );
  artifacts.push(
    writeSurvey(
      ctx.repoRoot,
      "routes.yaml",
      renderRoutesFile(rows, ctx.provenanceFor("audit/capture"), inventoryFindings),
    ),
  );

  return {
    artifacts,
    findings,
    // Skeletons travel in memory as well as to disk. normalise-model needs
    // the geometry and the audit ships no YAML parser, so re-reading the
    // files it just wrote would mean writing one.
    exports: { censusMap: census, controls, navEdges, records, skeletons },
  };
}

function screenKeyFor(row) {
  const slug =
    row.path
      .replace(/^\//, "")
      .replace(/[:*?]/g, "")
      .replace(/\//g, ".")
      .replace(/[^\w.-]/g, "") || "root";
  return row.state === "loaded" ? slug : `${slug}@${row.state}`;
}

function urlFor(ctx, row) {
  if (ctx.tier === "T2" && ctx.envContract.mockGlob) return row.path;
  const base = (ctx.envContract.baseUrl ?? "http://localhost:5173").replace(/\/$/, "");
  // Path params cannot be guessed; a recipe supplies a real one, and without
  // it the naive attempt is what gets recorded as unreachable.
  return `${base}${row.path}`;
}

/** The env contract's recipe for this row, if the human wrote one. */
function recipeFor(ctx, row) {
  return (ctx.envContract.states ?? []).find(
    (s) => s.path === row.path && s.state === row.state,
  );
}

async function harvestControls(page, screenKey) {
  return page.evaluate((screen) => {
    const out = [];
    const nodes = document.querySelectorAll(
      "button, [role=button], a[href], input[type=submit], form",
    );
    for (const el of nodes) {
      const label = (
        el.getAttribute("aria-label") ||
        el.textContent ||
        el.getAttribute("value") ||
        ""
      )
        .replace(/\s+/g, " ")
        .trim();
      if (!label || label.length > 60) continue;
      out.push({
        screen,
        label,
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute("role") || null,
        href: el.getAttribute("href") || null,
      });
    }
    return out.slice(0, 80);
  }, screenKey);
}

async function harvestNavEdges(page, screenKey) {
  return page.evaluate((screen) => {
    const seen = new Set();
    const out = [];
    for (const a of document.querySelectorAll("a[href]")) {
      const href = a.getAttribute("href");
      if (!href || !href.startsWith("/") || seen.has(href)) continue;
      seen.add(href);
      out.push({ from: screen, to: href });
    }
    return out.slice(0, 40);
  }, screenKey);
}

const truncate = (s, n = 120) =>
  String(s ?? "").replace(/\s+/g, " ").slice(0, n);
