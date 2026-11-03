import { describe, expect, test } from "vitest";
import { timeForBeat, totalBeats } from "./beatGrid";

describe("totalBeats", () => {
  test("synthesizes a 120 BPM grid when no beat times are present (0.5s/beat)", () => {
    // 10s at 120 BPM -> 20 beats.
    expect(totalBeats([], null, 10)).toBeCloseTo(20, 6);
  });

  test("uses the provided bpm to synthesize the grid", () => {
    // 60 BPM -> 1s/beat -> 10 beats over 10s.
    expect(totalBeats([], 60, 10)).toBeCloseTo(10, 6);
  });

  test("interpolates within a detected grid", () => {
    // beats at 0,1,2,3s; duration 2.5s -> beat 2.5.
    expect(totalBeats([0, 1, 2, 3], 120, 2.5)).toBeCloseTo(2.5, 6);
  });

  test("extrapolates past the last detected onset using the final interval", () => {
    // last interval 1s; duration 5s, grid ends at 3 (beat 3) -> 3 + 2 = 5.
    expect(totalBeats([0, 1, 2, 3], 120, 5)).toBeCloseTo(5, 6);
  });

  test("counts the beats before the first detected onset (rubato intro)", () => {
    // A grid detected only from 2s on is backfilled to t=0 at its own interval, so the
    // head of the recording is still on the grid. It used to collapse to beat 0, which
    // dropped every chord played over the intro.
    expect(totalBeats([2, 3, 4], 120, 1)).toBeCloseTo(1, 6);
    expect(totalBeats([2, 3, 4], 120, 2)).toBeCloseTo(2, 6); // beat 2 is the first onset
    expect(totalBeats([2, 3, 4], 120, 0)).toBeCloseTo(0, 6); // t=0 is beat 0
  });

  test("duration exactly at the last onset yields that beat index", () => {
    expect(totalBeats([0, 1, 2, 3], 120, 3)).toBeCloseTo(3, 6);
  });
});

describe("timeForBeat", () => {
  // A steady 120 BPM grid: one beat every 0.5s, beat 0 at t=0. Mirrors GRID in
  // tests/test_beatgrid.py — the two sides are ports of each other and must not drift.
  const GRID = [0, 0.5, 1.0, 1.5, 2.0];

  test("maps a beat on the grid to its onset", () => {
    expect(timeForBeat(0, GRID, 120, 2)).toBeCloseTo(0);
    expect(timeForBeat(2, GRID, 120, 2)).toBeCloseTo(1.0);
  });

  test("interpolates a half beat", () => {
    expect(timeForBeat(1.5, GRID, 120, 2)).toBeCloseTo(0.75);
  });

  test("extrapolates past the last onset at the final interval, and clamps to duration", () => {
    expect(timeForBeat(6, GRID, 120, 10)).toBeCloseTo(3.0);
    expect(timeForBeat(6, GRID, 120, 2.5)).toBeCloseTo(2.5);
  });

  test("clamps below zero", () => {
    expect(timeForBeat(-4, GRID, 120, 2)).toBeCloseTo(0);
  });

  test("falls back to a BPM division when the tracker found fewer than two onsets", () => {
    expect(timeForBeat(2, [], 120, 10)).toBeCloseTo(1.0);
  });

  test("inverts totalBeats", () => {
    const beats = totalBeats(GRID, 120, 1.75);
    expect(timeForBeat(beats, GRID, 120, 1.75)).toBeCloseTo(1.75);
  });
});
