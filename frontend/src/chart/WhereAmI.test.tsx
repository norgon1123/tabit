import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WhereAmI from "./WhereAmI";
import { PlaybackProvider } from "./PlaybackContext";
import type { BeatGridInfo } from "./musicalPosition";

const GRID: BeatGridInfo = {
  beatTimes: Array.from({ length: 33 }, (_, i) => i * 0.5),
  bpm: 120,
  duration: 16,
  beatsPerMeasure: 4,
  measureOffset: 0,
};

const renderIt = () =>
  render(
    <PlaybackProvider>
      <WhereAmI grid={GRID} />
    </PlaybackProvider>,
  );

describe("WhereAmI", () => {
  it("says nothing until it is asked", () => {
    // This exists BECAUSE we are not allowed a live region. During playback the user is
    // listening, and a chart that narrated every chord change would talk over the song
    // they are trying to learn. So: on demand, never volunteered.
    const { container } = renderIt();
    expect(container.querySelector("[aria-live]")?.textContent ?? "").toBe("");
  });

  it("reports the position into a polite live region when pressed", async () => {
    // Polite, not assertive: aria-live="assertive" would cut across whatever the screen
    // reader was saying. The user asked a question; they can wait a beat for the answer.
    renderIt();
    await userEvent.click(screen.getByRole("button", { name: /where am i/i }));
    const region = screen.getByRole("status");
    expect(region).toHaveTextContent(/bar 1, beat 1/i);
    expect(region).toHaveAttribute("aria-live", "polite");
  });
});
