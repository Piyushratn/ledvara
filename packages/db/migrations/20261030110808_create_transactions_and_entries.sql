-- Up Migration
CREATE TABLE transactions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  environment text NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox')),
  kind        text NOT NULL CHECK (kind IN ('transfer', 'refund', 'reversal', 'payout')),
  status      text NOT NULL DEFAULT 'created'
              CHECK (status IN ('created', 'pending', 'settled', 'failed', 'reversed')),
  reverses_id uuid REFERENCES transactions(id) ON DELETE RESTRICT,
  reference   text CHECK (char_length(reference) <= 200),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX transactions_org_created_idx ON transactions (org_id, created_at DESC, id DESC);

CREATE TRIGGER transactions_set_updated_at
  BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE ledger_entries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq            bigserial NOT NULL UNIQUE,
  transaction_id uuid NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  org_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  account_id     uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  direction      text NOT NULL CHECK (direction IN ('debit', 'credit')),
  amount_minor   bigint NOT NULL CHECK (amount_minor > 0),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ledger_entries_transaction_idx ON ledger_entries (transaction_id);
CREATE INDEX ledger_entries_account_seq_idx ON ledger_entries (account_id, seq);
CREATE INDEX ledger_entries_account_created_idx ON ledger_entries (account_id, created_at);

-- An entry must belong to the same org as both its account and its transaction.
CREATE FUNCTION ledger_entries_check_tenant() RETURNS trigger AS $$
DECLARE
  account_org uuid;
  txn_org uuid;
BEGIN
  SELECT org_id INTO account_org FROM accounts WHERE id = NEW.account_id;
  SELECT org_id INTO txn_org FROM transactions WHERE id = NEW.transaction_id;
  IF account_org IS DISTINCT FROM NEW.org_id OR txn_org IS DISTINCT FROM NEW.org_id THEN
    RAISE EXCEPTION 'ledger entry org mismatch (account %, transaction %)',
      NEW.account_id, NEW.transaction_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entries_tenant_check
  BEFORE INSERT ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_check_tenant();

-- Zero-sum rule, checked once per transaction at COMMIT.
CREATE FUNCTION ledger_check_balanced() RETURNS trigger AS $$
DECLARE
  debits bigint;
  credits bigint;
  entry_count integer;
BEGIN
  SELECT
    COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'debit'), 0),
    COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'credit'), 0),
    COUNT(*)
  INTO debits, credits, entry_count
  FROM ledger_entries
  WHERE transaction_id = NEW.transaction_id;

  IF entry_count < 2 THEN
    RAISE EXCEPTION 'transaction % needs at least 2 entries (has %)',
      NEW.transaction_id, entry_count;
  END IF;
  IF debits <> credits THEN
    RAISE EXCEPTION 'transaction % is unbalanced: debits % <> credits %',
      NEW.transaction_id, debits, credits;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER ledger_entries_balanced
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_check_balanced();

-- Down Migration
DROP TRIGGER IF EXISTS ledger_entries_balanced ON ledger_entries;
DROP FUNCTION IF EXISTS ledger_check_balanced();
DROP TRIGGER IF EXISTS ledger_entries_tenant_check ON ledger_entries;
DROP FUNCTION IF EXISTS ledger_entries_check_tenant();
DROP TABLE IF EXISTS ledger_entries;
DROP TRIGGER IF EXISTS transactions_set_updated_at ON transactions;
DROP TABLE IF EXISTS transactions;