import { signPayload } from "./signature.js";
import type { Sender } from "./simulator.js";

export function makeHttpSender(
  url: string,
  secret: string,
  fetchImpl: typeof fetch = fetch,
): Sender {
  return async (event) => {
    const body = JSON.stringify(event);
    const timestamp = Math.floor(Date.now() / 1000);
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-provider-signature": signPayload(secret, body, timestamp),
      },
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      throw new Error(`Callback endpoint answered ${response.status}`);
    }
  };
}
