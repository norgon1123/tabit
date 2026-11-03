import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import TempoControl from "./TempoControl";

/** Click the BPM text to open the editor, as a user does. */
async function openEditor() {
  await userEvent.click(screen.getByRole("button", { name: /tempo:/i }));
  return screen.getByLabelText("Tempo") as HTMLInputElement;
}

describe("TempoControl", () => {
  test("reads as text until it is clicked, then becomes an input", async () => {
    render(<TempoControl bpm={144} onChange={vi.fn()} busy={false} />);
    expect(screen.getByRole("button", { name: "Tempo: 144 BPM" })).toHaveTextContent("144 BPM");
    expect(screen.queryByLabelText("Tempo")).not.toBeInTheDocument();

    const input = await openEditor();
    expect(input.value).toBe("144");
  });

  test("commits a typed tempo on Enter", async () => {
    const onChange = vi.fn();
    render(<TempoControl bpm={144} onChange={onChange} busy={false} />);
    const input = await openEditor();
    await userEvent.clear(input);
    await userEvent.type(input, "74{Enter}");
    expect(onChange).toHaveBeenCalledWith(74);
    expect(screen.queryByLabelText("Tempo")).not.toBeInTheDocument(); // editor closed
  });

  test("commits a typed tempo when the user clicks away", async () => {
    const onChange = vi.fn();
    render(<TempoControl bpm={144} onChange={onChange} busy={false} />);
    const input = await openEditor();
    fireEvent.change(input, { target: { value: "74" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(74);
    expect(screen.queryByLabelText("Tempo")).not.toBeInTheDocument();
  });

  test("Escape abandons the edit without saving", async () => {
    const onChange = vi.fn();
    render(<TempoControl bpm={144} onChange={onChange} busy={false} />);
    const input = await openEditor();
    fireEvent.change(input, { target: { value: "74" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /tempo:/i })).toHaveTextContent("144 BPM");
  });

  test("rounds a typed fractional tempo", async () => {
    const onChange = vi.fn();
    render(<TempoControl bpm={144} onChange={onChange} busy={false} />);
    const input = await openEditor();
    fireEvent.change(input, { target: { value: "73.6" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(74);
  });

  test("rejects an implausible tempo and snaps back", async () => {
    const onChange = vi.fn();
    render(<TempoControl bpm={144} onChange={onChange} busy={false} />);
    const input = await openEditor();
    fireEvent.change(input, { target: { value: "9999" } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /tempo:/i })).toHaveTextContent("144 BPM");
  });

  test("does not fire when the tempo is unchanged", async () => {
    const onChange = vi.fn();
    render(<TempoControl bpm={144} onChange={onChange} busy={false} />);
    const input = await openEditor();
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
  });

  // Half/double each fix a mis-counted grid, and each must fire exactly once — the input's
  // blur must not commit a stale draft on top of the rescale.
  test.each([
    [72, "Double-time", 144],
    [144, "Half-time", 72],
  ])("rescaling %d via %s fires onChange once with the new tempo", async (bpm, title, expected) => {
    const onChange = vi.fn();
    render(<TempoControl bpm={bpm} onChange={onChange} busy={false} />);
    await openEditor();
    await userEvent.click(screen.getByTitle(title));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(expected);
  });

  test("halving an odd tempo still asks for a whole number", async () => {
    // Tempo is a count: half of 143 is 72 BPM, not 71.5.
    const onChange = vi.fn();
    render(<TempoControl bpm={143} onChange={onChange} busy={false} />);
    await openEditor();
    await userEvent.click(screen.getByTitle("Half-time"));
    expect(onChange).toHaveBeenCalledWith(72);
  });

  test("clamps a halved tempo to the minimum the API accepts", async () => {
    const onChange = vi.fn();
    render(<TempoControl bpm={30} onChange={onChange} busy={false} />);
    await openEditor();
    await userEvent.click(screen.getByTitle("Half-time"));
    expect(onChange.mock.calls[0][0]).toBe(21);
  });

  test("a keyboard user can Tab from the tempo field to ÷2 and use it", async () => {
    // Tabbing out of the input used to blur it, which committed and unmounted the whole
    // editor — so ÷2/×2 were destroyed before focus could land, leaving them mouse-only.
    const onChange = vi.fn();
    render(<TempoControl bpm={120} onChange={onChange} busy={false} />);
    await openEditor();
    await userEvent.tab(); // input -> ÷2
    const half = screen.queryByTitle("Half-time");
    expect(half).not.toBeNull();
    expect(half).toHaveFocus();
    await userEvent.click(half!);
    expect(onChange).toHaveBeenCalledWith(60);
  });

  test("names the rescale buttons for a screen reader", async () => {
    // "÷2, button" tells a screen-reader user nothing about what it does.
    render(<TempoControl bpm={144} onChange={vi.fn()} busy={false} />);
    await openEditor();
    expect(screen.getByRole("button", { name: "Half-time" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Double-time" })).toBeInTheDocument();
  });

  test("returns focus to the trigger when the editor closes", async () => {
    // Escape/Enter/click-away unmounted the input and left focus on document.body; a keyboard
    // user had to Tab back from the top. Focus now returns to the tempo button.
    render(<TempoControl bpm={144} onChange={vi.fn()} busy={false} />);
    await userEvent.click(screen.getByRole("button", { name: /tempo:/i }));
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: /tempo:/i })).toHaveFocus();
  });

  test("shows a whole tempo for a chart analysed before that rule", () => {
    render(<TempoControl bpm={143.6} onChange={vi.fn()} busy={false} />);
    expect(screen.getByRole("button", { name: /tempo:/i })).toHaveTextContent("144 BPM");
  });

  test("renders nothing when there is no tempo to rescale from", () => {
    const { container } = render(<TempoControl bpm={null} onChange={vi.fn()} busy={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("is not editable while a mutation is in flight", () => {
    render(<TempoControl bpm={144} onChange={vi.fn()} busy />);
    expect(screen.getByRole("button", { name: /tempo:/i })).toBeDisabled();
  });
});
