-- Up Migration
ALTER TABLE users
  ADD COLUMN two_factor_secret_enc text,
  ADD COLUMN two_factor_enabled_at timestamptz,
  ADD COLUMN two_factor_last_step integer;

CREATE TABLE two_factor_backup_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash   text NOT NULL UNIQUE,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX two_factor_backup_codes_user_id_idx ON two_factor_backup_codes (user_id);

-- Down Migration
DROP TABLE IF EXISTS two_factor_backup_codes;

ALTER TABLE users
  DROP COLUMN IF EXISTS two_factor_last_step,
  DROP COLUMN IF EXISTS two_factor_enabled_at,
  DROP COLUMN IF EXISTS two_factor_secret_enc;