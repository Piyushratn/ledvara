-- Up Migration
CREATE UNIQUE INDEX transactions_reverses_id_unique
  ON transactions (reverses_id)
  WHERE reverses_id IS NOT NULL AND kind = 'reversal';

-- Down Migration
DROP INDEX IF EXISTS transactions_reverses_id_unique;