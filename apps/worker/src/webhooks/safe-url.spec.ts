import { describe, expect, it } from "vitest";
import { UnsafeUrlError, validateWebhookUrl } from "./safe-url.js";

describe("validateWebhookUrl", () => {
  it("accepts a normal https URL", () => {
    expect(validateWebhookUrl("https://example.com/hooks/ledvara").hostname).toBe("example.com");
  });

  it.each([
    "http://example.com/hook",
    "https://user:pass@example.com/hook",
    "https://localhost/hook",
    "https://api.localhost/hook",
    "https://printer.local/hook",
    "https://db.internal/hook",
    "https://127.0.0.1/hook",
    "https://2130706433/hook",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/hook",
    "https://[::ffff:10.0.0.1]/hook",
    "ftp://example.com/hook",
    "not a url",
  ])("rejects %s", (url) => {
    expect(() => validateWebhookUrl(url)).toThrowError(UnsafeUrlError);
  });

  it("allows http and localhost only when private targets are enabled", () => {
    expect(validateWebhookUrl("http://127.0.0.1:8080/hook", { allowPrivate: true }).port).toBe(
      "8080",
    );
  });
});
