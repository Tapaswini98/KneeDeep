# KneeDeep design decisions

KneeDeep answers one question for an AI agent: _is this road usable right now?_ The answer
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

When nothing fresh remains, the answer is `dataStatus: "empty"` with the notice _"Absence of
reports is not evidence of a dry road."_ No reports never means the road is dry.

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
   - Labels: `high` needs ≥ 0.7 _and_ ≥ 2 supporting humans; `medium` ≥ 0.4; otherwise `low`.

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
- **Corroboration:** confidence grows only with _independent_ humans.
- **Incentives:** only corroborated reports earn, so a lone false flood report earns nothing.
  Corroboration for pay must come from another _live_ verified human: simulated data can neither
  earn nor make a live report earn, and each human is credited once per paid query.
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

## 7. Paying reporters: batched and idempotent

70% (`REPORTER_SHARE_PERCENT`) of each paid query is credited, in the same database transaction
that marks the query paid, to the humans whose earning reports the answer used. Credits are
integers in tinybars, split equally; rounding dust stays with the platform.

Payouts go out in batches, one Hedera `TransferTransaction` per batch (platform debit plus up to 9
recipients, Hedera's 10-transfer limit), because one transfer per report would cost more in fees
than many reports earn. The batch id is the idempotency key:

1. A Postgres advisory lock lets only one run proceed (the API's schedule or `npm run payout`).
2. Any batch still in flight is resolved first, from the mirror node, by its transaction id:
   `SUCCESS` → settled; any other result, or not seen 180 s after submission (past the 120 s
   validity window, so it can never execute) → failed, and its earnings are released.
3. A new batch row, its pre-generated Hedera transaction id and the earnings it claims are
   committed **before** the transfer is sent. A unique index allows only one batch in flight.
4. Receipt `SUCCESS` → settled. A precheck or receipt failure is definite (no HBAR moved) →
   failed and released. Anything else (timeout) stays in flight for step 2 of the next run.

So an earning is in at most one batch, and no batch is ever paid twice.

## 8. The agent's route decision

Deterministic rules ([agent/src/decide.ts](../agent/src/decide.ts)) for a delivery scooter: dry is
clear, ankle-deep is slow, knee-deep or worse is impassable, contested or no data is unknown
(absence of reports is not evidence of a dry road). A route is as bad as its worst checkpoint.
The agent never picks an impassable route; among the rest it picks the lowest risk, then the
shortest, and holds the delivery if every route is impassable. Safety first: one unconfirmed
report of deep water is enough to avoid a route when there is an alternative, and its confidence
is always printed next to the decision. Spending is bounded twice: per query (the client refuses
to sign above `AGENT_MAX_TINYBARS_PER_QUERY`) and per trip (it prices the trip from the catalog
before paying anything).
