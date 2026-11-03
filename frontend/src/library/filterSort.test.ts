import { filterAndSortRecordings } from "./filterSort";
import type { RecordingOut } from "../api/types";

function rec(id: string, name: string, createdAt: string): RecordingOut {
  return {
    id,
    original_filename: name,
    format: "m4a",
    duration_seconds: 1,
    status: "uploaded",
    created_at: createdAt,
    analysis: null,
    chart: null,
  };
}

const A = rec("a", "Blue in Green.m4a", "2026-06-01T00:00:00Z");
const B = rec("b", "Autumn Leaves.m4a", "2026-06-03T00:00:00Z");
const C = rec("c", "blue MONK.m4a", "2026-06-02T00:00:00Z");
const all = [A, B, C];

it.each([
  ["newest", ["b", "c", "a"]],
  ["oldest", ["a", "c", "b"]],
] as const)("empty query returns all, sorted by created_at %s first", (direction, expectedIds) => {
  const result = filterAndSortRecordings(all, "", direction);
  // An empty query is the "everything" case: no filtering, the whole set comes back...
  expect(result).toHaveLength(all.length);
  // ...ordered by created_at in the requested direction.
  expect(result.map((r) => r.id)).toEqual(expectedIds);
});

test("whitespace-only query matches all", () => {
  expect(filterAndSortRecordings(all, "   ", "newest")).toHaveLength(3);
});

test("filter is case-insensitive substring on filename", () => {
  expect(filterAndSortRecordings(all, "blue", "newest").map((r) => r.id)).toEqual(["c", "a"]);
});

test("no match returns empty array", () => {
  expect(filterAndSortRecordings(all, "zzz", "newest")).toEqual([]);
});

test("does not mutate the input array", () => {
  const input = [...all];
  filterAndSortRecordings(input, "", "oldest");
  expect(input.map((r) => r.id)).toEqual(["a", "b", "c"]);
});
