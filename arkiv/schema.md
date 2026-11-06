# Arkiv schema

KneeDeep writes two entity types to Arkiv (Rabdi testnet). The source of truth is
[`api/src/arkiv/schemas.ts`](../api/src/arkiv/schemas.ts).

Every entity is owned by the KneeDeep writer wallet. Queries filter on that owner
(`ownedBy`), so entities written by anyone else are ignored.

## `kneedeep.report.v1`: one street-level observation

| Attribute    | Type | Indexed | Meaning                                                                  |
| ------------ | ---- | ------- | ------------------------------------------------------------------------ |
| `level`      | str  | yes     | `dry`, `ankle`, `knee`, `waist` or `closed`                              |
| `cell`       | str  | yes     | Geohash, precision 7 (about 150 m). No raw GPS is stored.                |
| `reportedAt` | u64  | yes     | Unix seconds                                                             |
| `reporter`   | str  | yes     | `sha256(salt ‖ World ID nullifier)`. The nullifier is never stored.      |
| `source`     | str  | yes     | `live` or `simulated`. Simulated (demo) data is never presented as live. |

Expiry: 3 hours (`REPORT_TTL_SECONDS`). Street conditions have a half-life, so once a
report expires it is gone from Arkiv.

## `kneedeep.vote.v1`: a confirmation or dispute of a report

| Attribute | Type | Indexed | Meaning                                                 |
| --------- | ---- | ------- | ------------------------------------------------------- |
| `report`  | key  | yes     | Entity key of the report being voted on                 |
| `vote`    | str  | yes     | `confirm` or `dispute`                                  |
| `cell`    | str  | yes     | The report's cell, so one query fetches an area's votes |
| `votedAt` | u64  | yes     | Unix seconds                                            |
| `voter`   | str  | yes     | Voter pseudonym (same scheme as `reporter`)             |
| `source`  | str  | yes     | `live` or `simulated`                                   |

Expiry: no later than the report it refers to.

## Area queries

A query for `lat, lng, radius` becomes a set of geohash prefixes (the cell that covers
the radius plus its 8 neighbours). One `startsWith('cell', prefix)` query runs per prefix.
