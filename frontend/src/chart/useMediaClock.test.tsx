import { render, fireEvent, act } from "@testing-library/react";
import { useMediaClock, type MediaClock } from "./useMediaClock";

function setProp(el: HTMLMediaElement, name: string, value: number) {
  Object.defineProperty(el, name, { value, configurable: true });
}

test("reports duration, currentTime, and play state from media events", () => {
  let clock!: MediaClock;
  function Harness() {
    clock = useMediaClock();
    return <audio ref={clock.ref} data-testid="audio" />;
  }
  const { getByTestId } = render(<Harness />);
  const el = getByTestId("audio") as HTMLAudioElement;

  setProp(el, "duration", 12);
  fireEvent(el, new Event("durationchange"));
  setProp(el, "currentTime", 4);
  fireEvent(el, new Event("timeupdate"));
  fireEvent(el, new Event("play"));

  expect(clock.duration).toBe(12);
  expect(clock.currentTime).toBe(4);
  expect(clock.playing).toBe(true);

  fireEvent(el, new Event("pause"));
  expect(clock.playing).toBe(false);
});

test("seek clamps to [0, duration] and updates currentTime", () => {
  let clock!: MediaClock;
  let ct = 0;
  function Harness() {
    clock = useMediaClock();
    return <audio ref={clock.ref} data-testid="audio" />;
  }
  const { getByTestId } = render(<Harness />);
  const el = getByTestId("audio") as HTMLAudioElement;
  Object.defineProperty(el, "currentTime", {
    get: () => ct,
    set: (v: number) => {
      ct = v;
    },
    configurable: true,
  });
  setProp(el, "duration", 10);
  fireEvent(el, new Event("durationchange"));

  act(() => clock.seek(999));
  expect(ct).toBe(10);
  expect(clock.currentTime).toBe(10);

  act(() => clock.seek(-5));
  expect(ct).toBe(0);
  expect(clock.currentTime).toBe(0);
});

test("plays and pauses the element behind the ref", () => {
  let clock!: MediaClock;
  function Harness() {
    clock = useMediaClock();
    return <audio ref={clock.ref} data-testid="audio" />;
  }
  const { getByTestId } = render(<Harness />);
  const el = getByTestId("audio") as HTMLAudioElement;

  // jsdom's HTMLMediaElement does not implement play/pause; stub them.
  const play = vi.spyOn(el, "play").mockResolvedValue(undefined);
  const pause = vi.spyOn(el, "pause").mockImplementation(() => {});

  act(() => clock.play());
  expect(play).toHaveBeenCalledOnce();

  act(() => clock.pause());
  expect(pause).toHaveBeenCalledOnce();
});

test("toggle plays when paused and pauses when playing", () => {
  let clock!: MediaClock;
  function Harness() {
    clock = useMediaClock();
    return <audio ref={clock.ref} data-testid="audio" />;
  }
  const { getByTestId } = render(<Harness />);
  const el = getByTestId("audio") as HTMLAudioElement;
  const play = vi.spyOn(el, "play").mockResolvedValue(undefined);
  const pause = vi.spyOn(el, "pause").mockImplementation(() => {});

  // jsdom reports `paused` from its own property; drive it explicitly.
  Object.defineProperty(el, "paused", { value: true, configurable: true });
  act(() => clock.toggle());
  expect(play).toHaveBeenCalledOnce();

  Object.defineProperty(el, "paused", { value: false, configurable: true });
  act(() => clock.toggle());
  expect(pause).toHaveBeenCalledOnce();
});

test("play, pause, and toggle do not throw when there is no element yet", () => {
  // The deck can render a frame before the <audio> mounts. A play button that throws
  // on the first paint is worse than one that does nothing.
  let clock!: MediaClock;
  function Harness() {
    clock = useMediaClock();
    return null;
  }
  render(<Harness />);

  expect(() => clock.play()).not.toThrow();
  expect(() => clock.pause()).not.toThrow();
  expect(() => clock.toggle()).not.toThrow();
});
