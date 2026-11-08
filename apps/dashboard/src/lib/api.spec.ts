import { describe, expect, it } from "vitest";
import { probe } from "./api";

const fakeFetch = (impl: () => Promise<Response>): typeof fetch => impl as unknown as typeof fetch;

describe("probe", () => {
  it("reports a successful answer", async () => {
    const result = await probe(
      "http://api.test",
      "/healthz",
      fakeFetch(() => Promise.resolve(new Response('{"status":"ok"}', { status: 200 }))),
    );
    expect(result).toMatchObject({ path: "/healthz", ok: true, status: 200 });
    expect(result.body).toContain("ok");
  });

  it("reports a non-2xx answer as not ok", async () => {
    const result = await probe(
      "http://api.test",
      "/readyz",
      fakeFetch(() => Promise.resolve(new Response("down", { status: 503 }))),
    );
    expect(result).toMatchObject({ ok: false, status: 503 });
  });

  it("never throws when the request fails", async () => {
    const result = await probe(
      "http://api.test",
      "/healthz",
      fakeFetch(() => Promise.reject(new Error("Failed to fetch"))),
    );
    expect(result).toMatchObject({ ok: false, status: null, body: "Failed to fetch" });
  });
});
