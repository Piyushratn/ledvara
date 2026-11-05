-- Up Migration
CREATE TABLE risk_assessments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  transaction_id uuid NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE RESTRICT,
  rules_version  text NOT NULL,
  score          integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  level          text NOT NULL CHECK (level IN ('low', 'medium', 'high')),
  flagged        boolean NOT NULL,
  reasons        jsonb NOT NULL DEFAULT '[]'::jsonb,
  inputs         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX risk_assessments_org_created_idx ON risk_assessments (org_id, created_at DESC);

CREATE FUNCTION risk_assessments_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'risk_assessments is append-only: % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER risk_assessments_no_update_delete
  BEFORE UPDATE OR DELETE ON risk_assessments
  FOR EACH ROW EXECUTE FUNCTION risk_assessments_append_only();

CREATE TABLE review_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  transaction_id uuid NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE RESTRICT,
  assessment_id  uuid NOT NULL REFERENCES risk_assessments(id) ON DELETE RESTRICT,
  status         text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewer_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewer_note  text,
  decided_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- A pending item has no decision time; a decided item always has one.
  CONSTRAINT review_items_decision_consistent
    CHECK ((status = 'pending') = (decided_at IS NULL))
);

CREATE INDEX review_items_org_status_idx ON review_items (org_id, status, created_at DESC);

-- Down Migration
DROP TABLE IF EXISTS review_items;
DROP TRIGGER IF EXISTS risk_assessments_no_update_delete ON risk_assessments;
DROP TABLE IF EXISTS risk_assessments;
DROP FUNCTION IF EXISTS risk_assessments_append_only();