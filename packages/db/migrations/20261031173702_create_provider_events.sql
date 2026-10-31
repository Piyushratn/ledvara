-- Up Migration
CREATE TABLE provider_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     text NOT NULL UNIQUE,
  payout_ref   text NOT NULL,
  type         text NOT NULL,
  sequence     integer NOT NULL,
  payload      jsonb NOT NULL,
  outcome      text NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX provider_events_payout_ref_idx ON provider_events (payout_ref);

-- Down Migration
DROP TABLE IF EXISTS provider_events;