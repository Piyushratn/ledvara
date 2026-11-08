import { z } from "zod";

/** Cookie-based refresh must send this header. The API rejects the request without it. */
export const REQUESTED_WITH = "ledvara-dashboard";

export interface FieldDetail {
  path: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: FieldDetail[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface TokenStore {
  get(): string | null;
  set(token: string | null): void;
}

/** The access token lives only in memory. It is never written to localStorage. */
export function createTokenStore(): TokenStore {
  let token: string | null = null;
  return {
    get: () => token,
    set: (value) => {
      token = value;
    },
  };
}

const errorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z
      .array(z.object({ path: z.string(), message: z.string() }))
      .optional()
      .catch(undefined),
  }),
});

const refreshBodySchema = z.object({ accessToken: z.string().min(1) });

function toApiError(status: number, body: unknown): ApiError {
  const parsed = errorBodySchema.safeParse(body);
  if (parsed.success) {
    const { code, message, details } = parsed.data.error;
    return new ApiError(status, code, message, details ?? []);
  }
  return new ApiError(status, "unknown_error", `Request failed (${status}).`);
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export interface ClientOptions {
  baseUrl: string;
  tokens: TokenStore;
  fetchImpl?: typeof fetch;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** false for login, sign-up and the like: a 401 there is an answer, not an expired session. */
  auth?: boolean;
}

export interface ApiClient {
  request(path: string, options?: RequestOptions): Promise<unknown>;
  refresh(): Promise<string | null>;
  onSignedOut(listener: () => void): () => void;
}

export function createClient(options: ClientOptions): ApiClient {
  const { baseUrl, tokens } = options;
  const fetchImpl: typeof fetch = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const listeners = new Set<() => void>();
  let refreshing: Promise<string | null> | null = null;

  function signOut(): void {
    tokens.set(null);
    for (const listener of listeners) listener();
  }

  async function doRefresh(): Promise<string | null> {
    try {
      const response = await fetchImpl(`${baseUrl}/v1/auth/refresh`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "x-requested-with": REQUESTED_WITH },
        body: "{}",
      });
      if (!response.ok) {
        tokens.set(null);
        return null;
      }
      const parsed = refreshBodySchema.safeParse(await readJson(response));
      if (!parsed.success) {
        tokens.set(null);
        return null;
      }
      tokens.set(parsed.data.accessToken);
      return parsed.data.accessToken;
    } catch {
      return null;
    }
  }

  /** One refresh at a time: parallel calls share it, so token rotation never trips reuse detection. */
  function refresh(): Promise<string | null> {
    if (!refreshing) {
      refreshing = doRefresh().finally(() => {
        refreshing = null;
      });
    }
    return refreshing;
  }

  function send(path: string, requestOptions: RequestOptions): Promise<Response> {
    const { method = "GET", body, auth = true } = requestOptions;
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    const token = tokens.get();
    if (auth && token) headers["authorization"] = `Bearer ${token}`;
    return fetchImpl(`${baseUrl}${path}`, {
      method,
      headers,
      credentials: "include",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  async function request(path: string, requestOptions: RequestOptions = {}): Promise<unknown> {
    let response = await send(path, requestOptions);
    if (response.status === 401 && requestOptions.auth !== false) {
      const token = await refresh();
      if (token) response = await send(path, requestOptions);
      if (!token || response.status === 401) signOut();
    }
    if (!response.ok) throw toApiError(response.status, await readJson(response));
    return readJson(response);
  }

  return {
    request,
    refresh,
    onSignedOut(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
