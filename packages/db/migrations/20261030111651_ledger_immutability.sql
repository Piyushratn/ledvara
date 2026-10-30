-- Up Migration
CREATE FUNCTION ledger_reject_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entries_no_update
  BEFORE UPDATE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_reject_change();

CREATE TRIGGER ledger_entries_no_delete
  BEFORE DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_reject_change();

CREATE TRIGGER transactions_no_delete
  BEFORE DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION ledger_reject_change();

-- Only the status of a transaction may change (the state machine lives above this).
CREATE FUNCTION transactions_only_status_changes() RETURNS trigger AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.environment IS DISTINCT FROM OLD.environment
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.reverses_id IS DISTINCT FROM OLD.reverses_id
     OR NEW.reference IS DISTINCT FROM OLD.reference
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'transactions is append-only: only status may change';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER transactions_limit_update
  BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION transactions_only_status_changes();

-- Block TRUNCATE unless a test session explicitly opts in.
CREATE FUNCTION ledger_reject_truncate() RETURNS trigger AS $$
BEGIN
  IF current_setting('ledvara.allow_truncate', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION '% is append-only: TRUNCATE is not allowed', TG_TABLE_NAME;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entries_no_truncate
  BEFORE TRUNCATE ON ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_reject_truncate();

CREATE TRIGGER transactions_no_truncate
  BEFORE TRUNCATE ON transactions
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_reject_truncate();

-- Down Migration
DROP TRIGGER IF EXISTS transactions_no_truncate ON transactions;
DROP TRIGGER IF EXISTS ledger_entries_no_truncate ON ledger_entries;
DROP FUNCTION IF EXISTS ledger_reject_truncate();
DROP TRIGGER IF EXISTS transactions_limit_update ON transactions;
DROP FUNCTION IF EXISTS transactions_only_status_changes();
DROP TRIGGER IF EXISTS transactions_no_delete ON transactions;
DROP TRIGGER IF EXISTS ledger_entries_no_delete ON ledger_entries;
DROP TRIGGER IF EXISTS ledger_entries_no_update ON ledger_entries;
DROP FUNCTION IF EXISTS ledger_reject_change();