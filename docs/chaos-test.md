# Chaos test

`apps/api/src/chaos/chaos.int.spec.ts` starts Postgres and Redis in containers and runs the compiled
API (`apps/api/dist/main.js`) as a separate process. It sends 40 concurrent transfers, each with its
own `Idempotency-Key`, kills the API with `SIGKILL` after the first few answers arrive, restarts it,
and retries every request with its original key. It repeats this three times.

After each round it checks that:

- every transfer the client was told succeeded was already committed when the process died
- each request moved money exactly once (40 transfers, 80 entries, both balances equal to 40 x amount)
- every transaction has balanced entries, none is missing its entries, none is stuck outside `settled`
- stored balances equal the sum of ledger entries
- each transfer has exactly one `transfer.settled` outbox event, with no orphans
- every idempotency key is stored with its final response

The test fails if the kill lands when nothing was answered yet, or when no request was in flight.

## What this does not prove

It kills the API process only. It does not kill Postgres, simulate a power loss or a disk fault, or
exercise the worker. Run it with `pnpm build && pnpm --filter @ledvara/api test:integration`.
