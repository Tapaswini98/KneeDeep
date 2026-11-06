-- Arkiv writes take seconds. To make "one report per human per cell per 30 min" and
-- "one vote per human per report" race-free, we reserve a row first (status 'pending'),
-- write to Arkiv, then fill in the entity key. A failed write frees the slot.

ALTER TABLE report_index DROP CONSTRAINT report_index_pkey;
ALTER TABLE report_index ADD COLUMN id BIGSERIAL PRIMARY KEY;
ALTER TABLE report_index ALTER COLUMN entity_key DROP NOT NULL;
ALTER TABLE report_index ADD CONSTRAINT report_index_entity_key_key UNIQUE (entity_key);
ALTER TABLE report_index
  ADD COLUMN status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'written', 'failed'));
ALTER TABLE report_index ALTER COLUMN expires_at DROP NOT NULL;

ALTER TABLE vote_index DROP CONSTRAINT vote_index_pkey;
ALTER TABLE vote_index ADD COLUMN id BIGSERIAL PRIMARY KEY;
ALTER TABLE vote_index ALTER COLUMN entity_key DROP NOT NULL;
ALTER TABLE vote_index ADD CONSTRAINT vote_index_entity_key_key UNIQUE (entity_key);
ALTER TABLE vote_index
  ADD COLUMN status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'written', 'failed'));
-- A failed vote must not block a retry: uniqueness only among non-failed votes.
ALTER TABLE vote_index DROP CONSTRAINT vote_index_report_key_voter_key;
CREATE UNIQUE INDEX vote_index_one_per_human ON vote_index (report_key, voter) WHERE status <> 'failed';
