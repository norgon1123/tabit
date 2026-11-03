import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../test/server";
import { renderWithProviders } from "../test/utils";
import ChartEditorPage from "./ChartEditorPage";

function login() {
  server.use(http.get("/api/auth/me", () => HttpResponse.json({ id: "u1", username: "alice" })));
}

const RECORDING = {
  id: "r1", original_filename: "song.m4a", format: "m4a", duration_seconds: 4, status: "uploaded",
  analysis: {
    status: "done", bpm: 120, detected_key_tonic: "C", detected_key_mode: "major",
    engine_version: "chordino-v1", error: null, beat_times: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5],
  },
};
const CHART = {
  id: "c1", recording_id: "r1", key_tonic: "C", key_mode: "major",
  beats_per_measure: 4, measure_offset: 0, bpm: 120, beat_times: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5],
  segments: [
    { id: "s1", start_beat: 0, end_beat: 4, start_time: 0, end_time: 2, chord_root: "C", chord_quality: "maj", roman_numeral: "I" },
    { id: "s2", start_beat: 4, end_beat: 8, start_time: 2, end_time: 4, chord_root: "G", chord_quality: "dom7", roman_numeral: "V7" },
  ],
};

function serveChart() {
  server.use(
    http.get("/api/recordings/r1", () => HttpResponse.json(RECORDING)),
    http.get("/api/recordings/r1/chart", () => HttpResponse.json(CHART)),
  );
}

function open(route: string) {
  return renderWithProviders(<ChartEditorPage />, { route, path: "/recordings/:recordingId" });
}

test("opening a song asks how to open it, and does not show the chart until answered", async () => {
  login();
  serveChart();
  open("/recordings/r1");

  expect(await screen.findByRole("heading", { name: /how do you want to open/i })).toBeInTheDocument();
  // No chords either way round — the question comes first.
  expect(screen.queryByText("Gdom7")).toBeNull();
  expect(screen.queryByText("?")).toBeNull();

  await userEvent.click(screen.getByRole("button", { name: /open the chart/i }));
  expect(await screen.findByText("Gdom7")).toBeInTheDocument();
});

test("practice mode hides every chord behind a ?, and keeps the beats", async () => {
  login();
  serveChart();
  const { container } = open("/recordings/r1?mode=practice");

  await waitFor(() => expect(screen.getAllByText("?")).toHaveLength(2));

  // The chords themselves — and the roman numerals, which would give them away against a
  // key the player can see — are nowhere on the page.
  expect(screen.queryByText("C")).toBeNull();
  expect(screen.queryByText("Gdom7")).toBeNull();
  expect(screen.queryByText("I")).toBeNull();
  expect(screen.queryByText("V7")).toBeNull();

  // The rhythm is the question's context, so it stays: four slashes for a four-beat chord.
  expect(container.querySelectorAll(".slash-marks")[0]).toHaveTextContent("╱ ╱ ╱ ╱");
  expect(screen.getByText(/0 of 2 chords named/i)).toBeInTheDocument();

  // Nothing to edit, and nothing to grab: practice mode does not rewrite the chart.
  expect(screen.queryByRole("button", { name: /advanced options/i })).toBeNull();
  expect(screen.queryByRole("button", { name: /re-analyze/i })).toBeNull();
  expect(container.querySelector('[aria-label^="Resize"]')).toBeNull();
});

