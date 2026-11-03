import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../test/server";
import { renderWithProviders } from "../test/utils";
import ChartEditorPage from "./ChartEditorPage";

// These open at `?mode=edit`: a song with no mode lands on the chart-or-practice chooser,
// which ChartEditorPage.practice.test.tsx covers along with practice mode itself.

function login() {
  server.use(http.get("/api/auth/me", () => HttpResponse.json({ id: "u1", username: "alice" })));
}

const RECORDING = {
  id: "r1", original_filename: "song.m4a", format: "m4a", duration_seconds: 4, status: "uploaded",
  analysis: {
    status: "done", bpm: 120, detected_key_tonic: "C", detected_key_mode: "major",
    engine_version: "template-v1", error: null, beat_times: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5],
  },
};
// Charts are beat-native: segments carry start_beat/end_beat on the grid, seconds are derived.
const CHART = {
  id: "c1", recording_id: "r1", key_tonic: "C", key_mode: "major",
  beats_per_measure: 4, measure_offset: 0, bpm: 120, beat_times: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5],
  segments: [
    { id: "s1", start_beat: 0, end_beat: 4, start_time: 0, end_time: 2, chord_root: "C", chord_quality: "maj", roman_numeral: "I" },
    { id: "s2", start_beat: 4, end_beat: 8, start_time: 2, end_time: 4, chord_root: "G", chord_quality: "maj", roman_numeral: "V" },
  ],
};

test("has no inline styles left in the title row", async () => {
  login();
  server.use(
    http.get("/api/recordings/r1", () => HttpResponse.json(RECORDING)),
    http.get("/api/recordings/r1/chart", () => HttpResponse.json(CHART)),
  );
  const { container } = renderWithProviders(<ChartEditorPage />, {
    route: "/recordings/r1",
    path: "/recordings/:recordingId",
  });

  expect(await screen.findByRole("heading", { name: /how do you want to open/i })).toBeInTheDocument();
  expect(Array.from(container.querySelectorAll("[style]"))).toEqual([]);
});

test("shows BPM, key, and the chord timeline", async () => {
  login();
  server.use(
    http.get("/api/recordings/r1", () => HttpResponse.json(RECORDING)),
    http.get("/api/recordings/r1/chart", () => HttpResponse.json(CHART)),
  );
  renderWithProviders(<ChartEditorPage />, { route: "/recordings/r1?mode=edit", path: "/recordings/:recordingId" });
  // Tempo and key sit above the player as editable text, not as a panel of form fields.
  expect(await screen.findByRole("button", { name: /tempo: 120 BPM/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /key: C major/i })).toBeInTheDocument();
  expect(screen.getByText("I")).toBeInTheDocument();
  expect(screen.getByText("V")).toBeInTheDocument();
});

test("shows analyzing state when the chart is not ready", async () => {
  login();
  server.use(
    http.get("/api/recordings/r1", () =>
      HttpResponse.json({ ...RECORDING, analysis: { ...RECORDING.analysis, status: "running" } }),
    ),
    http.get("/api/recordings/r1/chart", () => HttpResponse.json({ detail: "Chart not found" }, { status: 404 })),
  );
  renderWithProviders(<ChartEditorPage />, { route: "/recordings/r1?mode=edit", path: "/recordings/:recordingId" });
  // Both the header loading indicator and the body placeholder say "Analyzing…".
  expect((await screen.findAllByText(/analyzing/i)).length).toBeGreaterThan(0);
});

test("re-analyze button posts to the analyze endpoint", async () => {
  login();
  let hit = false;
  server.use(
    http.get("/api/recordings/r1", () => HttpResponse.json(RECORDING)),
    http.get("/api/recordings/r1/chart", () => HttpResponse.json(CHART)),
    http.post("/api/recordings/r1/analyze", () => {
      hit = true;
      return HttpResponse.json(
        { status: "pending", bpm: null, detected_key_tonic: null, detected_key_mode: null, engine_version: null, error: null },
        { status: 202 },
      );
    }),
  );
  renderWithProviders(<ChartEditorPage />, { route: "/recordings/r1?mode=edit", path: "/recordings/:recordingId" });
  await screen.findByText(/120 BPM/i);
  await userEvent.click(screen.getByRole("button", { name: /re-analyze/i }));
  await waitFor(() => expect(hit).toBe(true));
});

test("shows a spinner while analysis is running", async () => {
  login();
  server.use(
    http.get("/api/recordings/r1", () =>
      HttpResponse.json({ ...RECORDING, analysis: { ...RECORDING.analysis, status: "running" } }),
    ),
    http.get("/api/recordings/r1/chart", () => HttpResponse.json({ detail: "Chart not found" }, { status: 404 })),
  );
  renderWithProviders(<ChartEditorPage />, { route: "/recordings/r1?mode=edit", path: "/recordings/:recordingId" });
  expect(await screen.findByRole("status")).toBeInTheDocument();
});

// The audio player is rendered with the chart, so a page opened while analysis is still
// running has no player at all. A slow engine (demucs -> btc) is always still running when
// you land here, so without polling the player never appears until a manual reload.
test("player appears on its own once analysis finishes", async () => {
  login();
  let done = false;
  server.use(
    http.get("/api/recordings/r1", () =>
      HttpResponse.json({
        ...RECORDING,
        analysis: { ...RECORDING.analysis, status: done ? "done" : "running" },
      }),
    ),
    http.get("/api/recordings/r1/chart", () =>
      done
        ? HttpResponse.json(CHART)
        : HttpResponse.json({ detail: "Chart not found" }, { status: 404 }),
    ),
  );
  const { container } = renderWithProviders(<ChartEditorPage />, {
    route: "/recordings/r1?mode=edit",
    path: "/recordings/:recordingId",
  });

  // Both the header loading indicator and the body placeholder say "Analyzing…".
  expect((await screen.findAllByText(/analyzing/i)).length).toBeGreaterThan(0);
  expect(container.querySelector("audio")).toBeNull();

  done = true; // the analysis job finishes server-side; nothing reloads the page

  // The chart poll runs every 2s, so allow a few cycles — and keep the test's own budget
  // (last arg) above that, or it dies on the default 5s timeout before waitFor can settle.
  await waitFor(() => expect(container.querySelector("audio")).not.toBeNull(), { timeout: 10000 });
  const player = container.querySelector("audio")!;
  // The control deck is the transport now, not the native player — no `controls` attribute,
  // so there is no duplicate set of play/scrub UI on the page.
  expect(player).not.toHaveAttribute("controls");
  expect(player).toHaveAttribute("src", "/api/recordings/r1/audio");
}, 15000);
