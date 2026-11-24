-- Up Migration
CREATE TABLE transaction_status_history (
  id             bigserial PRIMARY KEY,
  transaction_id uuid NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  org_id         uuid NOT NULL,
  status         text NOT NULL,
  changed_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  backfilled     boolean NOT NULL DEFAULT false
);

CREATE INDEX transaction_status_history_txn_idx
  ON transaction_status_history (transaction_id, id);

CREATE FUNCTION log_transaction_status() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO transaction_status_history (transaction_id, org_id, status)
    VALUES (NEW.id, NEW.org_id, NEW.status);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER transactions_log_insert
  AFTER INSERT ON transactions
  FOR EACH ROW EXECUTE FUNCTION log_transaction_status();

CREATE TRIGGER transactions_log_status
  AFTER UPDATE OF status ON transactions
  FOR EACH ROW EXECUTE FUNCTION log_transaction_status();

-- Existing rows: every transaction started as 'created'. The current status is stamped with
-- updated_at, which is approximate, so both rows are flagged.
INSERT INTO transaction_status_history (transaction_id, org_id, status, changed_at, backfilled)
SELECT id, org_id, 'created', created_at, true FROM transactions;

INSERT INTO transaction_status_history (transaction_id, org_id, status, changed_at, backfilled)
SELECT id, org_id, status, updated_at, true FROM transactions WHERE status <> 'created';

-- Down Migration
DROP TRIGGER IF EXISTS transactions_log_status ON transactions;
DROP TRIGGER IF EXISTS transactions_log_insert ON transactions;
DROP FUNCTION IF EXISTS log_transaction_status();
DROP TABLE IF EXISTS transaction_status_history;