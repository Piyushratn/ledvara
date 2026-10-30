# ADR 0002: An append-only, double-entry ledger enforced by the database

Status: accepted

## Context

A payments ledger must never lose, create or silently change money, even when application code
has bugs or two requests race.

## Decision

- Every movement of money is a `transaction` that owns two or more `ledger_entries`.
- Each entry has a direction (`debit` or `credit`) and a positive `amount_minor`.
- A transaction is balanced when total debits equal total credits. This is enforced by a deferred
  constraint trigger in Postgres, evaluated at COMMIT, so application bugs cannot commit an
  unbalanced transaction.
- `ledger_entries` (and the transaction's money fields) are append-only. BEFORE UPDATE and
  BEFORE DELETE triggers raise an exception. Corrections are new reversing transactions linked to
  the original.
- Balances are derived from entries. A stored balance row may exist for speed, but it must always
  be verifiable by summing entries, and a test checks that.
- Wallet accounts cannot go negative (configurable per account). The check is enforced inside the
  database transaction with a row lock on the account, so 100 parallel debits can never overdraw.
- Transfers move through a state machine: created, pending, settled, failed or reversed. Invalid
  transitions are rejected.

## Consequences

- History is complete and auditable, and "time travel" balances are a simple query.
- Mistakes are fixed by reversing entries, never by editing rows.
- Row locking serializes writes to the same account. That is the correct trade-off for
  correctness, and throughput across different accounts is unaffected.
