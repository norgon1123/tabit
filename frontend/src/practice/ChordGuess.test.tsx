import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChordGuess from "./ChordGuess";
import type { SegmentOut } from "../api/types";

const SEGMENT: SegmentOut = {
  id: "s1",
  start_beat: 0,
  end_beat: 4,
  start_time: 0,
  end_time: 2,
  chord_root: "G",
  chord_quality: "dom7",
  roman_numeral: "V7",
};

async function guess(root: string, quality: string) {
  await userEvent.selectOptions(screen.getByLabelText("Root"), root);
  await userEvent.selectOptions(screen.getByLabelText("Quality"), quality);
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));
}

test("has no inline styles left", () => {
  const { container } = render(<ChordGuess segment={SEGMENT} onSolved={vi.fn()} />);
  expect(Array.from(container.querySelectorAll("[style]"))).toEqual([]);
});

test("a wrong answer is refused, marked invalid, and shakes", async () => {
  const onSolved = vi.fn();
  const { container } = render(<ChordGuess segment={SEGMENT} onSolved={onSolved} />);

  await guess("C", "Major");

  // Polite, not assertive: the user asked (they submitted a guess), so it speaks — but
  // nothing here is urgent enough to interrupt whatever the reader was already saying.
  expect(await screen.findByRole("status")).toHaveTextContent(/not that one/i);
  expect(container.querySelector(".chord-guess--wrong")).not.toBeNull();
  expect(container.querySelector(".chord-guess.shake")).not.toBeNull();
  expect(screen.getByLabelText("Root")).toHaveAttribute("aria-invalid", "true");
  // The chord is not given away, and the form stays up for another attempt.
  expect(onSolved).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Submit" })).toBeEnabled();
});

it("announces a wrong guess politely — it answers, it does not interrupt", async () => {
  // The user ASKED: they submitted a guess. So this must speak — gating it on !playing
  // would leave a blind user with no idea whether they were right, and practice mode is
  // an ear-training quiz, the feature this app serves a blind musician BEST.
  //
  // But it must not INTERRUPT. role="alert" is assertive and cuts across whatever the
  // screen reader is saying, over the top of the music. A wrong guess is not an emergency.
  render(<ChordGuess segment={SEGMENT} onSolved={vi.fn()} />);

  await guess("C", "Major");

  const said = screen.getByText(/not that one/i);
  expect(said).toHaveAttribute("role", "status");
  expect(said).not.toHaveAttribute("role", "alert");
});

test("a second wrong answer shakes again", async () => {
  const { container } = render(<ChordGuess segment={SEGMENT} onSolved={vi.fn()} />);

  await guess("C", "Major");
  const card = container.querySelector(".chord-guess")!;
  // The class is re-applied around a forced reflow, so it is on the element both times —
  // what proves the replay is that touching a field clears the verdict and the next wrong
  // answer sets it afresh.
  await userEvent.selectOptions(screen.getByLabelText("Root"), "D");
  expect(card.className).not.toMatch(/chord-guess--wrong/);

  await userEvent.click(screen.getByRole("button", { name: "Submit" }));
  expect(card.className).toMatch(/chord-guess--wrong/);
  expect(card.className).toMatch(/shake/);
});

// A long flash, so "has not dismissed itself yet" is a fact about the code and not a race
// against the clock the assertions run on.
test("the right answer is confirmed in green, and named at once", async () => {
  const onSolved = vi.fn();
  const onClose = vi.fn();
  const { container } = render(
    <ChordGuess segment={SEGMENT} onSolved={onSolved} onClose={onClose} revealMs={10_000} />,
  );

  await guess("G", "Dominant 7th");

  // Named in full, so the player reads back what they just worked out.
  expect(await screen.findByRole("status")).toHaveTextContent("Gdom7");
  expect(container.querySelector(".chord-guess--right")).not.toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();

  // The chord is handed to the chart on submit — while the form is still standing there
  // green. The flash only decides when the form leaves.
  expect(onSolved).toHaveBeenCalledWith("s1");
  expect(onClose).not.toHaveBeenCalled();
});

test("the form sees itself out once the flash is over", async () => {
  const onClose = vi.fn();
  render(<ChordGuess segment={SEGMENT} onSolved={vi.fn()} onClose={onClose} revealMs={10} />);

  await guess("G", "Dominant 7th");

  await waitFor(() => expect(onClose).toHaveBeenCalled());
});

// A player who names a chord and immediately clicks the next "?" tears this form down
// mid-flash. The answer was right when they gave it; it cannot depend on them sitting still.
test("the solve survives the form being torn down during the green flash", async () => {
  const onSolved = vi.fn();
  const { unmount } = render(
    <ChordGuess segment={SEGMENT} onSolved={onSolved} revealMs={10_000} />,
  );

  await guess("G", "Dominant 7th");
  unmount();

  expect(onSolved).toHaveBeenCalledWith("s1");
});

test("a chord already named says so, instead of asking again", () => {
  render(<ChordGuess segment={SEGMENT} solved onSolved={vi.fn()} />);

  expect(screen.getByText("Gdom7")).toBeInTheDocument();
  expect(screen.getByText(/you named this one/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
});

// Db on the chart, C# in the player's hands: the same chord.
test("an enharmonic answer is accepted", async () => {
  const onSolved = vi.fn();
  const flat: SegmentOut = { ...SEGMENT, chord_root: "Db", chord_quality: "maj" };
  render(<ChordGuess segment={flat} onSolved={onSolved} revealMs={10} />);

  await guess("C#", "Major");

  await waitFor(() => expect(onSolved).toHaveBeenCalledWith("s1"));
});
