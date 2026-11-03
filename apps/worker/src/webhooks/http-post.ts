import { lookup as dnsLookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { isBlockedAddress } from "./ip-guard.js";

const MAX_RESPONSE_BYTES = 64 * 1024;

/**
 * DNS lookup that refuses private addresses. Because the socket connects to the address
 * returned here, the check cannot be bypassed by DNS rebinding.
 */
export function createSafeLookup(allowPrivate: boolean): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) {
        callback(error, "", 0);
        return;
      }
      const allowed = allowPrivate
        ? addresses
        : addresses.filter((entry) => !isBlockedAddress(entry.address));
      const [first] = allowed;
      if (!first) {
        const blocked = Object.assign(new Error(`Blocked address for ${hostname}`), {
          code: "EBLOCKED",
        }) as NodeJS.ErrnoException;
        callback(blocked, "", 0);
        return;
      }
      if (options.all) {
        callback(null, allowed);
        return;
      }
      callback(null, first.address, first.family);
    });
  };
}

export interface PostResult {
  status: number;
}

export interface PostOptions {
  timeoutMs: number;
  allowPrivate: boolean;
}

/** POSTs JSON. Never follows redirects; reads at most 64 KiB of the response. */
export function postJson(
  url: URL,
  body: string,
  headers: Record<string, string>,
  options: PostOptions,
): Promise<PostResult> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request(
      url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(body)),
          "user-agent": "Ledvara-Webhooks/1.0",
          ...headers,
        },
        lookup: createSafeLookup(options.allowPrivate),
        signal: AbortSignal.timeout(options.timeoutMs),
      },
      (response) => {
        let received = 0;
        response.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > MAX_RESPONSE_BYTES) {
            resolve({ status: response.statusCode ?? 0 });
            request.destroy();
          }
        });
        response.on("end", () => resolve({ status: response.statusCode ?? 0 }));
        response.on("error", reject);
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}
