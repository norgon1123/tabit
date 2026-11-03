import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Timeline from "./Timeline";
import { beatSlashMarks } from "./beatMath";
import type { BeatGridInfo } from "./musicalPosition";

const segments = [
  { id: "s1", start_beat: 0, end_beat: 4, start_time: 0, end_time: 2, chord_root: "C", chord_quality: "maj", roman_numeral: "I" },
  { id: "s2", start_beat: 4, end_beat: 8, start_time: 2, end_time: 4, chord_root: "G", chord_quality: "maj", roman_numeral: "V" },
];

// bpm 120 -> a beat every 0.5s; beatsPerMeasure 4, no pickup. Matches `segments` above:
// s1 starts at t=0 (bar 1, beat 1), s2 starts at t=2 (bar 2, beat 1).
const GRID: BeatGridInfo = {
  beatTimes: Array.from({ length: 9 }, (_, i) => i * 0.5),
  bpm: 120,
  duration: 4,
  beatsPerMeasure: 4,
  measureOffset: 0,
};

function renderTimeline(props: Partial<React.ComponentProps<typeof Timeline>> = {}) {
  return render(
    <Timeline
      segments={segments}
      beatsPerMeasure={4}
      measureOffset={0}
      duration={4}
      currentTime={0}
      selectedId={null}
      onSelect={() => {}}
      grid={GRID}
      {...props}
    />,
  );
}

test("renders each segment's chord and roman numeral", () => {
  renderTimeline();
  expect(screen.getByText("C")).toBeInTheDocument();
  expect(screen.getByText("I")).toBeInTheDocument();
  expect(screen.getByText("G")).toBeInTheDocument();
  expect(screen.getByText("V")).toBeInTheDocument();
});

test("clicking a segment selects it and seeks to its start (#8)", async () => {
  const onSelect = vi.fn();
  const onSeek = vi.fn();
  renderTimeline({ onSelect, onSeek });
  await userEvent.click(screen.getByText("G"));
  expect(onSelect).toHaveBeenCalledWith("s2");
  expect(onSeek).toHaveBeenCalledWith(2);
});

test("a keyboard user can tab to a chord and press Enter to select it", async () => {
  // The chord cells are real <button>s for exactly this reason: in practice mode,
  // clicking a chord *is* the question, and a keyboard user has no other way to reach it.
  const onSelect = vi.fn();
  const onSeek = vi.fn();
  renderTimeline({ onSelect, onSeek });
  await userEvent.tab();
  expect(document.activeElement).toHaveAttribute("data-segment-id", "s1");
  await userEvent.keyboard("{Enter}");
  expect(onSelect).toHaveBeenCalledWith("s1");
  expect(onSeek).toHaveBeenCalledWith(0);
});

test("highlights the chord under the playhead (#3)", () => {
  const { container } = renderTimeline({ currentTime: 3 }); // inside s2 [2,4)
  const playing = container.querySelectorAll('[data-playing="true"]');
  expect(playing).toHaveLength(1);
  expect(playing[0]).toHaveAttribute("data-segment-id", "s2");
});

test("renders resize handles on each edge when resizable (#2)", () => {
  renderTimeline({ onResizeCommit: vi.fn() });
  expect(screen.getByLabelText("Resize start of C")).toBeInTheDocument();
  expect(screen.getByLabelText("Resize end of C")).toBeInTheDocument();
});

test("fills the active chord's progress bar to the current fraction when paused", () => {
  const { container } = renderTimeline({ currentTime: 3 }); // halfway through s2 [2,4)
  const bar = container.querySelector('[data-segment-id="s2"] .chord-progress') as HTMLElement;
  expect(bar).toBeInTheDocument();
  // Paused: the fill snaps (no compositor transition) to the true fraction via scaleX.
  expect(bar.style.transform).toBe("scaleX(0.5)");
});

it("marks the selected cell", () => {
  const { container } = renderTimeline({ selectedId: "s1" });
  const cell = (id: string) => container.querySelector(`[data-segment-id="${id}"]`) as HTMLElement;
  expect(cell("s1")).toHaveAttribute("data-selected", "true");
});

// A CSS transition only animates when the browser already holds a computed value to
// interpolate *from*. The fill span is rendered fresh for each chord, so its start value
// has to be flushed to style before the transition toward scaleX(1) is armed — otherwise
// the browser resolves the element's style for the first time already at scaleX(1) and
// the bar appears full the instant the chord begins. jsdom does not run transitions, so
// the flush (a layout read) is what we can observe; record the fill's transform at each.
function recordFillFlushes(): string[] {
  const flushed: string[] = [];
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.classList.contains("chord-progress")) flushed.push(this.style.transform);
    return 0;
  });
  return flushed;
}

