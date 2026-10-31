-- Up Migration
CREATE TABLE idempotency_keys (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key              text NOT NULL CHECK (char_length(key) BETWEEN 1 AND 255),
  request_hash     text NOT NULL,
  response_status  integer NOT NULL,
  response_body    jsonb NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, key)
);

-- Down Migration
DROP TABLE IF EXISTS idempotency_keys;