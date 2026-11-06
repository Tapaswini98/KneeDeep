-- What each paid answer said, per area, so the dashboard can show agent decisions.
ALTER TABLE queries ADD COLUMN summary JSONB NOT NULL DEFAULT '[]';
