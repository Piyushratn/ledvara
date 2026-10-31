# ADR 0003: Row locks, not SERIALIZABLE isolation, for ledger writes

Status: accepted

## Context

Concurrent transfers touching the same account must never overdraw it or lose an update. The two
standard approaches in Postgres are SERIALIZABLE isolation with retry on serialization failure,
or READ COMMITTED with explicit row locks (SELECT ... FOR UPDATE).

## Decision

- Ledger writes run at the default READ COMMITTED level.
- Each posting locks every involved account row with SELECT ... FOR UPDATE, in sorted id order,
  before computing new balances. Sorted order prevents deadlocks between opposing transfers.
- The balance check and the balance update happen while the locks are held.
- Database constraints remain the safety net: a CHECK stops negative balances on accounts that
  forbid them, and a deferred trigger rejects unbalanced transactions at COMMIT.

## Why not SERIALIZABLE

- Under contention on one hot account, SERIALIZABLE aborts many transactions and needs retry
  loops everywhere money moves. Row locks make writers queue instead, which is simpler to
  reason about and has predictable latency.
- Retry logic in the money path is itself a source of bugs (double execution if a retry is not
  idempotent).

## Consequences

- Writers to the same account are serialized. Writers to different accounts run in parallel.
- Evidence: the concurrency test (100 parallel transfers against a wallet funded for exactly 40
  yields 40 successes and a final balance of 0), the opposing-transfer test (no deadlock), and
  the property test (invariants over thousands of random transfers).
- If a future feature needs a multi-account invariant that row locks on those accounts cannot
  express, revisit this decision for that path only.
