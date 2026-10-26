# Ledvara

A **sandbox payments platform** with a double-entry ledger, idempotent payment APIs, signed webhooks, reconciliation, and an explainable risk engine.

> Ledvara uses **simulated money only**. It never moves real money and never touches real cards.

## Status

Under active development. Setup instructions will be added as the project grows.

## Repository layout

- `apps/` – API, worker, provider simulator, dashboard, public site
- `packages/` – shared code (database, schemas, config)
- `docs/` – architecture notes and decision records
- `load-tests/` – k6 load test scripts and reports
