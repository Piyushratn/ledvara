-- Up Migration
CREATE TABLE outbox_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type           text NOT NULL CHECK (char_length(type) BETWEEN 1 AND 100),
  aggregate_type text NOT NULL,
  aggregate_id   uuid NOT NULL,
  payload        jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz
);

-- The worker only scans unpublished rows, so keep that index small.
CREATE INDEX outbox_events_unpublished_idx ON outbox_events (created_at, id)
  WHERE published_at IS NULL;
CREATE INDEX outbox_events_org_idx ON outbox_events (org_id, created_at DESC);

-- Down Migration
DROP TABLE IF EXISTS outbox_events;