test("a newly active chord's progress bar starts empty, not full", () => {
  const flushed = recordFillFlushes();
  // Playing, playhead just inside s2 [2,4) — the chord has only just begun.
  const { container } = renderTimeline({ currentTime: 2, playing: true, rate: 1 });
  const bar = container.querySelector('[data-segment-id="s2"] .chord-progress') as HTMLElement;
  expect(bar).toBeInTheDocument();
  // The empty start value must reach the browser before the fill is armed.
  expect(flushed).toEqual(["scaleX(0)"]);
  expect(bar.style.transition).toBe("transform 2s linear");
  vi.restoreAllMocks();
});

test("the fill spans the whole chord even when the media clock lags the boundary", () => {
  vi.useFakeTimers();
  const flushed = recordFillFlushes();
  // timeupdate only fires ~4Hz, so the chord can flip on the boundary timer while the last
  // clock reading still sits inside s1. s2's bar must still start empty and run for s2's
  // full 2s — not 2.2s measured from the stale reading.
  const { container } = renderTimeline({ currentTime: 1.8, playing: true, rate: 1 });
  flushed.length = 0; // drop s1's paint; we care about the hand-off to s2
  act(() => void vi.advanceTimersByTime(250)); // boundary timer fires: active chord -> s2

  const bar = container.querySelector('[data-segment-id="s2"] .chord-progress') as HTMLElement;
  expect(bar).toBeInTheDocument();
  expect(flushed).toEqual(["scaleX(0)"]);
  expect(bar.style.transition).toBe("transform 2s linear");
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("renders slash marks for a 4-beat chord", () => {
  const segs = [{
    id: "s1", start_beat: 0, end_beat: 4, start_time: 0, end_time: 2,
    chord_root: "C", chord_quality: "maj", roman_numeral: "I",
  }];
  // Render Timeline with the new props (mirror the existing test's render call).
  renderTimeline({ segments: segs, beatsPerMeasure: 4, measureOffset: 0 });
  expect(screen.getByText(beatSlashMarks(4))).toBeInTheDocument(); // "╱ ╱ ╱ ╱"
});

// Fixture shared by the width-guard test below — this file has no module-level BASE, so
// one is built locally rather than disturbing the fixtures every other test already uses.
const BASE = { chord_root: "C", chord_quality: "maj", roman_numeral: "I" };

describe("the chart is a semantic sequence, not a pile of divs", () => {
  it("names itself, so a screen-reader user can find it", () => {
    renderTimeline();
    expect(screen.getByRole("list", { name: /chord chart/i })).toBeInTheDocument();
  });

  it("tells a player where each chord IS, how long it lasts", () => {
    // "C, button" is what the chart said before. It gave a blind or low-vision player no
    // idea where in the song they were or how long to stay on the chord. Both are things a
    // sighted player reads off the page instantly.
    //
    // The chord's first box is a real <button> (wrapped in a role="listitem" <span> so a vamp
    // is ONE list entry, not one per bar) — the label lives on the button, which keeps its
    // native role so a screen reader still announces it as an activatable control.
    renderTimeline();
    const cells = screen.getAllByRole("button", { name: /bar \d+/i });
    expect(cells.length).toBeGreaterThan(0);
    expect(cells[0]).toHaveAccessibleName(/bar 1, beat 1/i);
    expect(cells[0]).toHaveAccessibleName(/beats/i);
  });

  it("exposes each chord as a real button inside a listitem, not a role-swapped button", () => {
    // The regression: putting role="listitem" directly on the <button> overrides its native
    // button role, so a screen reader announces the chord as a plain list row — losing the
    // control affordance that IS the interaction in practice mode. role="listitem" belongs on
    // a wrapper; the button underneath must keep its native role.
    renderTimeline();
    const items = screen.getAllByRole("listitem");
    expect(items.length).toBeGreaterThan(0);
    const button = within(items[0]).getByRole("button");
    expect(button).toHaveAttribute("data-segment-id");
  });

  it("keeps a masked chord's secret while still saying where it is", () => {
    // Practice mode: the chord is the question. The position and the length are the
    // question's CONTEXT and must survive — a player needs the rhythm to guess against.
    renderTimeline({ maskedIds: new Set(["s1"]) });
    const masked = screen.getByRole("button", { name: /hidden chord/i });
    expect(masked).toHaveAccessibleName(/bar 1/i);
    expect(masked).not.toHaveAccessibleName(/major|minor|\bC\b/i);
  });
});

test("reveal-as-reward: a chord that just left the masked set settles into its cell (#Phase3)", () => {
  const { container, rerender } = render(
    <Timeline
      segments={segments}
      beatsPerMeasure={4}
      measureOffset={0}
      duration={4}
      currentTime={0}
      selectedId={null}
      onSelect={() => {}}
      grid={GRID}
      masking
      maskedIds={new Set(["s1", "s2"])}
    />,
  );
  // First paint: both are still questions, so nothing has just been revealed. The settle
  // must not play on a chord that was masked from the start — only on the transition.
  expect(container.querySelector('[data-revealed="true"]')).toBeNull();

  // s2 is named — it leaves the masked set while masking is still on. The cell it was hiding
  // in flags the settle so the chord can animate in. The reward is the information appearing.
  rerender(
    <Timeline
      segments={segments}
      beatsPerMeasure={4}
      measureOffset={0}
      duration={4}
      currentTime={0}
      selectedId={null}
      onSelect={() => {}}
      grid={GRID}
      masking
      maskedIds={new Set(["s1"])}
    />,
  );
  expect(container.querySelector('[data-segment-id="s2"]')).toHaveAttribute("data-revealed", "true");
  // s1 is still a question; it did not just get revealed.
  expect(container.querySelector('[data-segment-id="s1"]')).not.toHaveAttribute("data-revealed");
});

test("reveal-as-reward does not fire in edit mode, where nothing was ever masked (#Phase3)", () => {
  // maskedIds defaults to NO_MASK, so no cell is a fresh reveal. Without the "only on the
  // transition out of masked" guard, this would flag every chord on first paint.
  const { container } = renderTimeline();
  expect(container.querySelector('[data-revealed="true"]')).toBeNull();
});

test("leaving practice does NOT settle-animate every unnamed chord (#Phase3)", () => {
  // "Show the chords" empties the masked set, but the player NAMED nothing — so no cell may
  // flag a reveal. The reward is for a chord you named, not for the whole chart un-hiding at
  // once. This also protects the reward on a practice→edit→practice round-trip: without the
  // gate, every cell would be flagged data-revealed here and the real settle could never
  // replay (an animation runs only when its attribute first appears).
  const { container, rerender } = render(
    <Timeline
      segments={segments}
      beatsPerMeasure={4}
      measureOffset={0}
      duration={4}
      currentTime={0}
      selectedId={null}
      onSelect={() => {}}
      grid={GRID}
      masking
      maskedIds={new Set(["s1", "s2"])}
    />,
  );

  // Flip to edit: masking off, mask empty. The bulk transition must be swallowed.
  rerender(
    <Timeline
      segments={segments}
      beatsPerMeasure={4}
      measureOffset={0}
      duration={4}
      currentTime={0}
      selectedId={null}
      onSelect={() => {}}
      grid={GRID}
      masking={false}
      maskedIds={new Set()}
    />,
  );
  expect(container.querySelectorAll('[data-revealed="true"]')).toHaveLength(0);
});

describe("bar-native layout", () => {
  const VAMP = [{
    id: "s1", start_beat: 0, end_beat: 32, start_time: 0, end_time: 16,
    chord_root: "C", chord_quality: "maj", roman_numeral: "I",
  }];

  // The file's module-level GRID only spans 9 beats / 4s. A 32-beat vamp needs its own, or
  // timeForBeat clamps every fragment past beat 8 to t=4 and the sweep test is meaningless.
  // Still 120 BPM: beat b sits at t = b * 0.5.
  const VAMP_GRID: BeatGridInfo = {
    beatTimes: Array.from({ length: 33 }, (_, i) => i * 0.5), // beats 0..32 -> t 0..16
    bpm: 120,
    duration: 16,
    beatsPerMeasure: 4,
    measureOffset: 0,
  };

  const renderVamp = (props: Partial<React.ComponentProps<typeof Timeline>> = {}) =>
    renderTimeline({ segments: VAMP, duration: 16, grid: VAMP_GRID, ...props });

  it("a vamping chord renders one box per bar but stays ONE listitem and ONE tab stop", () => {
    // A chord spanning 8 bars is still ONE chord. Eight boxes is a layout artefact — the same
    // kind the old .chart-line wrapper was hidden for. If the listitem count regresses, a
    // screen-reader user hears "C, bar 1... C, bar 2..." eight times for a chord that never
    // changed. If the button count regresses, tabbing through the chart stops eight times on
    // one chord.
    renderVamp();
    expect(document.querySelectorAll(".chart-bar")).toHaveLength(8);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(document.querySelectorAll("button[data-segment-id]")).toHaveLength(1);
  });

  it("selects the chord when a continuation box is clicked", async () => {
    const onSelect = vi.fn();
    renderVamp({ onSelect });
    // The 4th bar holds a continuation fragment — no button, but it must still respond.
    const boxes = document.querySelectorAll<HTMLElement>(".chart-bar .chord-cell");
    await userEvent.click(boxes[3]);
    expect(onSelect).toHaveBeenCalledWith("s1");
  });

  it("gives a vamping chord ONE pair of resize handles, at its real boundaries", () => {
    // 8 bars must not grow 8 pairs of handles — the 7 interior bar lines are not chord changes.
    renderVamp({ onResizeCommit: () => {} });
    expect(document.querySelectorAll(".chord-cell__resize--left")).toHaveLength(1);
    expect(document.querySelectorAll(".chord-cell__resize--right")).toHaveLength(1);
  });

  it("sweeps the progress fill box to box across a vamping chord", () => {
    // .chord-progress answers ONE question: how much of this chord is left? Pinned to the
    // first box, an 8-bar vamp's fill would finish 8 bars early and answer nothing. Boxes
    // behind the playhead are full, boxes ahead are empty, and only the sounding box moves.
    //
    // VAMP_GRID is 120bpm: beat b sits at t = b*0.5, so bar 3 (beats 8-12) spans t=4..6.
    // At t=5 we are halfway through bar 3. Paused, so the sounding box snaps rather than
    // transitioning — which is what makes the fraction assertable.
    renderVamp({ currentTime: 5 });
    const fills = document.querySelectorAll<HTMLElement>(".chord-progress");
    expect(fills).toHaveLength(8); // one per box, not one for the chord
    expect(fills[0].style.transform).toBe("scaleX(1)"); // bar 1: played
    expect(fills[1].style.transform).toBe("scaleX(1)"); // bar 2: played
    expect(fills[3].style.transform).toBe("scaleX(0)"); // bar 4: not yet
    expect(fills[7].style.transform).toBe("scaleX(0)"); // bar 8: not yet
    // Paused, so the sounding box snaps to its true fraction rather than transitioning.
    expect(fills[2].style.transform).toBe("scaleX(0.5)"); // bar 3: halfway
  });

  it("does not re-select or seek when a resize drag ends on a continuation box", () => {
    // A vamp's real END lands on a continuation fragment, so its RIGHT resize handle lives in
    // the aria-hidden <span>, not the <button>. After a pointer drag that began on that handle,
    // the browser fires a trailing `click` on the box — which must be swallowed, exactly as the
    // <button> swallows it. Without the suppressClick guard the drag re-selects the chord and
    // yanks the playhead back to the chord's start.
    const onSelect = vi.fn();
    const onSeek = vi.fn();
    renderVamp({ onSelect, onSeek, onResizeCommit: () => {} });
    const rightHandle = document.querySelector<HTMLElement>(".chord-cell__resize--right")!;
    const box = rightHandle.closest<HTMLElement>(".chord-cell")!;
    // Drag: pointer down on the handle, then release on the window (startResize's listener).
    fireEvent.pointerDown(rightHandle, { clientX: 100 });
    fireEvent.pointerUp(window, { clientX: 160 });
    // The trailing click the browser now delivers to the box:
    fireEvent.click(box);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("sizes a fragment by its beats — the width IS the rhythm", () => {
    // The ratio must sit on the .chord-cell__item wrapper, which is the flex child of
    // .chart-bar — NOT on the nested <button>, which keeps its native role. If the ratio
    // drifts onto the wrong element, the fragment falls back to `flex: 0 1 auto`, sizes to
    // its content, and the chart silently stops showing rhythm. jsdom does no layout, so
    // this test is the only thing standing between that regression and production: it names
    // the exact element.
    const segs = [
      { ...BASE, id: "f", start_beat: 0, end_beat: 3, start_time: 0, end_time: 1.5 },
      { ...BASE, id: "g", start_beat: 3, end_beat: 4, start_time: 1.5, end_time: 2 },
    ];
    renderTimeline({ segments: segs, duration: 2 });
    const buttonFor = (id: string) =>
      document.querySelector<HTMLElement>(`.chart-bar [data-segment-id="${id}"]`)!;
    const wrapperFor = (id: string) => buttonFor(id).parentElement!;
    // jsdom's CSSOM normalises the flex shorthand's zero basis to "0px".
    expect(wrapperFor("f").style.flex).toBe("3 1 0px");
    expect(wrapperFor("g").style.flex).toBe("1 1 0px");
    expect(wrapperFor("f")).toHaveClass("chord-cell__item");
    expect(wrapperFor("f").parentElement).toHaveClass("chart-bar");
    // The flex ratio must NOT sit on the button itself.
    expect(buttonFor("f").style.flex).toBe("");
  });
});
