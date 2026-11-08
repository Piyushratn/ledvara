// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { AuthProvider } from "../auth/AuthContext";
import type { AuthApi } from "../lib/auth-api";
import { ApiError } from "../lib/http";
import { fakeAuthApi, TEST_USER } from "../test-utils";
import { LoginPage } from "./LoginPage";

function renderLogin(api: AuthApi) {
  return render(
    <AuthProvider api={api}>
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/app" element={<p>Account page</p>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

function fill(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

afterEach(cleanup);

describe("LoginPage", () => {
  it("shows validation messages without calling the API", async () => {
    renderLogin(fakeAuthApi());
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Enter a valid email address.")).toBeTruthy();
    expect(screen.getByText("Enter your password.")).toBeTruthy();
  });

  it("shows the server's message when the credentials are wrong", async () => {
    renderLogin(
      fakeAuthApi({
        login: () =>
          Promise.reject(new ApiError(401, "invalid_credentials", "Incorrect email or password.")),
      }),
    );
    fill("Email", "alice@example.com");
    fill("Password", "wrong-password");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Incorrect email or password.");
  });

  it("asks for the second factor, then signs in and leaves the login page", async () => {
    const challengeToken = "c".repeat(30);
    let received: [string, string] | null = null;
    renderLogin(
      fakeAuthApi({
        login: () => Promise.resolve({ kind: "twoFactor", challengeToken }),
        completeTwoFactor: (token, code) => {
          received = [token, code];
          return Promise.resolve(TEST_USER);
        },
      }),
    );
    fill("Email", "alice@example.com");
    fill("Password", "correct-horse-battery");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByLabelText("Authentication code")).toBeTruthy();
    fill("Authentication code", "123456");
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));

    expect(await screen.findByText("Account page")).toBeTruthy();
    expect(received).toEqual([challengeToken, "123456"]);
  });
});
