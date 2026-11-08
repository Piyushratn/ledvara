const DEFAULT_API_URL = "http://localhost:3000";

/** The API base URL without a trailing slash. */
export function resolveApiUrl(raw: unknown): string {
  const value = typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : DEFAULT_API_URL;
  return value.replace(/\/+$/u, "");
}

export const API_URL = resolveApiUrl(import.meta.env.VITE_API_URL);
