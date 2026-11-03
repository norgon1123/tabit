import { render, screen } from "@testing-library/react";
import AnalysisStatusBadge from "./AnalysisStatusBadge";

const base = { bpm: null, detected_key_tonic: null, detected_key_mode: null, engine_version: null, error: null, beat_times: [] };

test("shows a spinner while running", () => {
  render(<AnalysisStatusBadge analysis={{ ...base, status: "running" }} />);
  expect(screen.getByRole("status")).toBeInTheDocument();
});

test("no spinner when done", () => {
  render(<AnalysisStatusBadge analysis={{ ...base, status: "done" }} />);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

test("shows the length as MM:SS between the status and the BPM", () => {
  const { container } = render(
    <AnalysisStatusBadge
      analysis={{ ...base, status: "done", bpm: 96, detected_key_tonic: "G", detected_key_mode: "major" }}
      durationSeconds={195}
    />,
  );
  expect(container.textContent).toBe("done · 03:15 · 96 BPM · G major");
});

test("shows the length before analysis finishes", () => {
  const { container } = render(
    <AnalysisStatusBadge analysis={{ ...base, status: "running" }} durationSeconds={62} />,
  );
  expect(container.textContent).toContain("01:02");
});

test("omits the length when the duration is unknown", () => {
  const { container } = render(<AnalysisStatusBadge analysis={{ ...base, status: "done" }} durationSeconds={null} />);
  expect(container.textContent).toBe("done");
});

const detected = { ...base, status: "done" as const, bpm: 144, detected_key_tonic: "C", detected_key_mode: "major" };

test.each([
  // [chart prop, expected badge text] — the chart's value wins per field, falling back to the
  // detected value only where the chart carries none.
  [{ bpm: 72, key_tonic: "A", key_mode: "minor" }, "done · 72 BPM · A minor"],
  [null, "done · 144 BPM · C major"],
  [{ bpm: null, key_tonic: "A", key_mode: "minor" }, "done · 144 BPM · A minor"],
])(
  "shows the player's tempo and key, falling back to the detected values per field (%o → %s)",
  (chart, expected) => {
    const { container } = render(<AnalysisStatusBadge analysis={detected} chart={chart} />);
    expect(container.textContent).toBe(expected);
  },
);

test("carries the status as a class, so colour is never the only channel", () => {
  const { container } = render(<AnalysisStatusBadge analysis={{ ...base, status: "failed", error: "boom" }} />);
  // The status word ("failed") is always in the text too — the class only supplements it.
  expect(container.querySelector(".status--failed")).not.toBeNull();
  expect(container.textContent).toContain("failed");
  // ...and colour must come from that class, not from an inline style attribute on any node.
  const styled = Array.from(container.querySelectorAll("[style]")).map((e) => e.outerHTML.slice(0, 80));
  expect(styled, "AnalysisStatusBadge must carry no inline styles — colour must come from a class").toEqual([]);
});
