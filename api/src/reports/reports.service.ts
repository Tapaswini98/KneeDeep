import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { arkivExplorerTx } from '../arkiv/client';
import { ArkivStore, LiveReport } from '../arkiv/arkiv.store';
import { Level, Source, Vote } from '../arkiv/schemas';
import { APP_CONFIG, AppConfig } from '../config/config';
import { DEFAULT_MAX_AGE_MIN } from '../fusion/fusion';
import { cellCenter, distanceMeters, prefixesCovering, toCell } from '../geo/geo';
import { HUMAN_VERIFIER, HumanVerifier, pseudonymFor, VerifiedHuman } from '../identity/human-verifier';
import { ReportsRepository } from './reports.repository';

/** Half the diagonal of a precision-7 geohash cell: a cell counts as "within r" if any of it might be. */
export const CELL_HALF_DIAGONAL_M = 110;

@Injectable()
export class ReportsService {
  private readonly log = new Logger(ReportsService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(HUMAN_VERIFIER) private readonly verifier: HumanVerifier,
    private readonly store: ArkivStore,
    private readonly repo: ReportsRepository,
  ) {}

  private pseudonym(human: VerifiedHuman): string {
    const salt = this.config.PSEUDONYM_SALT;
    if (!salt) throw new ServiceUnavailableException('PSEUDONYM_SALT is not set');
    return pseudonymFor(salt, human.nullifier);
  }

  /** Only proof-of-human submissions are live. Everything else is labelled simulated, always. */
  private sourceFor(human: VerifiedHuman): Source {
    return human.method === 'world' ? 'live' : 'simulated';
  }

  async submit(input: { level: Level; lat: number; lng: number; proof?: unknown }) {
    // Coarsen first: the raw coordinates go no further than this line.
    const cell = toCell(input.lat, input.lng);
    const human = await this.verifier.verify(input.proof, { purpose: 'report', signal: `report:${input.level}:${cell}` });
    const reporter = this.pseudonym(human);
    const source = this.sourceFor(human);
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
      throw err;
    }
  }

  async vote(reportKey: string, input: { vote: Vote; lat: number; lng: number; proof?: unknown }) {
    const report = await this.store.getReport(reportKey);
    if (!report) throw new NotFoundException('No live report with that key (it may have expired)');

    const human = await this.verifier.verify(input.proof, { purpose: 'vote', signal: `vote:${reportKey}:${input.vote}` });
    const voter = this.pseudonym(human);
    if (voter === report.reporter) throw new ForbiddenException('You cannot vote on your own report');

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
      const source = this.sourceFor(human);
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
      throw err;
    }
  }

  /** Free: raw live reports near a point, for the map and for voters. Fusion is what agents pay for. */
  async live(lat: number, lng: number, radiusM: number) {
    const { reports, votes, block } = await this.store.findInArea(prefixesCovering(lat, lng, radiusM));
    const now = Date.now() / 1000;
    const near = reports.filter(
      (r) =>
        now - r.reportedAt <= DEFAULT_MAX_AGE_MIN * 60 &&
        distanceMeters({ lat, lng }, cellCenter(r.cell)) <= radiusM + CELL_HALF_DIAGONAL_M,
    );
    return {
      generatedAt: new Date().toISOString(),
      arkivBlock: block.toString(),
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
          };
        }),
    };
  }
}
