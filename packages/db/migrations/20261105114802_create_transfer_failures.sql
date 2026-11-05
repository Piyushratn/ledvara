-- Up Migration
CREATE TABLE transfer_failures (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  from_account_id uuid NOT NULL,
  api_key_id      uuid,
  amount_minor    bigint NOT NULL CHECK (amount_minor > 0),
  code            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX transfer_failures_account_idx
  ON transfer_failures (org_id, from_account_id, created_at DESC);

-- Down Migration
DROP TABLE IF EXISTS transfer_failures;