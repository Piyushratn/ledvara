import { z } from "zod";
import { client as defaultClient, tokens as defaultTokens } from "./client";
import type { ApiClient, TokenStore } from "./http";

export interface User {
  id: string;
  email: string;
  fullName: string | null;
  emailVerified: boolean;
}

export type LoginOutcome =
  { kind: "signedIn"; user: User } | { kind: "twoFactor"; challengeToken: string };

export interface AuthApi {
  /** Restores a session from the refresh cookie, or returns null. */
  restore(): Promise<User | null>;
  login(email: string, password: string): Promise<LoginOutcome>;
  completeTwoFactor(challengeToken: string, code: string): Promise<User>;
  logout(): Promise<void>;
  onSignedOut(listener: () => void): () => void;
}

const userSchema = z.object({
  id: z.string(),
  email: z.string(),
  fullName: z.string().nullable(),
  emailVerified: z.boolean(),
});

const sessionSchema = z.object({
  accessToken: z.string().min(1),
  user: z.object({ id: z.string(), email: z.string(), fullName: z.string().nullable() }),
});

const loginResultSchema = z.union([
  z.object({ twoFactorRequired: z.literal(true), challengeToken: z.string().min(1) }),
  sessionSchema,
]);

export function createAuthApi(client: ApiClient, tokens: TokenStore): AuthApi {
  function startSession(session: z.infer<typeof sessionSchema>): User {
    tokens.set(session.accessToken);
    // Login only succeeds for verified accounts.
    return { ...session.user, emailVerified: true };
  }

  return {
    async restore() {
      const token = await client.refresh();
      if (!token) return null;
      try {
        return userSchema.parse(await client.request("/v1/auth/me"));
      } catch {
        return null;
      }
    },

    async login(email, password) {
      const raw = await client.request("/v1/auth/login", {
        method: "POST",
        body: { email, password },
        auth: false,
      });
      const result = loginResultSchema.parse(raw);
      if ("twoFactorRequired" in result) {
        return { kind: "twoFactor", challengeToken: result.challengeToken };
      }
      return { kind: "signedIn", user: startSession(result) };
    },

    async completeTwoFactor(challengeToken, code) {
      const raw = await client.request("/v1/auth/login/2fa", {
        method: "POST",
        body: { challengeToken, code },
        auth: false,
      });
      return startSession(sessionSchema.parse(raw));
    },

    async logout() {
      try {
        await client.request("/v1/auth/logout", { method: "POST" });
      } catch {
        // The local session ends either way.
      } finally {
        tokens.set(null);
      }
    },

    onSignedOut: (listener) => client.onSignedOut(listener),
  };
}

export const authApi: AuthApi = createAuthApi(defaultClient, defaultTokens);
