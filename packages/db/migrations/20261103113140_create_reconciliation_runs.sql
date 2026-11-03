-- Up Migration
CREATE TABLE reconciliation_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  accounts_checked integer NOT NULL DEFAULT 0,
  balance_drifts   integer NOT NULL DEFAULT 0,
  unbalanced_txns  integer NOT NULL DEFAULT 0,
  details          jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX reconciliation_runs_started_idx ON reconciliation_runs (started_at DESC);

-- Down Migration
DROP TABLE IF EXISTS reconciliation_runs;