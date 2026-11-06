import { defineSchema, key, str, u64 } from '@arkiv-network/sdk/schema';

export { LEVELS, type Level, SOURCES, type Source, VOTES, type Vote } from './vocabulary';

/**
 * One street-level observation. Public, readable by anyone, and gone when it expires.
 * Deliberately absent: raw GPS (only the ~150 m cell) and the World ID nullifier
 * (only a salted-hash pseudonym).
 */
export const Reports = defineSchema('kneedeep.report.v1', {
  level: str().indexed(),
  cell: str().indexed(), // geohash, precision 7
  reportedAt: u64().indexed(), // unix seconds
  reporter: str().indexed(), // sha256(salt || nullifier), hex
  source: str().indexed(),
});

/** A nearby human confirming or disputing a report. Expires with the report it is about. */
export const Votes = defineSchema('kneedeep.vote.v1', {
  report: key().indexed(), // entity key of the report
  vote: str().indexed(),
  cell: str().indexed(),
  votedAt: u64().indexed(),
  voter: str().indexed(),
  source: str().indexed(),
});
