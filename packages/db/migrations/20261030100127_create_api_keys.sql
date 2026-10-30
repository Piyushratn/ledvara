-- Up Migration
CREATE TABLE api_keys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  environment   text NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox')),
  key_prefix    text NOT NULL,
  key_hash      text NOT NULL UNIQUE,
  scopes        text[] NOT NULL CHECK (cardinality(scopes) > 0),
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX api_keys_org_id_idx ON api_keys (org_id);

-- Down Migration
DROP TABLE IF EXISTS api_keys;