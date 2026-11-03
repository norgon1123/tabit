import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** The chord sheet is a CSS grid of bar boxes whose last row can be PARTIAL — a chart that
 *  ends mid-way across a line leaves the grid's final row short of `--bars-per-line` cells.
 *
 *  Every bar box must be closed on all four sides regardless. The trap is the tidy "frame +
 *  leading edge" scheme: draw the far edges once on the grid container, and only the top/left
 *  leading edges on each bar, letting each bar borrow its bottom from the row below and its
 *  right from the bar beside it. That is airtight for a full rectangle and breaks the instant
 *  the last row is partial: the bars in the row ABOVE the empty tail have no row below to lend
 *  them a bottom, and the LAST chord has no bar to its right to lend it a right edge — so the
 *  row above loses its bottom rule and the final chord loses its right rule.
 *
 *  The fix is for a bar to close its OWN trailing edges — bottom and right — so closure never
 *  depends on a neighbour a partial row removed. The container then supplies only the frame's
 *  top and left (the edges no cell can draw for itself), and no boundary is drawn twice.
 *
 *  Parsed from the shipped stylesheet, like motion.test.ts / ControlDeck.responsive.test.tsx,
 *  so the guard cannot drift from what ships. */
const css = readFileSync(resolve(__dirname, "../index.css"), "utf8");

function ruleBody(selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  return m ? m[1] : null;
}

describe("bar boxes close even when the final row is partial", () => {
  it("draws each bar's OWN trailing edges — bottom rules off a partial tail's row above, right closes the last chord", () => {
    // One contract, two manifestations: a bar rules off its own bottom AND its own right, so
    // closure never waits on a neighbour a short row removed. Both halves of the reported bug
    // are here — the row above an empty tail keeps its bottom (borrowed before from a next-row
    // cell a partial row lacks), and the final chord keeps its right (the frame's far edge a
    // partial row's last cell never reaches). Neither leading edge is drawn: the container frame
    // owns top and left, and doubling either would stack two rules into one seam.
    const bar = ruleBody(".chart-bar");
    expect(bar).not.toBeNull();
    expect(bar).toMatch(/border-bottom:[^;]*var\(--bar-line-h\)/);
    expect(bar).not.toMatch(/border-top:/);
    expect(bar).toMatch(/border-right:[^;]*var\(--bar-line\)/);
    expect(bar).not.toMatch(/border-left:/);
  });

  it("keeps the frame's top and left on the container — the edges no cell can draw itself", () => {
    // The outermost top and left of the whole grid belong to no single bar (a bar owns only its
    // trailing edges), so the container carries them. It must NOT still carry the far edges the
    // bars now own, or those would double up on a full row's right column and bottom row.
    const bars = ruleBody(".chart-bars");
    expect(bars).not.toBeNull();
    expect(bars).toMatch(/border-top:[^;]*var\(--bar-line-h\)/);
    expect(bars).toMatch(/border-left:[^;]*var\(--bar-line\)/);
    expect(bars).not.toMatch(/border-right:/);
    expect(bars).not.toMatch(/border-bottom:/);
  });
});
