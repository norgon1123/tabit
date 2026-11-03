import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "../theme/ThemeContext";
import ThemeToggle from "./ThemeToggle";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: false, media: q,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {},
    onchange: null, dispatchEvent: () => false,
  }));
});

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

describe("ThemeToggle", () => {
  it("announces which theme it will switch TO, not which is active", () => {
    // "Dark mode" as a label is ambiguous to a screen reader — is it a state or an action?
    // The accessible name must say what pressing it does.
    renderToggle();
    expect(screen.getByRole("button", { name: /switch to dark/i })).toBeInTheDocument();
  });

  it("flips the theme and re-labels itself", async () => {
    renderToggle();
    await userEvent.click(screen.getByRole("button", { name: /switch to dark/i }));

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(screen.getByRole("button", { name: /switch to light/i })).toBeInTheDocument();
  });
});
