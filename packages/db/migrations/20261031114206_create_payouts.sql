-- Up Migration
CREATE TABLE payouts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  transaction_id     uuid NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE RESTRICT,
  source_account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  amount_minor       bigint NOT NULL CHECK (amount_minor > 0),
  destination_label  text NOT NULL CHECK (char_length(destination_label) BETWEEN 1 AND 100),
  provider_ref       text UNIQUE,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payouts_org_created_idx ON payouts (org_id, created_at DESC);

CREATE TRIGGER payouts_set_updated_at
  BEFORE UPDATE ON payouts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration
DROP TRIGGER IF EXISTS payouts_set_updated_at ON payouts;
DROP TABLE IF EXISTS payouts;