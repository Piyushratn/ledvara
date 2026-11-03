-- Up Migration
CREATE TABLE webhook_endpoints (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  url         text NOT NULL,
  description text,
  secret_enc  text NOT NULL,
  event_types text[] NOT NULL DEFAULT ARRAY['*']::text[],
  enabled     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX webhook_endpoints_org_idx ON webhook_endpoints (org_id) WHERE enabled;

CREATE TABLE webhook_deliveries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  endpoint_id      uuid NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_id         uuid NOT NULL,
  event_type       text NOT NULL,
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'succeeded', 'failed')),
  attempts         integer NOT NULL DEFAULT 0,
  last_status_code integer,
  last_error       text,
  last_attempt_at  timestamptz,
  delivered_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (endpoint_id, event_id)
);

CREATE INDEX webhook_deliveries_org_created_idx ON webhook_deliveries (org_id, created_at DESC);

-- Down Migration
DROP TABLE IF EXISTS webhook_deliveries;
DROP TABLE IF EXISTS webhook_endpoints;