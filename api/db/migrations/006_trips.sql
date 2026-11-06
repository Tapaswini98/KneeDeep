-- Dispatch decisions: an agent checked conditions along candidate routes (paying per query), then
-- dispatched on one route or held the delivery. Recorded by the agent (POST /v1/trips, with
-- AGENT_API_TOKEN) so the dashboard can show the decision and its reasons on the map.
CREATE TABLE trips (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  origin               JSONB NOT NULL,                  -- { name, lat, lng }
  destination          JSONB NOT NULL,
  vehicle              TEXT NOT NULL,
  -- Per route: id, name, distanceKm, verdict, reason, avgConfidence, and per checkpoint the cell,
  -- level, passability, confidence and reason the decision rested on.
  routes               JSONB NOT NULL,
  chosen_route         TEXT,                            -- route id; NULL when held
  outcome              TEXT NOT NULL CHECK (outcome IN ('dispatched', 'held')),
  reasons              TEXT[] NOT NULL,
  total_cost_tinybars  BIGINT NOT NULL CHECK (total_cost_tinybars >= 0),
  tx_ids               TEXT[] NOT NULL DEFAULT '{}',    -- the Hedera payments for its paid queries
  network              TEXT,
  data_status          TEXT NOT NULL CHECK (data_status IN ('live', 'simulated', 'mixed', 'empty')),
  CHECK ((outcome = 'held') = (chosen_route IS NULL))
);

CREATE INDEX trips_recent ON trips (created_at DESC);
