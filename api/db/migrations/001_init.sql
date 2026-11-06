-- KneeDeep: Postgres holds money and rate limits. Reports themselves live on Arkiv;
-- report_index / vote_index only mirror what we wrote, so we can rate-limit and pay.

-- One row per verified human. pseudonym = sha256(PSEUDONYM_SALT || nullifier); the nullifier is never stored.
CREATE TABLE reporters (
  pseudonym          TEXT PRIMARY KEY,
  hedera_account_id  TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE report_index (
  entity_key   TEXT PRIMARY KEY,                       -- Arkiv entity key
  reporter     TEXT NOT NULL REFERENCES reporters(pseudonym),
  cell         TEXT NOT NULL,                          -- geohash, precision 7 (~150 m)
  level        TEXT NOT NULL CHECK (level IN ('dry', 'ankle', 'knee', 'waist', 'closed')),
  source       TEXT NOT NULL CHECK (source IN ('live', 'simulated')),
  reported_at  TIMESTAMPTZ NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  arkiv_tx     TEXT
);
-- Rate limit lookup: one report per human per cell per 30 minutes.
CREATE INDEX report_index_rate_limit ON report_index (reporter, cell, reported_at DESC);

CREATE TABLE vote_index (
  entity_key  TEXT PRIMARY KEY,                        -- Arkiv entity key of the vote
  report_key  TEXT NOT NULL,                           -- Arkiv entity key of the report voted on
  voter       TEXT NOT NULL REFERENCES reporters(pseudonym),
  vote        TEXT NOT NULL CHECK (vote IN ('confirm', 'dispute')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (report_key, voter)                           -- one vote per human per report
);

-- One row per paid GET /v1/conditions. payment_tx_id is the settled Hedera transaction.
CREATE TABLE queries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_tx_id    TEXT UNIQUE,
  payer_account    TEXT,
  amount_tinybars  BIGINT NOT NULL CHECK (amount_tinybars >= 0),
  lat              DOUBLE PRECISION NOT NULL,
  lng              DOUBLE PRECISION NOT NULL,
  radius_m         INTEGER NOT NULL,
  cells            TEXT[] NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Which reports a paid answer was built from.
CREATE TABLE query_reports (
  query_id     UUID NOT NULL REFERENCES queries(id),
  report_key   TEXT NOT NULL,
  reporter     TEXT NOT NULL REFERENCES reporters(pseudonym),
  corroborated BOOLEAN NOT NULL,
  PRIMARY KEY (query_id, report_key)
);

-- A payout batch is one multi-recipient Hedera transfer. Its id is the idempotency key.
CREATE TABLE payouts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'submitted', 'settled', 'failed')),
  tx_id            TEXT UNIQUE,
  total_tinybars   BIGINT NOT NULL DEFAULT 0,
  recipient_count  INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at       TIMESTAMPTZ
);

-- 70% of a query's revenue, split across the corroborated reporters it used.
CREATE TABLE earnings (
  id               BIGSERIAL PRIMARY KEY,
  query_id         UUID NOT NULL REFERENCES queries(id),
  reporter         TEXT NOT NULL REFERENCES reporters(pseudonym),
  amount_tinybars  BIGINT NOT NULL CHECK (amount_tinybars > 0),
  payout_id        UUID REFERENCES payouts(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (query_id, reporter)                          -- a query pays each reporter at most once
);
CREATE INDEX earnings_unpaid ON earnings (reporter) WHERE payout_id IS NULL;
