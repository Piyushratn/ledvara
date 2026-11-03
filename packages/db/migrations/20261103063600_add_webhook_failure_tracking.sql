-- Up Migration
ALTER TABLE webhook_endpoints
  ADD COLUMN consecutive_failures integer NOT NULL DEFAULT 0,
  ADD COLUMN disabled_at timestamptz,
  ADD COLUMN disabled_reason text;

-- Down Migration
ALTER TABLE webhook_endpoints
  DROP COLUMN IF EXISTS disabled_reason,
  DROP COLUMN IF EXISTS disabled_at,
  DROP COLUMN IF EXISTS consecutive_failures;