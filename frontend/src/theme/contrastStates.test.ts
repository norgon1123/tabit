import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { contrastRatio, blend, AA_TEXT } from "./contrast";

const css = readFileSync(resolve(__dirname, "../index.css"), "utf8");

function tokens(selector: string): Record<string, string> {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = new RegExp(`${esc}\\s*\\{([^}]*)\\}`).exec(css);
  if (!block) throw new Error(`No block for ${selector}`);
  const out: Record<string, string> = {};
  for (const [, k, v] of block[1].matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,6})\s*;/g)) out[k] = v;
  return out;
}
const THEMES = {
  light: tokens(':root, [data-theme="light"]'),
  dark: tokens('[data-theme="dark"]'),
};

/** The stateful/composited surfaces AA must hold on, over and above the raw token pairs
 *  palette.test.ts checks. `opacity`, `color-mix` and `filter` change the RENDERED colour;
 *  this test computes the effective colour and asserts AA on it. */
describe.each(Object.entries(THEMES))("stateful contrast — %s theme", (_name, t) => {
  it("dims the practice spotlight by desaturation, never by opacity, so the masked '?' keeps its contrast", () => {
    // The spotlight must NOT drop the chart's text contrast: the masked '?' is the very thing a
    // player reads to make a guess. The fix desaturates instead of dimming, so the effective
    // colour stays the raw token — full contrast (the raw tokens' AA is proven in palette.test.ts).
    // Guard the mechanism here: .chart-bars under practice must not carry an `opacity` (which
    // would crush contrast); desaturation is the only allowed dim.
    const rule = /\.chart-workspace\[data-practice="true"\]\s+\.chart-bars\s*\{([^}]*)\}/.exec(css);
    expect(rule, "spotlight rule present").not.toBeNull();
    expect(rule![1]).not.toMatch(/opacity\s*:/);
    expect(rule![1]).toMatch(/filter\s*:\s*saturate/);
  });

  it("keeps the receded context bar's text AA even while it recedes", () => {
    // The bar dims during playback but its title/links are still text: the static receded
    // state must clear 4.5:1. The receded opacity is read from the stylesheet.
    const m = /\.chart-context-bar\[data-receded="true"\]\s*\{[^}]*opacity:\s*([0-9.]+)/.exec(css);
    expect(m, "receded opacity present").not.toBeNull();
    const alpha = parseFloat(m![1]);
    const effective = blend(t["--text"], t["--bg"], alpha);
    expect(contrastRatio(effective, t["--bg"])).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("keeps the receded context bar's LINK AA, not just its title", () => {
    // The back link sits in the receded bar. The GLOBAL `a { color: var(--accent) }` would dim
    // to 2.76:1 at 0.65 — below AA — so the bar must override the link to a token that survives
    // the recede. Resolve whatever token it uses and check the composite; this catches a future
    // re-accenting of the link, which the --text-only title check above would miss.
    const linkRule = /\.chart-context-bar\s+a\s*\{([^}]*)\}/.exec(css);
    expect(linkRule, "context-bar link colour is set explicitly").not.toBeNull();
    const colorVar = /color:\s*var\((--[\w-]+)\)/.exec(linkRule![1]);
    expect(colorVar, "link colour uses a token").not.toBeNull();
    const m = /\.chart-context-bar\[data-receded="true"\]\s*\{[^}]*opacity:\s*([0-9.]+)/.exec(css);
    const alpha = parseFloat(m![1]);
    const effective = blend(t[colorVar![1]], t["--bg"], alpha);
    expect(contrastRatio(effective, t["--bg"])).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("keeps the current chord's label AA on its tinted background", () => {
    // color-mix(--accent N%, transparent) over the page: read N from the stylesheet (rather
    // than hardcoding it) so raising the tint can never silently push --text below AA.
    const pct = /\.chord-cell\[data-playing="true"\][^}]*color-mix\(in srgb,\s*var\(--accent\)\s*(\d+)%/.exec(css);
    expect(pct, "playing-cell tint percentage present").not.toBeNull();
    const tint = blend(t["--accent"], t["--bg"], parseInt(pct![1], 10) / 100);
    expect(contrastRatio(t["--text"], tint)).toBeGreaterThanOrEqual(AA_TEXT);
  });
});
