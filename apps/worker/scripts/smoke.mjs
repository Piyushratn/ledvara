import "dotenv/config";
import { createCipheriv, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import http from "node:http";
import process from "node:process";
import pg from "pg";

const API = process.env.SMOKE_API_URL ?? "http://localhost:3000";
const KEY_HEX = process.env.WEBHOOK_SECRET_KEY ?? "";
const PASSWORD = "correct-horse-battery";

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to run: this script writes test data and is for development only.");
  process.exit(1);
}
if (!process.env.DATABASE_URL || !/^[0-9a-f]{64}$/iu.test(KEY_HEX)) {
  console.error("DATABASE_URL and a 64-hex WEBHOOK_SECRET_KEY must be set in apps/worker/.env.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const steps = [];
const ok = (message) => {
  steps.push(message);
  console.log(`  ok  ${message}`);
};

function fail(message) {
  console.error(`  FAIL ${message}`);
  throw new Error(message);
}

async function call(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = {};
  try {
    json = JSON.parse(text);
  } catch {
    // non-JSON body
  }
  return { status: res.status, json, text };
}

function encryptSecret(plaintext, aad) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(KEY_HEX, "hex"), iv);
  cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), ct]
    .map((p, i) => (i === 0 ? p : p.toString("base64url")))
    .join(".");
}

function verifySignature(secret, header, body) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2)));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${body}`).digest("hex"));
  const given = Buffer.from(parts.v1 ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function main() {
  console.log(`Smoke test against ${API}`);

  // 1. Local receiver.
  const received = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      received.push({ headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
      res.writeHead(200).end("ok");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  ok(`receiver listening on 127.0.0.1:${port}`);

  const stamp = Date.now();
  const email = `smoke-${stamp}@example.com`;
  let endpointId = "";
  try {
    // 2. User, organization, accounts (SQL for org and accounts, API for auth).
    const signup = await call("POST", "/v1/auth/signup", {
      body: { email, password: PASSWORD, fullName: "Smoke" },
    });
    if (signup.status !== 202) fail(`signup returned ${signup.status}`);
    await pool.query("UPDATE users SET email_verified_at = now() WHERE email = $1", [email]);
    const login = await call("POST", "/v1/auth/login", { body: { email, password: PASSWORD } });
    if (login.status !== 200) fail(`login returned ${login.status}`);
    const token = login.json.accessToken;
    ok("user signed up and logged in");

    const org = await pool.query(
      "INSERT INTO organizations (name, slug) VALUES ('Smoke', $1) RETURNING id",
      [`smoke-${stamp}`],
    );
    const orgId = org.rows[0].id;
    await pool.query(
      "INSERT INTO memberships (org_id, user_id, role) SELECT $1, id, 'owner' FROM users WHERE email = $2",
      [orgId, email],
    );
    const acct = async (code, type, allowNegative) =>
      (
        await pool.query(
          "INSERT INTO accounts (org_id, code, name, type, allow_negative) VALUES ($1, $2, $2, $3, $4) RETURNING id",
          [orgId, code, type, allowNegative],
        )
      ).rows[0].id;
    const platform = await acct("platform_funds", "asset", true);
    const wallet = await acct("wallet_smoke", "wallet", false);
    ok("organization and accounts created");

    // 3. API key.
    const key = await call("POST", `/v1/orgs/${orgId}/api-keys`, {
      token,
      body: { name: "smoke", scopes: ["ledger:write", "ledger:read"] },
    });
    if (key.status !== 201) fail(`api key creation returned ${key.status}`);
    const apiKey = key.json.key;
    ok("API key created");

    // 4. Webhook endpoint, inserted directly because the API only accepts https URLs.
    endpointId = randomUUID();
    const secret = `whsec_${randomBytes(24).toString("base64url")}`;
    await pool.query(
      `INSERT INTO webhook_endpoints (id, org_id, url, secret_enc, event_types)
       VALUES ($1, $2, $3, $4, ARRAY['*']::text[])`,
      [endpointId, orgId, `http://127.0.0.1:${port}/hook`, encryptSecret(secret, endpointId)],
    );
    ok("webhook endpoint registered");

    // 5. Move money through the real API.
    const transfer = await call("POST", "/v1/transfers", {
      token: apiKey,
      headers: { "x-api-key": apiKey, "idempotency-key": `smoke-${stamp}` },
      body: { fromAccountId: platform, toAccountId: wallet, amountMinor: 1000, reference: "smoke" },
    });
    if (transfer.status !== 200 && transfer.status !== 201 && transfer.status !== 202) {
      fail(`transfer returned ${transfer.status}: ${transfer.text.slice(0, 200)}`);
    }
    ok(`transfer accepted (HTTP ${transfer.status})`);

    // 6. Wait for the worker to deliver.
    const deadline = Date.now() + 30_000;
    while (received.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (received.length === 0) {
      fail(
        "no webhook arrived within 30s. Is the worker running with WEBHOOK_ALLOW_PRIVATE_TARGETS=true?",
      );
    }
    const hit = received[0];
    ok(`webhook received (${hit.headers["ledvara-event-type"]})`);

    if (!verifySignature(secret, String(hit.headers["ledvara-signature"] ?? ""), hit.body)) {
      fail("signature did not verify");
    }
    ok("signature verified with the endpoint secret");

    await new Promise((resolve) => setTimeout(resolve, 500));
    const row = await pool.query(
      "SELECT status FROM webhook_deliveries WHERE endpoint_id = $1 ORDER BY created_at DESC LIMIT 1",
      [endpointId],
    );
    if (row.rows[0]?.status !== "succeeded") fail(`delivery row status is ${row.rows[0]?.status}`);
    ok("delivery logged as succeeded");

    console.log(`\nSmoke test passed (${steps.length} checks).`);
  } finally {
    if (endpointId)
      await pool.query("UPDATE webhook_endpoints SET enabled = false WHERE id = $1", [endpointId]);
    server.closeAllConnections();
    server.close();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`\nSmoke test failed: ${error.message}`);
  process.exit(1);
});
