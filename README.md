# Ledvara

A **sandbox payments platform** with a double-entry ledger, idempotent payment APIs, signed webhooks, reconciliation, and an explainable risk engine.

> Ledvara uses **simulated money only**. It never moves real money and never touches real cards.

## Status

Built so far:

- **Foundation:** config validation, structured logging, health checks, error format, security headers, graceful shutdown, CI.
- **Auth:** sign up, email verification, login with rotating refresh tokens, password reset, lockout and rate limiting, TOTP two-factor, active sessions.
- **Organizations:** roles and permissions, invites, API keys with scopes, audit log, tenant isolation tests.
- **Ledger:** append-only double-entry ledger enforced by database triggers, row-locked posting, transfer state machine, idempotency keys, reversals, refunds, payouts through a provider simulator, balances with time travel.
- **Events:** transactional outbox, relay into BullMQ, signed webhook delivery with retries, SSRF protection, auto-disable, test ping and resend.
- **Reconciliation:** hourly check that stored balances equal the sum of entries, with per-organization alerts.

Coming next: risk engine, dashboard, public site, load tests.

## Requirements

- Node.js 22
- pnpm (`npm install -g pnpm`)
- Git
- Docker Desktop (running)

## Local setup

```bash
git clone https://github.com/Piyushratn/ledvara.git
cd ledvara
pnpm install
cp .env.example apps/api/.env      # Windows PowerShell: Copy-Item .env.example apps\api\.env
pnpm dev
```

`pnpm dev` starts Postgres, Redis and Mailpit with Docker Compose, then runs the apps in watch mode.

Apply database migrations with `pnpm db:migrate`.

## Services

| Service       | Where                 | Purpose                                        |
| ------------- | --------------------- | ---------------------------------------------- |
| API           | http://localhost:3000 | REST API (`/healthz`, `/readyz`)               |
| Worker        | `apps/worker`         | Outbox relay, webhook delivery, reconciliation |
| Provider sim  | http://localhost:4000 | Simulated payout provider                      |
| Postgres      | localhost:5432        | Primary database                               |
| Redis         | localhost:6379        | Rate limits and job queues                     |
| Mailpit inbox | http://localhost:8025 | Fake email                                     |

## Environment

| Variable                        | Used by     | Notes                                           |
| ------------------------------- | ----------- | ----------------------------------------------- |
| `DATABASE_URL`, `REDIS_URL`     | API, worker |                                                 |
| `JWT_SECRET`                    | API         | At least 32 characters                          |
| `TWO_FACTOR_ENCRYPTION_KEY`     | API         | 64 hex characters                               |
| `WEBHOOK_SECRET_KEY`            | API, worker | 64 hex characters, **the same value in both**   |
| `WEBHOOK_ALLOW_PRIVATE_TARGETS` | worker      | Dev and tests only. Never enable in production. |
| `RECONCILE_INTERVAL_MS`         | worker      | Default one hour, `0` disables                  |

Generate a key with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.

## Useful commands

| Command                     | What it does                                                   |
| --------------------------- | -------------------------------------------------------------- |
| `pnpm dev`                  | Start infrastructure and all apps in watch mode                |
| `pnpm lint`                 | Run ESLint                                                     |
| `pnpm typecheck`            | Run the TypeScript compiler without output                     |
| `pnpm test`                 | Unit tests (no Docker)                                         |
| `pnpm test:integration:all` | Integration tests against real Postgres and Redis (Docker)     |
| `pnpm build`                | Build all apps                                                 |
| `pnpm format`               | Format all files with Prettier                                 |
| `pnpm smoke`                | End-to-end check: transfer, outbox, signed webhook (see below) |
| `docker compose down`       | Stop the local infrastructure                                  |

### Smoke test

Run the API and the worker (`WEBHOOK_ALLOW_PRIVATE_TARGETS=true` for the worker), then `pnpm smoke`.
It creates a user, organization, accounts and API key, moves money, and checks that a correctly
signed webhook reaches a local receiver. Development only.

## Webhooks

See [docs/webhooks.md](docs/webhooks.md) for the payload, signature format, verification code in
Node and Python, retries, and automatic disabling.

## Repository layout

- `apps/` - API, worker, provider simulator, dashboard, public site
- `packages/` - shared code (database, schemas, config)
- `docs/` - architecture notes, decision records, webhook guide
- `load-tests/` - k6 load test scripts and reports

## Commit style

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `test:`, `docs:`, `chore:`), enforced by a commit hook.
