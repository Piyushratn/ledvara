import { isIP } from "node:net";
import { isBlockedAddress } from "./ip-guard.js";

export class UnsafeUrlError extends Error {}

export interface UrlOptions {
  /** Tests only: allows http and private targets. */
  allowPrivate?: boolean;
}

export function validateWebhookUrl(raw: string, options: UrlOptions = {}): URL {
  const allowPrivate = options.allowPrivate ?? false;
  if (raw.length > 2048) throw new UnsafeUrlError("The URL is too long.");

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("That is not a valid URL.");
  }

  if (url.protocol !== "https:" && !(allowPrivate && url.protocol === "http:")) {
    throw new UnsafeUrlError("Webhook URLs must use https.");
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError("The URL must not contain credentials.");
  }

  if (!allowPrivate) {
    const host = url.hostname.replace(/^\[|\]$/gu, "").toLowerCase();
    const reserved =
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host.endsWith(".internal");
    if (reserved) throw new UnsafeUrlError("That host is not allowed.");
    if (isIP(host) !== 0 && isBlockedAddress(host)) {
      throw new UnsafeUrlError("That address is not allowed.");
    }
  }
  return url;
}
