import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { arkivExplorerAddress, arkivExplorerEntity, arkivExplorerTx } from '../arkiv/client';
import { ArkivService } from '../arkiv/arkiv.service';
import { ArkivStore, LiveReport } from '../arkiv/arkiv.store';
import { Level, Source, Vote } from '../arkiv/schemas';
import { APP_CONFIG, AppConfig } from '../config/config';
import { DEFAULT_MAX_AGE_MIN } from '../fusion/fusion';
import { cellCenter, distanceMeters, prefixesCovering, toCell } from '../geo/geo';
import type { Reporter } from '../identity/sessions.service';
import { ReportsRepository } from './reports.repository';

/** Half the diagonal of a precision-7 geohash cell: a cell counts as "within r" if any of it might be. */
export const CELL_HALF_DIAGONAL_M = 110;

/** A vote must land before its report expires; refuse votes on reports with less than this left. */
const MIN_VOTE_WINDOW_S = 60;

/** Public reporter tag: a prefix of the pseudonym, enough to say "this one is yours". */
export const reporterTag = (pseudonym: string) => pseudonym.slice(0, 12);

/** Arkiv failures (RPC down, rate limit, rejected tx) surface as a readable 502, not a bare 500. */
function arkivWriteError(err: unknown): never {
  if (err instanceof HttpException) throw err;
  const e = err as { shortMessage?: string; message?: string };
  throw new BadGatewayException(`Could not write to Arkiv: ${(e.shortMessage ?? e.message ?? String(err)).split('\n')[0]}`);
}

@Injectable()
export class ReportsService {
  private readonly log = new Logger(ReportsService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly store: ArkivStore,
    private readonly arkiv: ArkivService,
    private readonly repo: ReportsRepository,
  ) {}

  /** Only World ID-verified humans produce live data. Everything else is labelled simulated, always. */
  private sourceFor(who: Reporter): Source {
    return who.method === 'world' ? 'live' : 'simulated';
  }

  async submit(input: { level: Level; lat: number; lng: number }, who: Reporter) {
    // Coarsen first: the raw coordinates go no further than this line.
    const cell = toCell(input.lat, input.lng);
    const reporter = who.pseudonym;
    const source = this.sourceFor(who);
    const reportedAt = new Date(Math.floor(Date.now() / 1000) * 1000);

    await this.repo.upsertReporter(reporter);
    const slot = await this.repo.reserveReport({
      reporter,
      cell,
      level: input.level,
      source,
      reportedAt,
      windowMinutes: this.config.REPORT_RATE_LIMIT_MINUTES,
    });
    if (!slot.ok) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: `You already reported this spot recently. Next report allowed at ${slot.nextAllowedAt.toISOString()}.`,
          nextAllowedAt: slot.nextAllowedAt.toISOString(),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    try {
      const ttl = this.config.REPORT_TTL_SECONDS;
      const written = await this.store.writeReport({
        level: input.level,
        cell,
        reportedAt: reportedAt.getTime() / 1000,
        reporter,
        source,
        ttlSeconds: ttl,
      });
      const expiresAt = new Date(reportedAt.getTime() + ttl * 1000);
      await this.repo.completeReport(slot.id, written.entityKey, written.txHash, expiresAt);
      this.log.log(`Report ${written.entityKey} (${input.level} at ${cell}, ${source})`);
      return {
        key: written.entityKey,
        level: input.level,
        cell,
        center: cellCenter(cell),
        source,
        reportedAt: reportedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        expiresAtBlock: written.expiresAtBlock.toString(),
        arkivTx: written.txHash,
        explorer: arkivExplorerTx(written.txHash),
      };
    } catch (err) {
      await this.repo.failReport(slot.id);
      arkivWriteError(err);
    }
  }

