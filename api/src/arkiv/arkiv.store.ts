import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ExpirationTime, NoEntityFoundError } from '@arkiv-network/sdk';
import { and, asc, gt, or, startsWith } from '@arkiv-network/sdk/query';
import { key as keyValue, u64 } from '@arkiv-network/sdk/schema';
import type { ReportInput, VoteInput } from '../fusion/fusion';
import { ArkivService } from './arkiv.service';
import { Level, Reports, Source, Vote, Votes } from './schemas';

export interface WriteResult {
  entityKey: string;
  txHash: string;
  /** Block height at which Arkiv deletes the entity. */
  expiresAtBlock: bigint;
}

export interface LiveReport extends ReportInput {
  expiresAtBlock: bigint;
}

/** Pages of 100; enough for a 2 km radius on the worst monsoon night, bounded so a query stays fast. */
const MAX_PAGES = 5;

/**
 * Typed reads and writes of KneeDeep entities on Arkiv. Every read filters on our
 * writer address, so entities anyone else writes under the same schema name are ignored.
 */
@Injectable()
export class ArkivStore {
  private readonly log = new Logger(ArkivStore.name);
  /** One wallet signs every write; serialise them so concurrent requests don't reuse a nonce. */
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly arkiv: ArkivService) {}

  /** Address that owns every KneeDeep entity; anyone can query Arkiv for its entities directly. */
  get writer(): `0x${string}` | undefined {
    return this.arkiv.writerAddress;
  }

  private owner(): `0x${string}` {
    const owner = this.arkiv.writerAddress;
    if (!owner)
      throw new ServiceUnavailableException('Arkiv is not configured: ARKIV_PRIVATE_KEY is not set');
    return owner;
  }

  private serialised<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writeQueue.then(fn, fn);
    this.writeQueue = run.catch(() => undefined);
    return run;
  }

  writeReport(r: {
    level: Level;
    cell: string;
    reportedAt: number;
    reporter: string;
    source: Source;
    ttlSeconds: number;
  }): Promise<WriteResult> {
    return this.serialised(async () => {
      const res = await this.arkiv.wallet.createEntity(
        Reports,
        {
          level: r.level,
          cell: r.cell,
          reportedAt: u64(r.reportedAt),
          reporter: r.reporter,
          source: r.source,
        },
        { expiration: ExpirationTime.fromSeconds(r.ttlSeconds) },
      );
      return { entityKey: res.entityKey, txHash: res.txHash, expiresAtBlock: BigInt(res.expiresAt) };
    });
  }

  /** A vote expires together with the report it is about. */
  writeVote(v: {
    report: string;
    reportExpiresAtBlock: bigint;
    vote: Vote;
    cell: string;
    votedAt: number;
    voter: string;
    source: Source;
  }): Promise<WriteResult> {
    return this.serialised(async () => {
      const res = await this.arkiv.wallet.createEntity(
        Votes,
        {
          report: keyValue(v.report as `0x${string}`),
          vote: v.vote,
          cell: v.cell,
          votedAt: u64(v.votedAt),
          voter: v.voter,
          source: v.source,
        },
        { expiration: ExpirationTime.atBlock(v.reportExpiresAtBlock) },
      );
      return { entityKey: res.entityKey, txHash: res.txHash, expiresAtBlock: BigInt(res.expiresAt) };
    });
  }

  /** A live report we wrote, or null if it never existed, expired, or was written by someone else. */
  async getReport(entityKey: string): Promise<LiveReport | null> {
    try {
      const row = await this.arkiv.reader.getEntity(entityKey as `0x${string}`, Reports);
      if (row.$owner.toLowerCase() !== this.owner().toLowerCase()) return null;
      return {
        key: row.$key,
        cell: row.cell.value,
        level: row.level.value as Level,
        reportedAt: Number(row.reportedAt.value),
        reporter: row.reporter.value,
        source: row.source.value as Source,
        expiresAtBlock: BigInt(row.$expiresAt),
      };
    } catch (err) {
      if (err instanceof NoEntityFoundError) return null;
      throw err;
    }
  }

  /** Live reports and votes whose cell starts with any of the prefixes. */
  async findInArea(
    prefixes: string[],
  ): Promise<{ reports: LiveReport[]; votes: VoteInput[]; block: bigint }> {
    const owner = this.owner();
    const inArea = or(prefixes.map((p) => startsWith('cell', p)));

    const reports: LiveReport[] = [];
    let block = 0n;
    let after: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await this.arkiv.reader
        .select({
          $key: true,
          $expiresAt: true,
          level: true,
          cell: true,
          reportedAt: true,
          reporter: true,
          source: true,
        })
        .from(Reports)
        .where(after ? and(inArea, gt('$key', keyValue(after as `0x${string}`))) : inArea)
        .ownedBy(owner)
        .orderBy(asc('$key'))
        .limit(100)
        .fetch();
      block = res.blockNumber;
      for (const e of res.entities) {
        reports.push({
          key: e.$key,
          cell: e.cell.value,
          level: e.level.value as Level,
          reportedAt: Number(e.reportedAt.value),
          reporter: e.reporter.value,
          source: e.source.value as Source,
          expiresAtBlock: BigInt(e.$expiresAt),
        });
      }
      if (res.entities.length + res.skipped < 100) break;
      after = res.entities.at(-1)?.$key;
      if (!after) break;
      if (page === MAX_PAGES - 1) this.log.warn(`Report query truncated at ${MAX_PAGES * 100} entities`);
    }

    const votes: VoteInput[] = [];
    after = undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await this.arkiv.reader
        .select({ $key: true, report: true, vote: true, votedAt: true, voter: true, source: true })
        .from(Votes)
        .where(after ? and(inArea, gt('$key', keyValue(after as `0x${string}`))) : inArea)
        .ownedBy(owner)
        .orderBy(asc('$key'))
        .limit(100)
        .fetch();
      for (const e of res.entities) {
        votes.push({
          report: e.report.value,
          vote: e.vote.value as Vote,
          voter: e.voter.value,
          votedAt: Number(e.votedAt.value),
          source: e.source.value as Source,
        });
      }
      if (res.entities.length + res.skipped < 100) break;
      after = res.entities.at(-1)?.$key;
      if (!after) break;
    }

    return { reports, votes, block };
  }
}
