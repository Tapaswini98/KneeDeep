/**
 * Independent recomputation of KneeDeep's answers from public evidence.
 *
 * Reads raw report and vote entities from Arkiv's public JSON-RPC (no KneeDeep server involved),
 * and runs the very same fusion engine KneeDeep runs (api/src/fusion/fusion.ts, imported, not
 * copied). Pure functions only: the CRE workflow wires them to HTTP and consensus.
 */
import { keccak256, toBytes, type Hex } from 'viem';
import { fuse, type ReportInput, type VoteInput } from '../../api/src/fusion/fusion';
import { LEVELS, SOURCES, VOTES, type Level } from '../../api/src/arkiv/vocabulary';

/** One entity as `arkiv_query` returns it. */
export interface RpcEntity {
  key: string;
  expiresAt?: string;
  attributes: { name: string; type: string; value: string }[];
}

export interface RpcQueryResult {
  data: RpcEntity[];
  blockNumber: string;
}

/** Arkiv's query engine returns at most 100 entities per page. */
export const PAGE_SIZE = 100;

/** Contested areas (disputes outweigh every report) have no level; on chain they are 255. */
export const CONTESTED = 255;

export const reportsQuery = (writer: string) =>
  `arkiv.schema = str('kneedeep.report.v1') AND $owner = addr(${writer})`;

export const votesQuery = (writer: string) =>
  `arkiv.schema = str('kneedeep.vote.v1') AND $owner = addr(${writer})`;

const REPORT_FIELDS = ['level', 'cell', 'reportedAt', 'reporter', 'source'];
const VOTE_FIELDS = ['report', 'vote', 'cell', 'votedAt', 'voter', 'source'];

/** The JSON-RPC body for one page of a query, exactly as the Arkiv SDK sends it. */
export function queryBody(query: string, fields: string[], offset: number): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'arkiv_query',
    params: [
      query,
      {
        select: { key: true, expiresAt: true, attributes: Object.fromEntries(fields.map((f) => [f, true])) },
        limit: `0x${PAGE_SIZE.toString(16)}`,
        ...(offset > 0 && { offset: `0x${offset.toString(16)}` }),
      },
    ],
  });
}

export const reportsBody = (writer: string, offset: number) =>
  queryBody(reportsQuery(writer), REPORT_FIELDS, offset);
export const votesBody = (writer: string, offset: number) =>
  queryBody(votesQuery(writer), VOTE_FIELDS, offset);

function attrs(e: RpcEntity): Record<string, string> {
  return Object.fromEntries(e.attributes.map((a) => [a.name, a.value]));
}

/** u64 attributes arrive hex-encoded ("0x6aede38f"). */
const u64 = (v: string | undefined) => (v === undefined ? Number.NaN : Number(BigInt(v)));

/** A report entity, or null if it does not look like one (malformed data is skipped, not trusted). */
export function toReport(e: RpcEntity): ReportInput | null {
  const a = attrs(e);
  const reportedAt = u64(a.reportedAt);
  if (
    !(LEVELS as readonly string[]).includes(a.level) ||
    !(SOURCES as readonly string[]).includes(a.source) ||
    !a.cell ||
    !a.reporter ||
    !Number.isFinite(reportedAt)
  ) {
    return null;
  }
  return {
    key: e.key.toLowerCase(),
    cell: a.cell,
    level: a.level as Level,
    reportedAt,
    reporter: a.reporter,
    source: a.source as ReportInput['source'],
  };
}

export function toVote(e: RpcEntity): VoteInput | null {
  const a = attrs(e);
  const votedAt = u64(a.votedAt);
  if (
    !(VOTES as readonly string[]).includes(a.vote) ||
    !(SOURCES as readonly string[]).includes(a.source) ||
    !a.report ||
    !a.voter ||
    !Number.isFinite(votedAt)
  ) {
    return null;
  }
  return {
    report: a.report.toLowerCase(),
    vote: a.vote as VoteInput['vote'],
    voter: a.voter,
    votedAt,
    source: a.source as VoteInput['source'],
  };
}

/** What the workflow attests for one ~150 m area. */
export interface AttestedArea {
  cell: string;
  /** 0 dry, 1 ankle, 2 knee, 3 waist, 4 closed; 255 contested. */
  level: number;
  /** Confidence in basis points (0.83 -> 8300). */
  confidenceBps: number;
  /** Independent humans supporting the level. */
  supporters: number;
  /** Reports considered in this area (one per human). */
  reports: number;
}

export interface Verdict {
  /** Unix seconds the answer is computed for (the cron trigger's scheduled time). */
  asOf: number;
  /** Arkiv block the evidence was read at. */
  arkivBlock: number;
  /** keccak256 over the sorted entity keys used: exactly which evidence this verdict rests on. */
  evidenceHash: Hex;
  reports: number;
  votes: number;
  areas: AttestedArea[];
}

/** Recompute every area from the evidence, as KneeDeep's paid answers do. Deterministic. */
export function computeVerdict(
  reports: ReportInput[],
  votes: VoteInput[],
  opts: { asOf: number; arkivBlock: number; maxAreas: number },
): Verdict {
  const answers = fuse(reports, votes, { now: opts.asOf });
  const severity = (level: Level | null) => (level === null ? LEVELS.length : LEVELS.indexOf(level));
  const areas = answers
    // Worst first (contested counts as worst: unknown is not safe), then most confident, then by cell.
    .sort(
      (x, y) =>
        severity(y.level) - severity(x.level) ||
        y.confidence - x.confidence ||
        (x.cell < y.cell ? -1 : x.cell > y.cell ? 1 : 0),
    )
    .slice(0, opts.maxAreas)
    .map((a) => ({
      cell: a.cell,
      level: a.level === null ? CONTESTED : LEVELS.indexOf(a.level),
      confidenceBps: Math.round(a.confidence * 10_000),
      supporters: a.inputs.supportingHumans,
      reports: a.inputs.reports,
    }));

  const keys = [...reports.map((r) => `r:${r.key}`), ...votes.map((v) => `v:${v.report}:${v.voter}`)].sort();
  return {
    asOf: opts.asOf,
    arkivBlock: opts.arkivBlock,
    evidenceHash: keccak256(toBytes(keys.join(','))),
    reports: reports.length,
    votes: votes.length,
    areas,
  };
}

export const levelName = (level: number) =>
  level === CONTESTED ? 'contested' : (LEVELS[level] ?? `level ${level}`);
