/**
 * The shared vocabulary of reports and votes. Plain constants with no dependencies, so the fusion
 * engine can run anywhere: in the API, and inside the Chainlink CRE workflow that independently
 * recomputes KneeDeep's answers (cre/kneedeep-verify).
 */

/** Water level a reporter saw, in increasing severity. */
export const LEVELS = ['dry', 'ankle', 'knee', 'waist', 'closed'] as const;
export type Level = (typeof LEVELS)[number];

/** 'simulated' marks demo data. The API never presents it as live. */
export const SOURCES = ['live', 'simulated'] as const;
export type Source = (typeof SOURCES)[number];

export const VOTES = ['confirm', 'dispute'] as const;
export type Vote = (typeof VOTES)[number];
