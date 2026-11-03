import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { contrastRatio, AA_TEXT, AA_UI } from "./contrast";

/** Parse the custom properties out of one CSS block by selector.
 *  Reading the stylesheet as text (rather than duplicating the values in TS) keeps
 *  index.css the single source of truth — the test cannot drift from what ships. */
function tokensFor(css: string, selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!block) throw new Error(`No CSS block for selector: ${selector}`);
  const out: Record<string, string> = {};
  for (const [, name, value] of block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out[name] = value.trim();
  }
  return out;
}

/** Pull the numeric magnitude out of a simple CSS length (`rem`, `em`, `px`, `%`), scaled
 *  onto a common "rem-ish" axis so values in different units stay roughly comparable.
 *  Returns null for anything that isn't a bare `<number><unit>` — e.g. `calc(...)`. */
function toComparableLength(value: string): number | null {
  const m = /^(-?\d*\.?\d+)(rem|em|px|%)$/.exec(value.trim());
  if (!m) return null;
  const num = parseFloat(m[1]);
  switch (m[2]) {
    case "rem":
    case "em":
      return num;
    case "px":
      return num / 16; // assumes a 16px root, same convention the type scale itself uses
    case "%":
      return num / 100;
    default:
      return null;
  }
}

/** A token is a plausible CSS length if it's a bare number+unit, or a calc()/clamp()
 *  expression — not merely present, and not a stray word like "banana". */
function isPlausibleLength(value: string | undefined): boolean {
  if (value === undefined) return false;
  if (toComparableLength(value) !== null) return true;
  return /^(calc|clamp)\(.+\)$/.test(value.trim());
}

const css = readFileSync(resolve(__dirname, "../index.css"), "utf8");
const THEMES = {
  light: tokensFor(css, ':root, [data-theme="light"]'),
  dark: tokensFor(css, '[data-theme="dark"]'),
};

/** [foreground, background, threshold, why]
 *
 *  NOTE ON WHAT IS *NOT* HERE. `--line` is absent deliberately, and this is the one
 *  judgement call in the palette worth understanding.
 *
 *  WCAG 1.4.11 governs two things: the boundaries of UI *components* (the thing that tells
 *  you "this is an input"), and *graphical objects* that carry meaning. `--line` is neither
 *  — it is the hairline around a card and between two chords in the same bar. A card is a
 *  decorative grouping, not a control, and a chord is identified by its own label. Forcing
 *  3:1 on it would turn every card into a heavy grey box.
 *
 *  So the old `--line` was doing two jobs at once and doing one of them badly. It is split:
 *
 *    --line            decorative hairline. Not WCAG-governed. Kept perceptible (~1.85:1)
 *                      because a card differs from the page by only 1.05:1 — the border and
 *                      the shadow are what make a card visible at all, not its fill.
 *    --control-border  the boundary of an input, select or button. A real UI component
 *                      boundary. MUST clear 3:1, and is tested below.
 *    --bar-line        the measure rule on the chart. A graphical object that says "a bar
 *                      starts here". MUST clear 3:1, and must out-weigh --line. */
const PAIRS: Array<[string, string, number, string]> = [
  ["--text", "--bg", AA_TEXT, "body text on the page"],
  ["--text", "--surface", AA_TEXT, "text on a card"],
  ["--muted", "--bg", AA_TEXT, "secondary text on the page"],
  ["--muted", "--surface", AA_TEXT, "secondary text on a card"],
  ["--accent", "--bg", AA_UI, "the accent as a border/focus ring on the page"],
  ["--accent", "--surface", AA_UI, "the accent as a border on a card"],
  ["--danger", "--bg", AA_TEXT, "error text"],
  ["--danger", "--surface", AA_TEXT, "error text on a card"],
  ["--ok", "--bg", AA_TEXT, "success text"],
  ["--ok", "--surface", AA_TEXT, "success text on a card"],
  ["--on-accent", "--accent", AA_TEXT, "label on a primary button"],
  ["--control-border", "--bg", AA_UI, "an input's boundary — a UI component"],
  ["--control-border", "--surface", AA_UI, "an input's boundary, on a card"],
  ["--bar-line", "--bg", AA_UI, "the measure rule — a graphical object"],
  ["--bar-line", "--surface", AA_UI, "the measure rule, on a card"],
];

