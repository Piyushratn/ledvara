# ADR 0001: Money is stored as integer paise

Status: accepted

## Context

Ledvara moves simulated money in INR. Floating point numbers cannot represent most decimal
amounts exactly (0.1 + 0.2 is not 0.3), so rounding errors would silently create or destroy money.

## Decision

- All amounts are stored as integers in the currency's minor unit. For INR that is paise
  (Rs 1.00 = 100).
- The database column type is `bigint`, with a CHECK that amounts are positive.
- In JavaScript, `pg` returns `bigint` as a string by default. We never convert stored amounts to
  `number`. API requests and responses carry amounts as integers in minor units, validated to the
  safe range (at most 9,007,199,254,740,991) at the boundary, and the code does arithmetic with
  `bigint`.
- Every account has a `currency` column. The first release supports `INR` only, but the schema
  and transfer checks already carry currency, so adding more is a data change, not a rewrite.

## Consequences

- No rounding anywhere in the money path.
- Display formatting (Rs 12,345.67) happens only in the dashboard.
- Percentage-based calculations (fees) must define their rounding rule explicitly when added.
