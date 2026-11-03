# Receiving Ledvara webhooks

Ledvara sends each event as an HTTPS `POST` with a JSON body.

## Headers

| Header               | Meaning                                      |
| -------------------- | -------------------------------------------- |
| `ledvara-signature`  | `t=<unix seconds>,v1=<hex HMAC-SHA256>`      |
| `ledvara-event-id`   | Unique event id. Use it to de-duplicate.     |
| `ledvara-event-type` | For example `payout.paid` or `webhook.test`. |

## Body

```json
{
  "id": "event id",
  "type": "payout.paid",
  "createdAt": "2026-11-01T10:00:00Z",
  "data": {}
}
```

## Verify every request

The signature is HMAC-SHA256, keyed with your endpoint's signing secret (`whsec_...`), over the
string `<t>.<raw request body>`.

1. Read the **raw** body. Do not parse and re-serialize it, because that changes the bytes.
2. Parse `t` and `v1` from the header.
3. Reject if `t` is more than 5 minutes from your clock. This stops replayed requests.
4. Compute the HMAC and compare it with `v1` in constant time.
5. Reply with a `2xx` status quickly. Do slow work after replying.

### Node.js

```js
import { createHmac, timingSafeEqual } from "node:crypto";

export function verify(secret, header, rawBody, toleranceSeconds = 300) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  const t = Number(parts.t);
  if (!Number.isInteger(t)) return false;
  if (Math.abs(Date.now() / 1000 - t) > toleranceSeconds) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const given = Buffer.from(parts.v1 ?? "");
  const wanted = Buffer.from(expected);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}
```

### Python

```python
import hashlib
import hmac
import time


def verify(secret: str, header: str, raw_body: bytes, tolerance: int = 300) -> bool:
    parts = dict(p.split("=", 1) for p in header.split(","))
    try:
        t = int(parts["t"])
    except (KeyError, ValueError):
        return False
    if abs(time.time() - t) > tolerance:
        return False
    signed = f"{t}.".encode() + raw_body
    expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return hmac.compare_digest(parts.get("v1", ""), expected)
```

## Retries

A non-`2xx` response, a timeout (10 seconds) or a connection error is retried up to 8 times with
exponential backoff starting at 10 seconds. Redirects are not followed. Use `ledvara-event-id` to
ignore an event you have already processed, because retries and manual resends repeat it.

## Testing

`POST /v1/orgs/:orgId/webhook-endpoints/:id/test` sends a `webhook.test` event to one endpoint.
The result appears in `GET /v1/orgs/:orgId/webhook-deliveries`. A failed delivery can be retried
with `POST /v1/orgs/:orgId/webhook-deliveries/:id/resend`.

## Rotating a secret

`POST .../webhook-endpoints/:id/rotate-secret` returns a new secret and invalidates the old one
immediately. Update your receiver first if you cannot tolerate failed deliveries.

## Automatic disabling

If 10 events in a row fail permanently (all 8 attempts used, or the target is refused as unsafe),
Ledvara disables the endpoint and stops sending it new events. `GET .../webhook-endpoints` then shows
`enabled: false`, `disabledAt` and `disabledReason`. A single successful delivery resets the count.
Fix your receiver, then re-enable with
`PATCH .../webhook-endpoints/:id` and `{ "enabled": true }`, and use the `/test` route to confirm.
