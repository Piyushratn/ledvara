export const REFRESH_COOKIE_NAME = "ledvara_refresh";
/** Cookie-based refresh must send this header. A cross-site page cannot add it without a CORS preflight. */
export const REQUESTED_WITH = "ledvara-dashboard";

const COOKIE_PATH = "/v1/auth";

function attributes(secure: boolean): string[] {
  const parts = [`Path=${COOKIE_PATH}`, "HttpOnly", "SameSite=Strict"];
  if (secure) parts.push("Secure");
  return parts;
}

export function serializeRefreshCookie(
  token: string,
  maxAgeSeconds: number,
  secure: boolean,
): string {
  return [
    `${REFRESH_COOKIE_NAME}=${encodeURIComponent(token)}`,
    ...attributes(secure),
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ].join("; ");
}

export function clearRefreshCookie(secure: boolean): string {
  return [`${REFRESH_COOKIE_NAME}=`, ...attributes(secure), "Max-Age=0"].join("; ");
}

/** Returns the named cookie's value from a Cookie header, or null. */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const index = trimmed.indexOf("=");
    if (index === -1 || trimmed.slice(0, index) !== name) continue;
    const raw = trimmed.slice(index + 1);
    if (raw.length === 0) return null;
    try {
      return decodeURIComponent(raw);
    } catch {
      return null;
    }
  }
  return null;
}
