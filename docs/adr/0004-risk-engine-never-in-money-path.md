# ADR 0004: The risk engine never sits in the money path

## Status

Accepted

## Context

Ledvara needs to flag suspicious transfers. A scoring service that can block or alter ledger writes
becomes part of the critical path: its bugs, timeouts or outages would stop or corrupt payments.

## Decision

- Risk scoring runs asynchronously in the worker, after a transfer is posted.
- The scorer is a pure function: the same transfer and history always give the same score and reasons.
- Scores, reasons and the rules version are stored with the transfer for later explanation.
- A high score creates a manual review item. It never changes ledger entries or balances.
- Any "hold" is a normal transfer state-machine transition made by deterministic code, not by the scorer.

## Consequences

- A risk outage cannot stop payments. The cost is that a risky transfer is flagged after it posts,
  not prevented.
- Decisions are reproducible and testable without a database.
- Thresholds live in one config object and every rule is covered by unit tests.
