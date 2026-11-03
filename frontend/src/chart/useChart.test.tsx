import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { server } from "../test/server";
import { useRecordings } from "../library/useRecordings";
import { useChart } from "./useChart";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const CHART = {
  id: "c1", recording_id: "r1", key_tonic: "C", key_mode: "major",
  segments: [
    { id: "s1", start_time: 0, end_time: 2, chord_root: "C", chord_quality: "maj", roman_numeral: "I" },
  ],
};

test("loads the chart", async () => {
  server.use(http.get("/api/recordings/r1/chart", () => HttpResponse.json(CHART)));
  const { result } = renderHook(() => useChart("r1"), { wrapper });
  await waitFor(() => expect(result.current.chart).not.toBeNull());
  expect(result.current.chart!.segments[0].roman_numeral).toBe("I");
});

test("missing chart (404) resolves to null", async () => {
  server.use(
    http.get("/api/recordings/r1/chart", () => HttpResponse.json({ detail: "Chart not found" }, { status: 404 })),
  );
  const { result } = renderHook(() => useChart("r1"), { wrapper });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.chart).toBeNull();
});

test("accepts a poll option without breaking the chart fetch", async () => {
  server.use(
    http.get("/api/recordings/r1/chart", () =>
      HttpResponse.json({ id: "c1", recording_id: "r1", key_tonic: "C", key_mode: "major", segments: [] }),
    ),
  );
  const { result } = renderHook(() => useChart("r1", { poll: true }), { wrapper });
  await waitFor(() => expect(result.current.chart?.id).toBe("c1"));
});

test("transpose posts semitones to the chart", async () => {
  let body: unknown = null;
  server.use(
    http.get("/api/recordings/r1/chart", () => HttpResponse.json(CHART)),
    http.post("/api/charts/c1/transpose", async ({ request }) => {
      body = await request.json();
      return HttpResponse.json({ ...CHART, key_tonic: "D" });
    }),
  );
  const { result } = renderHook(() => useChart("r1"), { wrapper });
  await waitFor(() => expect(result.current.chart).not.toBeNull());
  await result.current.transpose(2);
  expect(body).toEqual({ semitones: 2 });
});

test("updateSegment patches the right segment", async () => {
  let body: unknown = null;
  server.use(
    http.get("/api/recordings/r1/chart", () => HttpResponse.json(CHART)),
    http.patch("/api/charts/c1/segments/s1", async ({ request }) => {
      body = await request.json();
      return HttpResponse.json({ ...CHART.segments[0], chord_quality: "min", roman_numeral: "i" });
    }),
  );
  const { result } = renderHook(() => useChart("r1"), { wrapper });
  await waitFor(() => expect(result.current.chart).not.toBeNull());
  await result.current.updateSegment("s1", { chord_quality: "min" });
  expect(body).toEqual({ chord_quality: "min" });
});

test("correcting the key patches settings and refreshes numerals, not chords", async () => {
  let body: unknown = null;
  server.use(
    http.get("/api/recordings/r1/chart", () => HttpResponse.json(CHART)),
    http.patch("/api/charts/c1/settings", async ({ request }) => {
      body = await request.json();
      // What the server returns: same chord, re-derived numeral (C is IV in G major).
      return HttpResponse.json({
        ...CHART,
        key_tonic: "G",
        segments: [{ ...CHART.segments[0], roman_numeral: "IV" }],
      });
    }),
  );
  const { result } = renderHook(() => useChart("r1"), { wrapper });
  await waitFor(() => expect(result.current.chart).not.toBeNull());

  await result.current.updateSettings({ key_tonic: "G" });
  expect(body).toEqual({ key_tonic: "G" });
  // The response is adopted into the cache, so the UI re-renders without a refetch.
  await waitFor(() => expect(result.current.chart!.key_tonic).toBe("G"));
  expect(result.current.chart!.segments[0].roman_numeral).toBe("IV");
  expect(result.current.chart!.segments[0].chord_root).toBe("C");
});

