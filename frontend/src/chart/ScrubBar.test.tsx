import { render, screen, fireEvent } from "@testing-library/react";
import ScrubBar from "./ScrubBar";
import { type BeatGridInfo } from "./musicalPosition";

/** 120 BPM, 4/4 — a beat every 0.5s, a bar every 2s. */
const GRID: BeatGridInfo = {
  beatTimes: Array.from({ length: 33 }, (_, i) => i * 0.5),
  bpm: 120,
  duration: 16,
  beatsPerMeasure: 4,
  measureOffset: 0,
};

function mockRect(el: Element, left: number, width: number) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    left,
    width,
    top: 0,
    right: left + width,
    bottom: 14,
    height: 14,
    x: left,
    y: 0,
    toJSON: () => {},
  } as DOMRect);
}

test("clicking the track seeks to that fraction of the duration", () => {
  const onSeek = vi.fn();
  render(<ScrubBar currentTime={0} duration={10} playing={false} rate={1} grid={GRID} onSeek={onSeek} />);
  const slider = screen.getByRole("slider");
  mockRect(slider, 0, 200);
  fireEvent.pointerDown(slider, { clientX: 100, pointerId: 1 });
  expect(onSeek).toHaveBeenCalledWith(5);
});

test("dragging scrubs continuously", () => {
  const onSeek = vi.fn();
  render(<ScrubBar currentTime={0} duration={10} playing={false} rate={1} grid={GRID} onSeek={onSeek} />);
  const slider = screen.getByRole("slider");
  mockRect(slider, 0, 200);
  fireEvent.pointerDown(slider, { clientX: 0, pointerId: 1 });
  fireEvent.pointerMove(slider, { clientX: 150, pointerId: 1 });
  expect(onSeek).toHaveBeenLastCalledWith(7.5);
});

test("reflects the current fraction on the fill when paused", () => {
  const { container } = render(
    <ScrubBar currentTime={5} duration={10} playing={false} rate={1} grid={GRID} onSeek={() => {}} />,
  );
  const fill = container.querySelector(".scrub-fill") as HTMLElement;
  expect(fill.style.transform).toBe("scaleX(0.5)");
});

test("arms a compositor transition toward the end while playing", () => {
  // Flush requestAnimationFrame synchronously so the arming runs deterministically.
  const rafSpy = vi
    .spyOn(window, "requestAnimationFrame")
    .mockImplementation((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  try {
    const { container } = render(
      <ScrubBar currentTime={5} duration={10} playing={true} rate={1} grid={GRID} onSeek={() => {}} />,
    );
    const fill = container.querySelector(".scrub-fill") as HTMLElement;
    const knob = container.querySelector(".scrub-knob") as HTMLElement;
    expect(fill.style.transition).toContain("transform");
    expect(fill.style.transform).toBe("scaleX(1)");
    expect(knob.style.left).toBe("100%");
  } finally {
    rafSpy.mockRestore();
  }
});

test("ignores seeks before duration is known", () => {
  const onSeek = vi.fn();
  render(<ScrubBar currentTime={0} duration={0} playing={false} rate={1} grid={GRID} onSeek={onSeek} />);
  const slider = screen.getByRole("slider");
  mockRect(slider, 0, 200);
  fireEvent.pointerDown(slider, { clientX: 100, pointerId: 1 });
  expect(onSeek).not.toHaveBeenCalled();
});

describe("the scrubber speaks music, not seconds", () => {
  it("announces its position as a bar and a beat, and tracks it as the song moves", () => {
    // THE point of replacing the native <audio> slider: "87 seconds" tells a musician nothing;
    // "bar 12, beat 2" tells them where to put their hands — and the announcement must follow a
    // changing currentTime, so drive it across several positions on the same instance.
    const props = { duration: 16, playing: false, rate: 1, grid: GRID, onSeek: () => {} } as const;
    const { rerender } = render(<ScrubBar currentTime={0} {...props} />);
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuetext", "bar 1, beat 1");

    rerender(<ScrubBar currentTime={2.5} {...props} />);
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuetext", "bar 2, beat 2");

    rerender(<ScrubBar currentTime={4.0} {...props} />);
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuetext", "bar 3, beat 1");
  });

  it("is not a live region — it must not announce while the song plays", () => {
    // During playback the user is LISTENING. Screen-reader speech and the music compete
    // for the same channel; a slider that narrated every beat would be actively hostile.
    // aria-valuetext is read when the user MOVES the slider, which is the whole point:
    // it speaks when spoken to.
    render(<ScrubBar currentTime={4} duration={16} playing rate={1} grid={GRID} onSeek={() => {}} />);
    const slider = screen.getByRole("slider");
    expect(slider).not.toHaveAttribute("aria-live");
    expect(slider.closest("[aria-live]")).toBeNull();
    expect(slider).not.toHaveAttribute("role", "status");
  });

  it("keeps its numeric value too, for assistive tech that wants a ratio", () => {
    render(<ScrubBar currentTime={4} duration={16} playing={false} rate={1} grid={GRID} onSeek={() => {}} />);
    const slider = screen.getByRole("slider");
    expect(slider).toHaveAttribute("aria-valuenow", "4");
    expect(slider).toHaveAttribute("aria-valuemin", "0");
    expect(slider).toHaveAttribute("aria-valuemax", "16");
  });

  it("seeks with the arrow keys — the keyboard path to scrubbing", () => {
    // The scrubber is a real slider, so it must move from the keyboard, not just the pointer.
    // This behaviour existed but was asserted nowhere; lock it.
    const onSeek = vi.fn();
    render(<ScrubBar currentTime={8} duration={16} playing={false} rate={1} grid={GRID} onSeek={onSeek} />);
    const slider = screen.getByRole("slider");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onSeek).toHaveBeenCalledWith(13); // 8 + 5
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(onSeek).toHaveBeenLastCalledWith(3); // 8 - 5
  });
});
