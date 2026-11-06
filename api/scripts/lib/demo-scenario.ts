/**
 * "A monsoon evening in Mumbai": the demo scenario, written straight to Arkiv as the
 * KneeDeep writer. Everything is labelled source=simulated (on Arkiv, in answers, on the
 * map). It goes around the API on purpose: staging and production refuse dev identities,
 * and simulated humans must never be able to pass as verified ones.
 *
 * Shaped around the dispatch agent's two routes (agent/src/routes.ts):
 *   S.V. Road via the subways   flooded (Khar ankle, Milan waist, Andheri knee)
 *   Western Express Highway     clear (dry at every checkpoint)
 */
import { createHash } from 'node:crypto';
import { ExpirationTime } from '@arkiv-network/sdk';
import { key as keyValue, u64 } from '@arkiv-network/sdk/schema';
import { Client } from 'pg';
import type { ArkivWalletClient } from '../../src/arkiv/client';
import { arkivExplorerTx } from '../../src/arkiv/client';
import { type Level, Reports, Votes } from '../../src/arkiv/schemas';
import { toCell } from '../../src/geo/geo';

interface SimReport {
  spot: string;
  lat: number;
  lng: number;
  level: Level;
  who: string;
  agoMin: number;
}

interface SimVote {
  /** Index into REPORTS. */
  report: number;
  vote: 'confirm' | 'dispute';
  who: string;
  agoMin: number;
}

const KHAR = { spot: 'Khar subway', lat: 19.0717, lng: 72.8406 };
const MILAN = { spot: 'Milan subway', lat: 19.0833, lng: 72.8427 };
const ANDHERI = { spot: 'Andheri subway', lat: 19.1197, lng: 72.8464 };
const KALANAGAR = { spot: 'Kalanagar junction', lat: 19.0606, lng: 72.8484 };
const VILE_PARLE = { spot: 'Vile Parle flyover', lat: 19.0996, lng: 72.8526 };
const ANDHERI_E = { spot: 'Andheri flyover (E)', lat: 19.1155, lng: 72.8551 };
const HINDMATA = { spot: 'Hindmata', lat: 19.0035, lng: 72.8423 };
const SION = { spot: 'Sion', lat: 19.039, lng: 72.8619 };

export const REPORTS: SimReport[] = [
  { ...KHAR, level: 'ankle', who: 'priya', agoMin: 35 },
  { ...KHAR, level: 'ankle', who: 'sameer', agoMin: 18 },
  { ...MILAN, level: 'waist', who: 'arjun', agoMin: 28 },
  { ...MILAN, level: 'waist', who: 'neha', agoMin: 12 },
  { ...ANDHERI, level: 'knee', who: 'asha', agoMin: 24 },
  { ...ANDHERI, level: 'knee', who: 'ravi', agoMin: 15 },
  { ...ANDHERI, level: 'knee', who: 'meera', agoMin: 9 },
  { ...KALANAGAR, level: 'dry', who: 'vikram', agoMin: 30 },
  { ...KALANAGAR, level: 'dry', who: 'anita', agoMin: 14 },
  { ...VILE_PARLE, level: 'dry', who: 'rahul', agoMin: 22 },
  { ...ANDHERI_E, level: 'dry', who: 'farah', agoMin: 26 },
  { ...ANDHERI_E, level: 'dry', who: 'joseph', agoMin: 10 },
  { ...HINDMATA, level: 'closed', who: 'lata', agoMin: 40 },
  { ...HINDMATA, level: 'closed', who: 'imran', agoMin: 20 },
  { ...SION, level: 'knee', who: 'deepak', agoMin: 16 },
];

export const VOTES: SimVote[] = [
  { report: 4, vote: 'confirm', who: 'kabir', agoMin: 5 }, // Andheri subway
  { report: 3, vote: 'confirm', who: 'zoya', agoMin: 6 }, // Milan subway
];

/** Simulated humans get a fixed, recognisable pseudonym; they are not World ID users. */
export const simPseudonym = (who: string) =>
  createHash('sha256').update(`kneedeep-simulated:${who}`).digest('hex');

/** Whole minutes, so the lifetime is always a whole number of Arkiv blocks. */
const lifetime = (seconds: number) =>
  ExpirationTime.fromSeconds(Math.max(120, Math.floor(seconds / 60) * 60));

export interface SeedResult {
  reports: number;
  votes: number;
  txs: string[];
}

/**
 * Write the scenario in two Arkiv transactions (reports, then votes on them). Each report
 * expires `ttlSeconds` after its (backdated) report time, as if it had been filed then.
 * Also mirrors the rows into Postgres so the map can link each report to its write tx.
 */
export async function seedMonsoonEvening(
  wallet: ArkivWalletClient,
  databaseUrl: string,
  ttlSeconds: number,
): Promise<SeedResult> {
  const now = Math.floor(Date.now() / 1000);
  const reportsTx = await wallet.executeBatch({
    creates: REPORTS.map((r) => ({
      schema: Reports,
      values: {
        level: r.level,
        cell: toCell(r.lat, r.lng),
        reportedAt: u64(now - r.agoMin * 60),
        reporter: simPseudonym(r.who),
        source: 'simulated',
      },
      expiration: lifetime(ttlSeconds - r.agoMin * 60),
    })),
  });
  const keys = reportsTx.createdEntities;

  const votesTx = await wallet.executeBatch({
    creates: VOTES.map((v) => {
      const r = REPORTS[v.report];
      return {
        schema: Votes,
        values: {
          report: keyValue(keys[v.report]),
          vote: v.vote,
          cell: toCell(r.lat, r.lng),
          votedAt: u64(now - v.agoMin * 60),
          voter: simPseudonym(v.who),
          source: 'simulated',
        },
        // Never outlive the report it is about.
        expiration: lifetime(ttlSeconds - r.agoMin * 60 - 60),
      };
    }),
  });

  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const people = [...new Set([...REPORTS.map((r) => r.who), ...VOTES.map((v) => v.who)])].map(simPseudonym);
    await db.query('INSERT INTO reporters (pseudonym) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING', [
      people,
    ]);
    for (const [i, r] of REPORTS.entries()) {
      await db.query(
        `INSERT INTO report_index (entity_key, reporter, cell, level, source, reported_at, expires_at, arkiv_tx, status)
         VALUES ($1, $2, $3, $4, 'simulated', to_timestamp($5), to_timestamp($6), $7, 'written')
         ON CONFLICT (entity_key) DO NOTHING`,
        [
          keys[i],
          simPseudonym(r.who),
          toCell(r.lat, r.lng),
          r.level,
          now - r.agoMin * 60,
          now - r.agoMin * 60 + ttlSeconds,
          reportsTx.txHash,
        ],
      );
    }
    for (const [i, v] of VOTES.entries()) {
      await db.query(
        `INSERT INTO vote_index (entity_key, report_key, voter, vote, status)
         VALUES ($1, $2, $3, $4, 'written') ON CONFLICT DO NOTHING`,
        [votesTx.createdEntities[i], keys[v.report], simPseudonym(v.who), v.vote],
      );
    }
  } finally {
    await db.end();
  }

  return {
    reports: keys.length,
    votes: votesTx.createdEntities.length,
    txs: [arkivExplorerTx(reportsTx.txHash), arkivExplorerTx(votesTx.txHash)],
  };
}
