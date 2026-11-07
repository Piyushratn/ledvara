-- Up Migration
CREATE TABLE provider_reconciliation_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  status          text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'error')),
  error           text,
  payouts_checked integer NOT NULL DEFAULT 0,
  report_entries  integer NOT NULL DEFAULT 0,
  counts          jsonb NOT NULL DEFAULT '{}'::jsonb,
  items           jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX provider_reconciliation_runs_started_idx
  ON provider_reconciliation_runs (started_at DESC);

-- Down Migration
DROP TABLE IF EXISTS provider_reconciliation_runs;