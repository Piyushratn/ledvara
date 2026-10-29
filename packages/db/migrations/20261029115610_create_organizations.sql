-- Up Migration
CREATE TABLE organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  slug        citext NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'),
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER organizations_set_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE memberships (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('owner', 'admin', 'developer', 'finance', 'viewer')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);

CREATE INDEX memberships_user_id_idx ON memberships (user_id);

CREATE TRIGGER memberships_set_updated_at
  BEFORE UPDATE ON memberships
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE invites (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email        citext NOT NULL,
  role         text NOT NULL CHECK (role IN ('admin', 'developer', 'finance', 'viewer')),
  token_hash   text NOT NULL UNIQUE,
  invited_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at   timestamptz NOT NULL,
  accepted_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX invites_org_id_idx ON invites (org_id);
CREATE INDEX invites_email_idx ON invites (email);

-- Down Migration
DROP TABLE IF EXISTS invites;
DROP TABLE IF EXISTS memberships;
DROP TRIGGER IF EXISTS organizations_set_updated_at ON organizations;
DROP TABLE IF EXISTS organizations;