test("a wrong answer keeps the chord hidden; the right one reveals it", async () => {
  login();
  serveChart();
  open("/recordings/r1?mode=practice");

  await waitFor(() => expect(screen.getAllByText("?")).toHaveLength(2));
  // Both chords run four beats (Task 8's label also states each cell's bar/beat, which now
  // differs between them), so match on the shared "4 beats" fragment; the second cell is s2.
  const masked = screen.getAllByRole("button", { name: /hidden chord.*4 beats/i });
  expect(masked).toHaveLength(2);
  await userEvent.click(masked[1]);

  const panel = await screen.findByText("Name that chord");
  const form = panel.closest(".chord-guess")!;

  // s2 is Gdom7. Guess C major.
  await userEvent.selectOptions(within(form as HTMLElement).getByLabelText("Root"), "C");
  await userEvent.selectOptions(within(form as HTMLElement).getByLabelText("Quality"), "Major");
  await userEvent.click(within(form as HTMLElement).getByRole("button", { name: "Submit" }));

  // Polite (role="status"), not assertive: the guess answers a question the user just
  // asked, but nothing about it is urgent enough to interrupt over the music.
  const wrongMessage = await screen.findByText(/not that one/i);
  expect(wrongMessage).toHaveAttribute("role", "status");
  expect(form.className).toMatch(/chord-guess--wrong/);
  expect(screen.getAllByText("?")).toHaveLength(2); // still hidden
  expect(screen.queryByText("Gdom7")).toBeNull();

  // Now the real chord.
  await userEvent.selectOptions(within(form as HTMLElement).getByLabelText("Root"), "G");
  await userEvent.selectOptions(
    within(form as HTMLElement).getByLabelText("Quality"),
    "Dominant 7th",
  );
  await userEvent.click(within(form as HTMLElement).getByRole("button", { name: "Submit" }));

  // Revealed on the chart, the form gone, and the count moves.
  expect(await screen.findByText("Gdom7")).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText("Name that chord")).toBeNull());
  expect(screen.getAllByText("?")).toHaveLength(1); // the other chord is still a question
  expect(screen.getByText(/1 of 2 chords named/i)).toBeInTheDocument();
  // Revealing a chord reveals only that chord — its neighbour keeps its numeral hidden too.
  expect(screen.queryByText("I")).toBeNull();
  expect(screen.getByText("V7")).toBeInTheDocument();
});

// The green flash is 700ms of "yes, that's it" — and an eager player spends it clicking the
// next "?". Nothing about naming a chord may depend on them sitting still afterwards: the
// answer is right the moment it is submitted, and the flash is a nicety on top of a solve
// that has already happened.
test("a correct answer sticks even if the player moves straight on to the next chord", async () => {
  login();
  serveChart();
  open("/recordings/r1?mode=practice");

  await waitFor(() => expect(screen.getAllByText("?")).toHaveLength(2));
  await userEvent.click(screen.getAllByRole("button", { name: /hidden chord/i })[1]); // s2

  const form = (await screen.findByText("Name that chord")).closest(".chord-guess") as HTMLElement;
  await userEvent.selectOptions(within(form).getByLabelText("Root"), "G");
  await userEvent.selectOptions(within(form).getByLabelText("Quality"), "Dominant 7th");
  await userEvent.click(within(form).getByRole("button", { name: "Submit" }));

  // Straight on to the other chord, without waiting for the flash to finish. (s1 is first in
  // the chart either way, so this picks it whether or not s2 has already been revealed.)
  await userEvent.click(screen.getAllByRole("button", { name: /hidden chord/i })[0]);

  expect(screen.getByText("Gdom7")).toBeInTheDocument(); // still named
  expect(screen.getAllByText("?")).toHaveLength(1);
  expect(screen.getByText(/1 of 2 chords named/i)).toBeInTheDocument();
});

// Practice mode's only interaction is clicking a chord, so a chord that cannot be reached
// from the keyboard cannot be played at all — the cell is a native <button> (wrapped in a
// role="listitem" <span> so a vamp is one list entry, but the button itself keeps its native
// role and keyboard behaviour) and has to answer to Enter.
test("a masked chord opens with the keyboard", async () => {
  login();
  serveChart();
  open("/recordings/r1?mode=practice");

  await waitFor(() => expect(screen.getAllByText("?")).toHaveLength(2));
  screen.getAllByRole("button", { name: /hidden chord/i })[0].focus();
  await userEvent.keyboard("{Enter}");

  expect(await screen.findByText("Name that chord")).toBeInTheDocument();
});

