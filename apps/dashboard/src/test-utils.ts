import type { AuthApi, User } from "./lib/auth-api";

export const TEST_USER: User = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "alice@example.com",
  fullName: "Alice",
  emailVerified: true,
};

/** A signed-out AuthApi where every call that must be stubbed fails loudly. */
export function fakeAuthApi(overrides: Partial<AuthApi> = {}): AuthApi {
  return {
    restore: () => Promise.resolve(null),
    login: () => Promise.reject(new Error("login was not stubbed")),
    completeTwoFactor: () => Promise.reject(new Error("completeTwoFactor was not stubbed")),
    logout: () => Promise.resolve(),
    onSignedOut: () => () => undefined,
    ...overrides,
  };
}
