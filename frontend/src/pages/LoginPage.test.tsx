import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../test/server";
import { renderWithProviders } from "../test/utils";
import LoginPage from "./LoginPage";

function renderLoginPage() {
  return renderWithProviders(<LoginPage />);
}

test("submitting valid credentials calls the login endpoint", async () => {
  let body: unknown = null;
  server.use(
    http.post("/api/auth/login", async ({ request }) => {
      body = await request.json();
      return HttpResponse.json({ id: "u1", username: "alice" });
    }),
  );
  renderLoginPage();
  await userEvent.type(screen.getByLabelText(/username/i), "alice");
  await userEvent.type(screen.getByLabelText(/password/i), "password123");
  await userEvent.click(screen.getByRole("button", { name: /log in/i }));
  expect(body).toEqual({ username: "alice", password: "password123" });
});

test("the error is announced, not just painted red", async () => {
  server.use(
    http.post("/api/auth/login", () =>
      HttpResponse.json({ detail: "Invalid credentials" }, { status: 401 }),
    ),
  );
  renderLoginPage();
  await userEvent.type(screen.getByLabelText(/username/i), "alice");
  await userEvent.type(screen.getByLabelText(/password/i), "wrongpass1");
  await userEvent.click(screen.getByRole("button", { name: /log in/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Invalid credentials");
});

test("submitting by pressing Enter in the password field logs in", async () => {
  let called = false;
  server.use(
    http.post("/api/auth/login", () => {
      called = true;
      return HttpResponse.json({ id: "u1", username: "alice" });
    }),
  );
  renderLoginPage();
  await userEvent.type(screen.getByLabelText(/username/i), "alice");
  await userEvent.type(screen.getByLabelText(/password/i), "password123{enter}");
  expect(called).toBe(true);
});

it("has no inline styles left", () => {
  const { container } = renderLoginPage();
  expect(Array.from(container.querySelectorAll("[style]"))).toEqual([]);
});

it("labels every input", () => {
  renderLoginPage();
  expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
});

it("submits with a real submit button", () => {
  // Button defaults to type=button. The login form's submit MUST opt in explicitly,
  // or pressing Enter in the password field does nothing.
  renderLoginPage();
  expect(screen.getByRole("button", { name: /log in/i })).toHaveAttribute("type", "submit");
});
