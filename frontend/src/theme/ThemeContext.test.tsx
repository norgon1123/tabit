import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider, useTheme } from "./ThemeContext";

/** jsdom has no matchMedia. Fake it so we can drive the OS preference. */
function mockPrefersDark(prefersDark: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) => ({
      matches: query.includes("dark") ? prefersDark : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    }),
  );
}

function Probe() {
  const { theme, toggle } = useTheme();
  return (
    <>
      <span data-testid="theme">{theme}</span>
      <button onClick={toggle}>flip</button>
    </>
  );
}

function renderProbe() {
  return render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it.each([
    [true, "dark"],
    [false, "light"],
  ])("defaults to the OS preference when the user has never chosen (prefers-dark=%s → %s)", (prefersDark, expected) => {
    mockPrefersDark(prefersDark);
    renderProbe();
    expect(screen.getByTestId("theme")).toHaveTextContent(expected);
  });

  it("prefers the user's stored choice over the OS preference", () => {
    // The whole point of the toggle: the user overrules the OS, and it sticks.
    mockPrefersDark(true);
    localStorage.setItem("tabit.theme", "light");
    renderProbe();
    expect(screen.getByTestId("theme")).toHaveTextContent("light");
  });

  it("writes data-theme onto <html> so the CSS can see it", () => {
    mockPrefersDark(false);
    renderProbe();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("persists a toggle and updates <html>", async () => {
    mockPrefersDark(false);
    renderProbe();
    await userEvent.click(screen.getByRole("button", { name: "flip" }));

    expect(screen.getByTestId("theme")).toHaveTextContent("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("tabit.theme")).toBe("dark");
  });

  it("ignores a corrupt stored value rather than crashing", () => {
    mockPrefersDark(true);
    localStorage.setItem("tabit.theme", "chartreuse");
    renderProbe();
    expect(screen.getByTestId("theme")).toHaveTextContent("dark");
  });

  describe("when localStorage throws (private browsing, storage disabled)", () => {
    it("still renders and falls back to the OS preference when getItem throws", () => {
      const getItemSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new DOMException("SecurityError");
      });
      try {
        mockPrefersDark(true);
        expect(() => renderProbe()).not.toThrow();
        expect(screen.getByTestId("theme")).toHaveTextContent("dark");
      } finally {
        getItemSpy.mockRestore();
      }
    });

    it("still toggles for the session and updates <html> when setItem throws, without crashing", async () => {
      const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("SecurityError");
      });
      try {
        mockPrefersDark(false);
        renderProbe();

        await expect(
          userEvent.click(screen.getByRole("button", { name: "flip" })),
        ).resolves.not.toThrow();

        expect(screen.getByTestId("theme")).toHaveTextContent("dark");
        expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
      } finally {
        setItemSpy.mockRestore();
      }
    });
  });
});