describe.each(Object.entries(THEMES))("%s theme", (themeName, tokens) => {
  it.each(PAIRS)("%s on %s meets %s:1 — %s", (fg, bg, threshold, _why) => {
    const ratio = contrastRatio(tokens[fg], tokens[bg]);
    expect(
      ratio,
      `${themeName}: ${fg} (${tokens[fg]}) on ${bg} (${tokens[bg]}) is ${ratio.toFixed(2)}:1, needs ${threshold}:1`,
    ).toBeGreaterThanOrEqual(threshold);
  });

  it("defines every token the other theme defines", () => {
    const other = themeName === "light" ? THEMES.dark : THEMES.light;
    expect(Object.keys(tokens).sort()).toEqual(Object.keys(other).sort());
  });

  it("makes the measure rule out-weigh the ordinary chord divider", () => {
    // Two channels, not one: the bar line is heavier than --line by COLOUR (this test) and by
    // WIDTH (2px vs 1px, in the CSS). A user who cannot see the colour difference still sees
    // the weight difference. Hue is never the only channel — and since the bar became a boxed
    // grid there is a third: the box is an enclosed shape, not a hue.
    const bar = contrastRatio(tokens["--bar-line"], tokens["--bg"]);
    const line = contrastRatio(tokens["--line"], tokens["--bg"]);
    expect(bar).toBeGreaterThan(line);
  });

  // Decorative edges WCAG does NOT govern, held to a self-imposed 1.6:1 floor rather than the
  // 3:1 of the PAIRS table — a card differs from the page by only ~1.05:1, so these edges (and
  // the shadow) are what make a card, or a row of bars, visible at all. This is why --line was
  // split from --control-border rather than simply darkened. [token, why it is decorative]
  it.each([
    ["--line", "the hairline around a card and between two chords in the same bar"],
    ["--bar-line-h", "the top/bottom edge of a bar box — separates one row of bars from the next, a card's-edge job (the VERTICAL --bar-line is the WCAG-governed graphical object)"],
  ])("keeps the decorative edge %s perceptible even though WCAG does not govern it", (token, _why) => {
    expect(contrastRatio(tokens[token], tokens["--bg"])).toBeGreaterThanOrEqual(1.6);
  });

  it("has no leftover --panel token (renamed to --surface)", () => {
    expect(tokens["--panel"]).toBeUndefined();
    expect(tokens["--surface"]).toBeDefined();
  });
});

describe("typography", () => {
  it("points --font-ui at Figtree with a system fallback", () => {
    const root = tokensFor(css, ":root");
    expect(root["--font-ui"]).toMatch(/Figtree/);
    // The fallback matters: the page must be readable in the frame before the font loads.
    expect(root["--font-ui"]).toMatch(/system-ui/);
  });

  const TYPE_SCALE = ["--text-xs", "--text-sm", "--text-md", "--text-lg", "--text-xl", "--text-2xl"];

  it("has a type scale rather than magic numbers", () => {
    const root = tokensFor(css, ":root");
    for (const t of TYPE_SCALE) {
      expect(root[t], `missing type token ${t}`).toBeDefined();
      expect(
        isPlausibleLength(root[t]),
        `${t} (${JSON.stringify(root[t])}) is not a plausible CSS length`,
      ).toBe(true);
    }
  });

  it("increases monotonically from --text-xs through --text-2xl", () => {
    // A scale whose "large" is smaller than its "small" is not a scale.
    const root = tokensFor(css, ":root");
    const values = TYPE_SCALE.map((t) => {
      const n = toComparableLength(root[t]);
      if (n === null) throw new Error(`${t} (${root[t]}) is not a comparable length`);
      return n;
    });
    for (let i = 1; i < values.length; i++) {
      expect(
        values[i],
        `${TYPE_SCALE[i]} (${root[TYPE_SCALE[i]]}) should be larger than ${TYPE_SCALE[i - 1]} (${root[TYPE_SCALE[i - 1]]})`,
      ).toBeGreaterThan(values[i - 1]);
    }
  });

  it("sizes chord cells from a token, not from their content", () => {
    // A content-sized cell re-wraps the entire chart the day the typeface changes.
    const value = tokensFor(css, ":root")["--chord-cell-min"];
    expect(value, "missing --chord-cell-min").toBeDefined();
    expect(
      isPlausibleLength(value),
      `--chord-cell-min (${JSON.stringify(value)}) is not a plausible CSS length`,
    ).toBe(true);
  });

  it("declares no font-family outside the font tokens", () => {
    const declarations = css.match(/font-family:\s*([^;]+);/g) ?? [];
    for (const d of declarations) {
      expect(d, `font-family must reference a token: ${d}`).toMatch(/var\(--font-/);
    }
  });
});

describe("the stylesheet itself", () => {
  it("declares color-scheme so native controls follow the theme", () => {
    // Without this, the native <audio> element and form widgets render light against a
    // dark UI. It is one line and it is the cheapest a11y win in the codebase.
    expect(css).toMatch(/color-scheme:\s*light\b/);
    expect(css).toMatch(/color-scheme:\s*dark\b/);
  });

  it("has no hardcoded hex outside the token blocks", () => {
    // Every colour must be a var(). The old cold blue-grey hex used to be written literally 5 times.
    const withoutTokenBlocks = css.replace(/(:root, \[data-theme="light"\]|\[data-theme="dark"\])\s*\{[^}]*\}/g, "");
    const strays = withoutTokenBlocks.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(strays, `hardcoded colours outside the palette: ${strays.join(", ")}`).toEqual([]);
  });
});