  async vote(reportKey: string, input: { vote: Vote; lat: number; lng: number }, who: Reporter) {
    const report = await this.store.getReport(reportKey);
    if (!report) throw new NotFoundException('No live report with that key (it may have expired)');

    const voter = who.pseudonym;
    if (voter === report.reporter) throw new ForbiddenException('You cannot vote on your own report');

    // A vote expires with its report; one written as the report expires would be rejected by Arkiv.
    const { currentBlock, blockSeconds } = await this.arkiv.blockTiming();
    const secondsLeft = Number(report.expiresAtBlock - currentBlock) * blockSeconds;
    if (secondsLeft < MIN_VOTE_WINDOW_S) {
      throw new GoneException('This report is about to expire, so it can no longer be voted on');
    }

    const distance = distanceMeters({ lat: input.lat, lng: input.lng }, cellCenter(report.cell));
    if (distance > this.config.VOTE_MAX_DISTANCE_M) {
      throw new ForbiddenException(
        `Only people within ${this.config.VOTE_MAX_DISTANCE_M} m can vote on a report (you are ${Math.round(distance)} m away)`,
      );
    }

    await this.repo.upsertReporter(voter);
    const slot = await this.repo.reserveVote({ reportKey, voter, vote: input.vote });
    if (!slot) throw new ConflictException('You already voted on this report');

    try {
      const votedAt = Math.floor(Date.now() / 1000);
      const source = this.sourceFor(who);
      const written = await this.store.writeVote({
        report: reportKey,
        reportExpiresAtBlock: report.expiresAtBlock,
        vote: input.vote,
        cell: report.cell,
        votedAt,
        voter,
        source,
      });
      await this.repo.completeVote(slot, written.entityKey);
      this.log.log(`Vote ${input.vote} on ${reportKey} (${source})`);
      return {
        key: written.entityKey,
        report: reportKey,
        vote: input.vote,
        source,
        votedAt: new Date(votedAt * 1000).toISOString(),
        arkivTx: written.txHash,
        explorer: arkivExplorerTx(written.txHash),
      };
    } catch (err) {
      await this.repo.failVote(slot);
      arkivWriteError(err);
    }
  }

  /** Free: raw live reports near a point, for the map and for voters. Fusion is what agents pay for. */
  async live(lat: number, lng: number, radiusM: number) {
    const [{ reports, votes, block }, timing] = await Promise.all([
      this.store.findInArea(prefixesCovering(lat, lng, radiusM)),
      this.arkiv.blockTiming(),
    ]);
    const now = Date.now() / 1000;
    const near = reports.filter(
      (r) =>
        now - r.reportedAt <= DEFAULT_MAX_AGE_MIN * 60 &&
        distanceMeters({ lat, lng }, cellCenter(r.cell)) <= radiusM + CELL_HALF_DIAGONAL_M,
    );
    const txs = await this.repo.arkivTxFor(near.map((r) => r.key));
    return {
      generatedAt: new Date().toISOString(),
      arkivBlock: block.toString(),
      writer: this.store.writer ?? null,
      writerExplorer: this.store.writer ? arkivExplorerAddress(this.store.writer) : null,
      reports: near
        .sort((a, b) => b.reportedAt - a.reportedAt)
        .map((r: LiveReport) => {
          const rv = votes.filter((v) => v.report === r.key);
          return {
            key: r.key,
            level: r.level,
            cell: r.cell,
            center: cellCenter(r.cell),
            source: r.source,
            reportedAt: new Date(r.reportedAt * 1000).toISOString(),
            ageMin: Math.round((now - r.reportedAt) / 6) / 10,
            confirmations: rv.filter((v) => v.vote === 'confirm').length,
            disputes: rv.filter((v) => v.vote === 'dispute').length,
            reporter: reporterTag(r.reporter),
            voters: rv.map((v) => ({ voter: reporterTag(v.voter), vote: v.vote })),
            expiresInMin: Math.max(0, Math.round((Number(r.expiresAtBlock - timing.currentBlock) * timing.blockSeconds) / 6) / 10),
            explorer: {
              entity: arkivExplorerEntity(r.key),
              tx: txs.get(r.key) ? arkivExplorerTx(txs.get(r.key)!) : null,
            },
          };
        }),
    };
  }
}