test("clicking a chord you have already named shows it, rather than an empty selection", async () => {
  login();
  serveChart();
  open("/recordings/r1?mode=practice");

  await waitFor(() => expect(screen.getAllByText("?")).toHaveLength(2));
  await userEvent.click(screen.getAllByRole("button", { name: /hidden chord/i })[0]); // s1 = C

  const form = (await screen.findByText("Name that chord")).closest(".chord-guess") as HTMLElement;
  await userEvent.selectOptions(within(form).getByLabelText("Root"), "C");
  await userEvent.selectOptions(within(form).getByLabelText("Quality"), "Major");
  await userEvent.click(within(form).getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(screen.queryByText("Name that chord")).toBeNull());

  // Back to a chord that is already named: it says so, instead of selecting into nothing.
  await userEvent.click(screen.getByText("C").closest(".chord-cell")!);
  expect(await screen.findByText(/you named this one/i)).toBeInTheDocument();
  expect(screen.queryByText("Name that chord")).toBeNull();
});

test("a chart with no chords does not congratulate the player on naming all zero of them", async () => {
  login();
  server.use(
    http.get("/api/recordings/r1", () => HttpResponse.json(RECORDING)),
    http.get("/api/recordings/r1/chart", () => HttpResponse.json({ ...CHART, segments: [] })),
  );
  open("/recordings/r1?mode=practice");

  expect(await screen.findByText(/no chords in this chart/i)).toBeInTheDocument();
  expect(screen.queryByText(/all 0 chords named/i)).toBeNull();
});

// This is the rule the whole phase turns on: during playback the user is LISTENING, and a
// live region narrating "3 of 8 chords named" over the top of the song is actively hostile
// — the assistive equivalent of someone shouting chords at you while you practise. The text
// stays on screen either way; only the role (and so the announcement) comes and goes.
test("the practice status line stops announcing while playing, and speaks again once paused", async () => {
  login();
  serveChart();
  const { container } = open("/recordings/r1?mode=practice");

  await waitFor(() => expect(screen.getAllByText("?")).toHaveLength(2));

  const status = () => container.querySelector(".chart-practice-status");
  expect(status()).toHaveAttribute("role", "status");

  const audio = container.querySelector("audio")!;
  fireEvent.play(audio);
  await waitFor(() => expect(status()).not.toHaveAttribute("role"));
  // Still visible — it just stopped speaking.
  expect(status()).toHaveTextContent(/0 of 2 chords named/i);

  fireEvent.pause(audio);
  await waitFor(() => expect(status()).toHaveAttribute("role", "status"));
});

test("practice mode dims the chart into a spotlight (#Phase3)", async () => {
  login();
  serveChart();
  const { container } = open("/recordings/r1?mode=practice");

  await waitFor(() => expect(screen.getAllByText("?")).toHaveLength(2));
  // The chart recedes and desaturates so the deck and the guess panel are the lit things.
  // The attribute is the hook the theme-independent CSS dims against; assert the contract.
  expect(container.querySelector(".chart-workspace")).toHaveAttribute("data-practice", "true");
});

test("the editing chart is NOT dimmed — the spotlight is a practice-only treatment (#Phase3)", async () => {
  login();
  serveChart();
  const { container } = open("/recordings/r1?mode=edit");

  await screen.findByText("Gdom7");
  // Mode is about what the app is doing; the editor is not practice, so no spotlight.
  expect(container.querySelector(".chart-workspace")).not.toHaveAttribute("data-practice");
});

test("the player can give up and switch to the chart", async () => {
  login();
  serveChart();
  open("/recordings/r1?mode=practice");

  await waitFor(() => expect(screen.getAllByText("?")).toHaveLength(2));
  await userEvent.click(screen.getByRole("button", { name: /show the chords/i }));

  expect(await screen.findByText("Gdom7")).toBeInTheDocument();
  expect(screen.queryByText("?")).toBeNull();
});
