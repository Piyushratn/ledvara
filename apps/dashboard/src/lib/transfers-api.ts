import { z } from "zod";
import { API_URL } from "./config";
import { client as defaultClient, tokens as defaultTokens } from "./client";
import type { ApiClient, TokenStore } from "./http";

const transferSchema = z.object({
  id: z.string(),
  status: z.string(),
  fromAccountId: z.string(),
  toAccountId: z.string(),
  amountMinor: z.string(),
  currency: z.string(),
  reference: z.string().nullable(),
  createdAt: z.string(),
});

const pageSchema = z.object({
  data: z.array(transferSchema),
  nextCursor: z.string().nullable(),
});

export type Transfer = z.infer<typeof transferSchema>;
export type TransferPage = z.infer<typeof pageSchema>;

export interface TransferFilters {
  status?: string;
  from?: string;
  to?: string;
  minAmount?: string;
  maxAmount?: string;
  accountId?: string;
  search?: string;
}

export interface TransfersApi {
  list(orgId: string, filters: TransferFilters, cursor?: string): Promise<TransferPage>;
  downloadCsv(orgId: string, filters: TransferFilters): Promise<Blob>;
}

/** Only the filters the API understands, with empty values dropped. */
export function toQuery(filters: TransferFilters, cursor?: string): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") params.set(key, value);
  }
  if (cursor) params.set("cursor", cursor);
  params.set("limit", "25");
  return params.toString();
}

export function createTransfersApi(
  client: ApiClient,
  tokens: TokenStore,
  baseUrl: string,
): TransfersApi {
  return {
    async list(orgId, filters, cursor) {
      const raw = await client.request(`/v1/orgs/${orgId}/transfers?${toQuery(filters, cursor)}`);
      return pageSchema.parse(raw);
    },
    async downloadCsv(orgId, filters) {
      // Fetched with the in-memory token, then handed to the browser as a blob. The token never
      // appears in a URL or a link.
      const query = toQuery(filters);
      const send = (): Promise<Response> =>
        fetch(`${baseUrl}/v1/orgs/${orgId}/transfers.csv?${query}`, {
          credentials: "include",
          headers: tokens.get() ? { authorization: `Bearer ${tokens.get() ?? ""}` } : {},
        });
      let response = await send();
      if (response.status === 401) {
        const token = await client.refresh();
        if (token) response = await send();
      }
      if (!response.ok) throw new Error(`Export failed (${response.status}).`);
      return response.blob();
    },
  };
}

export const transfersApi: TransfersApi = createTransfersApi(defaultClient, defaultTokens, API_URL);
