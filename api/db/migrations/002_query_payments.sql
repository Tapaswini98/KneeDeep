-- A query row is created when the handler builds an answer; x402 settles afterwards.
-- paid_at stays NULL if settlement fails, and unpaid queries never earn anyone anything.
ALTER TABLE queries
  ADD COLUMN network      TEXT,
  ADD COLUMN paid_at      TIMESTAMPTZ,
  ADD COLUMN data_status  TEXT NOT NULL DEFAULT 'stub'
                          CHECK (data_status IN ('stub', 'live', 'simulated', 'mixed', 'empty'));

CREATE INDEX queries_paid ON queries (paid_at DESC) WHERE paid_at IS NOT NULL;
