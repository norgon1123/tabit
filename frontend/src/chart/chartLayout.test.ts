import { describe, expect, test } from "vitest";
import { boundaryUpdates, redistributeLength } from "./chartLayout";
import { roundCs, formatTimeCs, clampBoundary } from "./timeMath";

describe("centisecond rule (round 2 #5)", () => {
  test("roundCs quantizes to 2 decimals", () => {
    expect(roundCs(1.23456)).toBe(1.23);
    expect(roundCs(2)).toBe(2);
  });
  test("formatTimeCs shows m:ss.cc", () => {
    expect(formatTimeCs(2.5)).toBe("0:02.50");
    expect(formatTimeCs(65.25)).toBe("1:05.25");
  });
});

describe("clampBoundary (#2)", () => {
  test("keeps the boundary inside its neighbours", () => {
    expect(clampBoundary(5, 0, 4)).toBe(3.95); // pinned below upper - min
    expect(clampBoundary(-1, 0, 4)).toBe(0.05); // pinned above lower + min
    expect(clampBoundary(2.4567, 0, 4)).toBe(2.46); // rounded to centisecond
  });
});

describe("boundaryUpdates (beat domain)", () => {
  const L = { id: "s1" };
  const R = { id: "s2" };
  test("growing the boundary patches the shrinking neighbour first", () => {
    expect(boundaryUpdates(L, R, 2, 3)).toEqual([
      { id: "s2", patch: { start_beat: 3 } },
      { id: "s1", patch: { end_beat: 3 } },
    ]);
  });
  test("shrinking the boundary patches the left segment first", () => {
    expect(boundaryUpdates(L, R, 2, 1)).toEqual([
      { id: "s1", patch: { end_beat: 1 } },
      { id: "s2", patch: { start_beat: 1 } },
    ]);
  });
  test("edge segments produce a single patch", () => {
    expect(boundaryUpdates(undefined, R, 0, 0.5)).toEqual([{ id: "s2", patch: { start_beat: 0.5 } }]);
    expect(boundaryUpdates(L, undefined, 4, 3.5)).toEqual([{ id: "s1", patch: { end_beat: 3.5 } }]);
  });
  test("no movement yields no patches", () => {
    expect(boundaryUpdates(L, R, 2, 2)).toEqual([]);
  });
});

const span = (s: number, e: number) => ({ start_beat: s, end_beat: e });
const lens = (w: { start_beat: number; end_beat: number }[]) =>
  w.map((x) => x.end_beat - x.start_beat);
const contiguous = (w: { start_beat: number; end_beat: number }[]) =>
  w.every((x, i) => i === 0 || Math.abs(x.start_beat - w[i - 1].end_beat) < 1e-9);

describe("redistributeLength", () => {
  const ABC = () => [span(0, 4), span(4, 8), span(8, 12)];

  test("growing an interior chord shrinks the next, total + later chords unchanged", () => {
    const out = redistributeLength(ABC(), 0, 6, 20);
    expect(lens(out)).toEqual([6, 2, 4]); // B gives 2 to A; C untouched
    expect(out[2].end_beat).toBe(12); // total conserved
    expect(contiguous(out)).toBe(true);
  });

  test("growing past the next chord's slack ripples into the chord after", () => {
    const out = redistributeLength([span(0, 4), span(4, 5), span(5, 9)], 0, 8, 20);
    expect(lens(out)).toEqual([8, 0.5, 0.5]); // B floored at 0.5, rest taken from C
    expect(out[2].end_beat).toBe(9); // total conserved
    expect(contiguous(out)).toBe(true);
  });

  test("growth is capped at the followers' available slack", () => {
    const out = redistributeLength(ABC(), 0, 20, 20);
    expect(lens(out)).toEqual([11, 0.5, 0.5]); // 7 beats of slack max
    expect(out[2].end_beat).toBe(12);
  });

  test("shrinking an interior chord gives beats to the next, total conserved", () => {
    const out = redistributeLength(ABC(), 0, 2, 20);
    expect(lens(out)).toEqual([2, 6, 4]);
    expect(out[2].end_beat).toBe(12);
    expect(contiguous(out)).toBe(true);
  });

  test("growing the last chord is clamped at maxTotalBeats", () => {
    const out = redistributeLength(ABC(), 2, 20, 14);
    expect(out[2].end_beat).toBe(14); // clamped to the grid
  });

  test("snaps the requested length to the nearest half-beat", () => {
    const out = redistributeLength(ABC(), 0, 5.3, 20); // 5.3 -> 5.5
    expect(lens(out)[0]).toBe(5.5);
  });

  test("last-chord clamp never exceeds a fractional maxTotalBeats with sub-MIN headroom", () => {
    // Grid ends at 11.9; the last chord starts at 11.5 (0.4 beats of room, < MIN_BEATS).
    const out = redistributeLength([span(0, 11.5), span(11.5, 11.9)], 1, 5, 11.9);
    expect(out[1].end_beat).toBeLessThanOrEqual(11.9 + 1e-9);
    expect(out[1].end_beat).toBeGreaterThan(out[1].start_beat);
  });

  test("interior edit keeps the fractional last end_beat within the grid cap (no 422 flicker)", () => {
    // Last chord C ends exactly on a fractional grid cap (length 3.9, end 11.9),
    // as real analysis stores it. Growing A must not let snapHalfBeat push C's end to 12.0.
    const out = redistributeLength([span(0, 4), span(4, 8), span(8, 11.9)], 0, 6, 11.9);
    expect(lens(out)[0]).toBe(6); // A grew to 6 (B gave up 2)
    expect(out[2].end_beat).toBeLessThanOrEqual(11.9 + 1e-9); // tail not snapped past the cap
  });

  test("treats a non-positive maxTotalBeats as no cap (null-duration chart)", () => {
    // duration unknown -> totalBeats is 0; editing the last chord must not clamp end to 0.
    const out = redistributeLength([span(0, 4), span(4, 8)], 1, 6, 0);
    expect(out[1].end_beat).toBe(10); // 4 + 6, NOT clamped to 0
  });
});
