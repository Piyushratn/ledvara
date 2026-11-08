export interface ProbeResult {
  path: string;
  ok: boolean;
  /** null when the request never got an answer. */
  status: number | null;
  body: string;
  ms: number;
}

/** Calls one API path and reports what happened. Never throws. */
export async function probe(
  baseUrl: string,
  path: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 5000,
): Promise<ProbeResult> {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}${path}`, { signal: controller.signal });
    const body = (await response.text()).slice(0, 500);
    return {
      path,
      ok: response.ok,
      status: response.status,
      body,
      ms: Math.round(performance.now() - started),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    return {
      path,
      ok: false,
      status: null,
      body: message,
      ms: Math.round(performance.now() - started),
    };
  } finally {
    clearTimeout(timer);
  }
}
