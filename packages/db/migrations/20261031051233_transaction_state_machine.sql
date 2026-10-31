-- Up Migration
CREATE FUNCTION transactions_check_transition() RETURNS trigger AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF (OLD.status = 'created' AND NEW.status IN ('pending', 'settled', 'failed'))
     OR (OLD.status = 'pending' AND NEW.status IN ('settled', 'failed'))
     OR (OLD.status = 'settled' AND NEW.status = 'reversed') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'invalid transaction status transition: % -> %', OLD.status, NEW.status;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER transactions_status_transition
  BEFORE UPDATE OF status ON transactions
  FOR EACH ROW EXECUTE FUNCTION transactions_check_transition();

-- Down Migration
DROP TRIGGER IF EXISTS transactions_status_transition ON transactions;
DROP FUNCTION IF EXISTS transactions_check_transition();