const CHART_BEATS = {
  id: "c1", recording_id: "r1", key_tonic: "C", key_mode: "major",
  beats_per_measure: 4, measure_offset: 0, beat_times: [],
  segments: [
    { id: "s1", start_beat: 0, end_beat: 4, start_time: 0, end_time: 2, chord_root: "C", chord_quality: "maj", roman_numeral: "I" },
    { id: "s2", start_beat: 4, end_beat: 8, start_time: 2, end_time: 4, chord_root: "F", chord_quality: "maj", roman_numeral: "IV" },
  ],
};

test("resizeSegments posts the windows and optimistically updates the cache", async () => {
  let body: unknown = null;
  server.use(
    http.get("/api/recordings/r1/chart", () => HttpResponse.json(CHART_BEATS)),
    http.patch("/api/charts/c1/segments", async ({ request }) => {
      body = await request.json();
      // Simulate realistic network latency: without it, the optimistic
      // onMutate update and the onSettled-triggered refetch both resolve
      // within the same microtask flush, so there's no window for RTL's
      // waitFor polling to observe the optimistic state before onSettled's
      // invalidate/refetch overwrites it with the (identical) server response.
      await new Promise((r) => setTimeout(r, 150));
      return HttpResponse.json(CHART_BEATS);
    }),
  );
  const { result } = renderHook(() => useChart("r1"), { wrapper });
  await waitFor(() => expect(result.current.chart).not.toBeNull());

  const windows = [
    { id: "s1", start_beat: 0, end_beat: 6 },
    { id: "s2", start_beat: 6, end_beat: 8 },
  ];
  const promise = result.current.resizeSegments(windows);
  // Optimistic: the cache reflects the new beats before the request resolves.
  await waitFor(() => expect(result.current.chart!.segments[0].end_beat).toBe(6));
  await promise;
  expect(body).toEqual({ segments: windows });
});

/** A server whose library listing reflects the chart edits made against it. */
function serveLibraryAndChart() {
  const chart = { ...CHART_BEATS, bpm: 144, key_tonic: "C", key_mode: "major" };
  server.use(
    http.get("/api/recordings/r1/chart", () => HttpResponse.json(chart)),
    http.patch("/api/charts/c1/tempo", async ({ request }) => {
      chart.bpm = ((await request.json()) as { bpm: number }).bpm;
      return HttpResponse.json(chart);
    }),
    http.patch("/api/charts/c1/settings", async ({ request }) => {
      Object.assign(chart, (await request.json()) as object);
      return HttpResponse.json(chart);
    }),
    http.get("/api/recordings", () =>
      HttpResponse.json([
        {
          id: "r1", original_filename: "song.m4a", format: "m4a", duration_seconds: 30,
          status: "uploaded", created_at: "2026-06-01T00:00:00Z",
          analysis: { status: "done", bpm: 144, detected_key_tonic: "C", detected_key_mode: "major", engine_version: "v1", error: null, beat_times: [] },
          chart: { bpm: chart.bpm, key_tonic: chart.key_tonic, key_mode: chart.key_mode },
        },
      ]),
    ),
  );
}

// The library and the chart sheet are separate caches over the same song. An edit the
// player makes on the sheet has to reach the library, or the song reads one tempo in one
// place and another in the other.
test.each([
  [
    "setting the tempo",
    async (chart: ReturnType<typeof useChart>) => {
      await chart.setTempo(72);
    },
    (listed: NonNullable<ReturnType<typeof useRecordings>["recordings"][number]["chart"]>) =>
      expect(listed.bpm).toBe(72),
  ],
  [
    "correcting the key",
    async (chart: ReturnType<typeof useChart>) => {
      await chart.updateSettings({ key_tonic: "A", key_mode: "minor" });
    },
    (listed: NonNullable<ReturnType<typeof useRecordings>["recordings"][number]["chart"]>) =>
      expect([listed.key_tonic, listed.key_mode]).toEqual(["A", "minor"]),
  ],
])("a sheet edit refreshes the library listing (%s)", async (_label, performMutation, assertListed) => {
  serveLibraryAndChart();
  const { result } = renderHook(() => ({ chart: useChart("r1"), library: useRecordings() }), { wrapper });
  await waitFor(() => expect(result.current.library.recordings[0]?.chart).toBeTruthy());

  await performMutation(result.current.chart);

  await waitFor(() => assertListed(result.current.library.recordings[0]!.chart!));
});
