-- Up Migration
CREATE TABLE accounts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  environment    text NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox')),
  code           text CHECK (code ~ '^[a-z0-9_]{2,64}$'),
  name           text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  type           text NOT NULL CHECK (type IN ('asset', 'liability', 'revenue', 'expense', 'wallet')),
  currency       text NOT NULL DEFAULT 'INR' CHECK (currency IN ('INR')),
  allow_negative boolean NOT NULL DEFAULT false,
  balance_minor  bigint NOT NULL DEFAULT 0,
  closed_at      timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accounts_non_negative CHECK (allow_negative OR balance_minor >= 0),
  UNIQUE (org_id, environment, code)
);

CREATE INDEX accounts_org_id_idx ON accounts (org_id);

CREATE TRIGGER accounts_set_updated_at
  BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration
DROP TRIGGER IF EXISTS accounts_set_updated_at ON accounts;
DROP TABLE IF EXISTS accounts;