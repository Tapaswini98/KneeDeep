-- Reporter payouts.
--
-- Money flow: an agent pays for a query (x402) -> when settlement succeeds, REPORTER_SHARE_PERCENT
-- of that payment is credited as `earnings` to the human reporters whose corroborated, live
-- reports the answer used -> a payout batch sends everyone's unpaid earnings in ONE Hedera
-- transfer. The batch id is the idempotency key: it is written, with the Hedera transaction id,
-- before anything is sent, so a crash or retry can always tell whether that transfer happened.

-- Whether a report used in an answer earns: live (never simulated) and corroborated by another
-- live human. `corroborated` (already here) is the looser, public notion shown in answers.
ALTER TABLE query_reports ADD COLUMN earns BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE payouts
  ADD COLUMN network       TEXT,
  ADD COLUMN memo          TEXT,
  ADD COLUMN error         TEXT,
  ADD COLUMN submitted_at  TIMESTAMPTZ;

-- At most one batch in flight: a new batch waits until the previous one is settled or failed.
CREATE UNIQUE INDEX payouts_one_in_flight ON payouts ((true)) WHERE status IN ('pending', 'submitted');

-- What each Hedera account received in a batch (accounts can change later; this is what was sent).
CREATE TABLE payout_transfers (
  payout_id        UUID NOT NULL REFERENCES payouts(id),
  account_id       TEXT NOT NULL,
  amount_tinybars  BIGINT NOT NULL CHECK (amount_tinybars > 0),
  PRIMARY KEY (payout_id, account_id)
);

CREATE INDEX earnings_by_payout ON earnings (payout_id) WHERE payout_id IS NOT NULL;
