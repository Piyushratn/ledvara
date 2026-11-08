import { describe, expect, it } from "vitest";
import { ApiError, createClient, createTokenStore } from "./http";

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const resolved = init ?? {};
    calls.push({ url, init: resolved });
    return Promise.resolve(handler(url, resolved));
  }) as typeof fetch;
  return { impl, calls };
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const authHeader = (init: RequestInit): string | undefined =>
  (init.headers as Record<string, string>)["authorization"];

const BASE = "http://api.test";

describe("api client", () => {
  it("sends the access token and includes credentials", async () => {
    const tokens = createTokenStore();
    tokens.set("abc");
    const { impl, calls } = fakeFetch(() => json(200, { ok: true }));
    const client = createClient({ baseUrl: BASE, tokens, fetchImpl: impl });

    expect(await client.request("/v1/things")).toEqual({ ok: true });
    expect(authHeader(calls[0]?.init ?? {})).toBe("Bearer abc");
    expect(calls[0]?.init.credentials).toBe("include");
  });

  it("refreshes once on a 401 and retries with the new token", async () => {
    const tokens = createTokenStore();
    tokens.set("old");
    const { impl, calls } = fakeFetch(async (url, init) => {
      if (url.endsWith("/v1/auth/refresh")) return json(200, { accessToken: "new" });
      return authHeader(init) === "Bearer new" ? json(200, { data: 1 }) : json(401, {});
    });
    const client = createClient({ baseUrl: BASE, tokens, fetchImpl: impl });

    expect(await client.request("/v1/things")).toEqual({ data: 1 });
    expect(tokens.get()).toBe("new");

    const refresh = calls.find((call) => call.url.endsWith("/v1/auth/refresh"));
    expect(refresh?.init.method).toBe("POST");
    expect(refresh?.init.credentials).toBe("include");
    expect(refresh?.init.body).toBe("{}");
    expect((refresh?.init.headers as Record<string, string>)["x-requested-with"]).toBe(
      "ledvara-dashboard",
    );
  });

  it("shares one refresh between parallel requests", async () => {
    const tokens = createTokenStore();
    tokens.set("old");
    const { impl, calls } = fakeFetch(async (url, init) => {
      if (url.endsWith("/v1/auth/refresh")) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return json(200, { accessToken: "new" });
      }
      return authHeader(init) === "Bearer new" ? json(200, { ok: true }) : json(401, {});
    });
    const client = createClient({ baseUrl: BASE, tokens, fetchImpl: impl });

    await Promise.all([client.request("/v1/a"), client.request("/v1/b"), client.request("/v1/c")]);
    expect(calls.filter((call) => call.url.endsWith("/v1/auth/refresh"))).toHaveLength(1);
  });

  it("signs out when the refresh fails", async () => {
    const tokens = createTokenStore();
    tokens.set("old");
    const { impl } = fakeFetch((url) =>
      url.endsWith("/v1/auth/refresh")
        ? json(401, { error: { code: "invalid_refresh_token", message: "Expired." } })
        : json(401, { error: { code: "unauthorized", message: "Please sign in." } }),
    );
    const client = createClient({ baseUrl: BASE, tokens, fetchImpl: impl });
    let signedOut = 0;
    client.onSignedOut(() => {
      signedOut += 1;
    });

    await expect(client.request("/v1/things")).rejects.toMatchObject({ status: 401 });
    expect(tokens.get()).toBeNull();
    expect(signedOut).toBe(1);
  });

  it("does not refresh for calls marked auth:false, and keeps the server's message", async () => {
    const tokens = createTokenStore();
    const { impl, calls } = fakeFetch(() =>
      json(401, {
        error: { code: "invalid_credentials", message: "Incorrect email or password." },
      }),
    );
    const client = createClient({ baseUrl: BASE, tokens, fetchImpl: impl });

    const error = await client
      .request("/v1/auth/login", { method: "POST", body: { email: "a@b.co" }, auth: false })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 401,
      code: "invalid_credentials",
      message: "Incorrect email or password.",
    });
    expect(calls).toHaveLength(1);
  });

  it("exposes field details from a validation error", async () => {
    const { impl } = fakeFetch(() =>
      json(422, {
        error: {
          code: "validation_failed",
          message: "Request validation failed",
          details: [{ path: "password", message: "Too short" }],
        },
      }),
    );
    const client = createClient({ baseUrl: BASE, tokens: createTokenStore(), fetchImpl: impl });

    const error = (await client
      .request("/v1/auth/signup", { method: "POST", body: {}, auth: false })
      .catch((caught: unknown) => caught)) as ApiError;
    expect(error.details).toEqual([{ path: "password", message: "Too short" }]);
  });
});
