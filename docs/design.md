# KneeDeep design decisions

KneeDeep answers one question for an AI agent: *is this road usable right now?* The answer
comes from recent reports by verified humans, never from a model. This document explains the
choices behind that answer.

## 1. Street truth expires

Stale data is worse than no data, because agents act on it. So expiry belongs to the data
layer, not to a cleanup job:

- Every report is an Arkiv entity created with a lifetime (`REPORT_TTL_SECONDS`, 3 hours).
  When it expires, Arkiv deletes it. Nothing has to remember to clean it up.
- A vote is written to expire at the same block as the report it is about, so a vote can
  never outlive its report.
- The fusion engine also ignores anything older than 180 minutes, in case the TTL setting is
  ever raised by mistake.
- Every answer shows the age of its evidence: the newest and oldest report, in minutes.

When nothing fresh remains, the answer is `dataStatus: "empty"` with the notice *"Absence of
reports is not evidence of a dry road."* No reports never means the road is dry.

## 2. Confidence you can explain

The engine is in `api/src/fusion/fusion.ts` and is deterministic. For each ~150 m cell:

1. **Freshness filter.** Reports and votes older than 180 min, or dated in the future, are dropped.
2. **One voice per human.** Each reporter's latest report counts once. Votes on your own
   report are ignored. Each human gets one vote per report.
3. **Recency weight.** `w = 0.5 ^ (age_min / 45)`, so evidence loses half its weight every 45 minutes.
4. **Level.** `score(level) = Σ w(reports at that level) + Σ w(confirmations) − Σ w(disputes)`.
   The highest score wins. Ties go to the **more severe** level, because routing is safety
   critical. If disputes outweigh every level, the cell is **contested** (`level: null`) and
   agents must treat it as unknown.
5. **Confidence** = `corroboration × agreement × freshness`
   - `corroboration = 1 − 0.5^n`, where `n` is the number of distinct humans supporting the
     level (1 → 0.5, 2 → 0.75, 3 → 0.875). **A single human can never reach "high".**
   - `agreement = support / (support + against)`. Contradicting reports and disputes reduce it.
   - `freshness = 0.5 + 0.5 × w(newest supporting evidence)`.
   - Labels: `high` needs ≥ 0.7 *and* ≥ 2 supporting humans; `medium` ≥ 0.4; otherwise `low`.

Every area in the paid answer carries the score's inputs (`supportingHumans`, `reports`,
`contradictingReports`, `confirmations`, `disputes`, `newestAgeMin`, `oldestAgeMin`) and a
plain sentence, for example:

> 3 independent humans report knee-deep water; newest 12 min ago, oldest 25 min ago; 1 dispute.

The engine has 17 unit tests (`fusion.spec.ts`) covering recency, corroboration, contradiction,
disputes, contested cells and source labelling.

## 3. Uniqueness is not truth

World ID proves that a report comes from a unique human. It cannot prove the report is true.
KneeDeep handles this in layers:

- **Sybil resistance:** one person cannot pose as many (World ID nullifier → pseudonym).
- **Rate limit:** one report per human per cell per 30 minutes. A Postgres reservation row
  and an advisory lock make this race-free even though Arkiv writes take seconds.
- **Corroboration:** confidence grows only with *independent* humans.
- **Incentives:** only corroborated reports earn, so a lone false flood report earns nothing.
- **Locality:** only people within 1 km of a report can confirm or dispute it.

Honest limitation: a verified human can still lie once. Reporter reputation is future work.

## 4. Simulated data is always labelled

Until World ID verification is enabled (`REPORTER_VERIFIER=world`), reports come through a
dev verifier. Anything it admits is written with `source: "simulated"`, on Arkiv and in every
answer. An answer reports `dataStatus` as `live`, `simulated`, `mixed` or `empty`, and adds a
notice whenever any simulated data is included.

## 5. Privacy

- Raw GPS is converted to a geohash cell (precision 7, ~150 m) on the server, and the raw
  coordinates are never stored or published.
- The public reporter ID is `sha256(salt ":" nullifier)`. The nullifier is never stored.

## 6. Why Arkiv rather than Postgres for reports

Reports are a public good: any agent can read them from Arkiv without asking KneeDeep (filter
on the writer address). Their expiry is native rather than a cron job. Postgres keeps only what
must be private or transactional: rate limits, which reports each paid query used, earnings and
payouts.

Trade-off: the backend writes to Arkiv on reporters' behalf, which is simpler for the MVP, but
reporters don't own their entries.
