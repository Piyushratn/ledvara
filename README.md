# Ledvara

A **sandbox payments platform** with a double-entry ledger, idempotent payment APIs, signed webhooks, reconciliation, and an explainable risk engine.

> Ledvara uses **simulated money only**. It never moves real money and never touches real cards.

## Status

Under active development. The API foundation (config, logging, health checks, error format, security headers, graceful shutdown, CI) is in place. The ledger, auth and dashboard are coming next.

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

`pnpm dev` starts Postgres, Redis and Mailpit with Docker Compose, then runs the API with auto-restart.

Then check it:

- API: http://localhost:3000/
- Liveness: http://localhost:3000/healthz
- Readiness (checks Postgres and Redis): http://localhost:3000/readyz
- Mailpit inbox (fake email): http://localhost:8025

## Useful commands

| Command               | What it does                                   |
| --------------------- | ---------------------------------------------- |
| `pnpm dev`            | Start infrastructure and the API in watch mode |
| `pnpm lint`           | Run ESLint                                     |
| `pnpm typecheck`      | Run the TypeScript compiler without output     |
| `pnpm test`           | Run all tests                                  |
| `pnpm build`          | Build all apps                                 |
| `pnpm format`         | Format all files with Prettier                 |
| `docker compose down` | Stop the local infrastructure                  |

## Repository layout

- `apps/` – API, worker, provider simulator, dashboard, public site
- `packages/` – shared code (database, schemas, config)
- `docs/` – architecture notes and decision records
- `load-tests/` – k6 load test scripts and reports

## Commit style

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `test:`, `docs:`, `chore:`), enforced by a commit hook.
