import { describe, expect, it } from "vitest";
import { buildBars } from "./barLayout";

const seg = (id: string, start_beat: number, end_beat: number) => ({ id, start_beat, end_beat });

describe("buildBars", () => {
  it("splits a vamping chord into one fragment per bar, flagged only at its real boundaries", () => {
    // The whole point: 8 bars of C is EIGHT cells, not one enormous one. Resize handles hang
    // off isChordStart/isChordEnd fragments, so a vamp must NOT grow 8 pairs of handles.
    const bars = buildBars([seg("s1", 0, 32)], 4, 0);
    expect(bars).toHaveLength(8);
    expect(bars.every((b) => b.fragments.length === 1)).toBe(true);
    expect(bars.every((b) => b.fragments[0].segmentId === "s1")).toBe(true);
    expect(bars.every((b) => b.fragments[0].beats === 4)).toBe(true);
    expect(bars.map((b) => b.fragments[0].isChordStart)).toEqual(
      [true, false, false, false, false, false, false, false],
    );
    expect(bars.map((b) => b.fragments[0].isChordEnd)).toEqual(
      [false, false, false, false, false, false, false, true],
    );
  });

  it("puts two chords sharing a bar in one bar, sized by their beats", () => {
    const bars = buildBars([seg("f", 0, 2), seg("g", 2, 4)], 4, 0);
    expect(bars).toHaveLength(1);
    expect(bars[0].fragments.map((f) => [f.segmentId, f.beats])).toEqual([["f", 2], ["g", 2]]);
    // Both are whole chords, so both ends are real boundaries.
    expect(bars[0].fragments.every((f) => f.isChordStart && f.isChordEnd)).toBe(true);
  });

  it("divides a bar by beats, not evenly — a 3+1 split is 3:1", () => {
    const bars = buildBars([seg("c", 0, 3), seg("g", 3, 4)], 4, 0);
    expect(bars[0].fragments.map((f) => f.beats)).toEqual([3, 1]);
  });

  it("gives a chord that straddles a bar line one fragment on each side", () => {
    const bars = buildBars([seg("c", 0, 6), seg("g", 6, 8)], 4, 0);
    expect(bars).toHaveLength(2);
    expect(bars[0].fragments.map((f) => [f.segmentId, f.beats])).toEqual([["c", 4]]);
    expect(bars[1].fragments.map((f) => [f.segmentId, f.beats])).toEqual([["c", 2], ["g", 2]]);
    expect(bars[0].fragments[0].isChordStart).toBe(true);
    expect(bars[0].fragments[0].isChordEnd).toBe(false);
    expect(bars[1].fragments[0].isChordStart).toBe(false);
    expect(bars[1].fragments[0].isChordEnd).toBe(true);
  });

  it("opens with a short pickup bar when the bar line is shifted", () => {
    // measure_offset 2 -> bar lines at 2, 6, 10. Beats 0-2 are a pickup.
    const bars = buildBars([seg("s1", 0, 10)], 4, 2);
    expect(bars.map((b) => [b.startBeat, b.endBeat])).toEqual([[0, 2], [2, 6], [6, 10]]);
  });

  it("ends with a partial bar when the recording stops mid-bar", () => {
    const bars = buildBars([seg("s1", 0, 6)], 4, 0);
    expect(bars.map((b) => [b.startBeat, b.endBeat])).toEqual([[0, 4], [4, 6]]);
    expect(bars[1].fragments[0].beats).toBe(2);
  });

  it("spans only to the last segment's end_beat, with no trailing empty bars", () => {
    // buildBars has no duration input of its own; the chart's extent is entirely
    // governed by the last segment's end_beat, so it must not overrun it.
    const bars = buildBars([seg("s1", 0, 4)], 4, 0);
    expect(bars).toHaveLength(1);
    expect(bars[0].endBeat).toBe(4);
  });

  it("returns no bars for an empty chart", () => {
    expect(buildBars([], 4, 0)).toEqual([]);
  });

  it("returns no bars when a segment's end_beat is non-finite, rather than hanging", () => {
    expect(buildBars([seg("s1", 0, Infinity)], 4, 0)).toEqual([]);
    expect(buildBars([seg("s1", 0, NaN)], 4, 0)).toEqual([]);
  });

  it("handles 3/4", () => {
    const bars = buildBars([seg("s1", 0, 9)], 3, 0);
    expect(bars.map((b) => [b.startBeat, b.endBeat])).toEqual([[0, 3], [3, 6], [6, 9]]);
  });

  it("keeps a half-beat chord from a manual edit", () => {
    // The seed snaps to whole beats; a PLAYER may still cut a half. Layout must not lose it.
    const bars = buildBars([seg("c", 0, 3.5), seg("g", 3.5, 4)], 4, 0);
    expect(bars).toHaveLength(1);
    expect(bars[0].fragments.map((f) => f.beats)).toEqual([3.5, 0.5]);
  });
});
