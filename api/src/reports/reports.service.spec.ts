import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import type { ArkivService } from '../arkiv/arkiv.service';
import type { ArkivStore, LiveReport } from '../arkiv/arkiv.store';
import type { AppConfig } from '../config/config';
import type { Reporter } from '../identity/sessions.service';
import type { ReportsRepository } from './reports.repository';
import { ReportsService } from './reports.service';

const ANDHERI = { lat: 19.1197, lng: 72.8464 };
const KEY = '0x' + '1'.repeat(64);
const config = {
  REPORT_TTL_SECONDS: 10_800,
  REPORT_RATE_LIMIT_MINUTES: 30,
  VOTE_MAX_DISTANCE_M: 1_000,
} as AppConfig;

const alice: Reporter = { pseudonym: 'a'.repeat(64), method: 'world' };
const bob: Reporter = { pseudonym: 'b'.repeat(64), method: 'world' };
const dev: Reporter = { pseudonym: 'd'.repeat(64), method: 'dev' };

const report: LiveReport = {
  key: KEY,
  cell: 'te7uc8t',
  level: 'knee',
  reportedAt: 1_800_000_000,
  reporter: alice.pseudonym,
  source: 'live',
  expiresAtBlock: 1_000n,
};

function setup(opts: { secondsLeft?: number; report?: LiveReport | null } = {}) {
  const store = {
    getReport: jest.fn().mockResolvedValue(opts.report === undefined ? report : opts.report),
    writeReport: jest.fn().mockResolvedValue({ entityKey: KEY, txHash: '0xtx', expiresAtBlock: 5_000n }),
    writeVote: jest.fn().mockResolvedValue({ entityKey: '0xvote', txHash: '0xvtx', expiresAtBlock: 1_000n }),
  };
  const blocksLeft = BigInt(Math.floor((opts.secondsLeft ?? 3_600) / 2));
  const arkiv = {
    blockTiming: jest.fn().mockResolvedValue({ currentBlock: 1_000n - blocksLeft, blockSeconds: 2 }),
  };
  const repo = {
    upsertReporter: jest.fn(),
    reserveReport: jest.fn().mockResolvedValue({ ok: true, id: '1' }),
    completeReport: jest.fn(),
    failReport: jest.fn(),
    reserveVote: jest.fn().mockResolvedValue('7'),
    completeVote: jest.fn(),
    failVote: jest.fn(),
  };
  const service = new ReportsService(
    config,
    store as unknown as ArkivStore,
    arkiv as unknown as ArkivService,
    repo as unknown as ReportsRepository,
  );
  return { service, store, repo };
}

describe('ReportsService.submit', () => {
  it('stores only the ~150 m cell, never the raw coordinates', async () => {
    const { service, store } = setup();
    const res = await service.submit({ level: 'knee', lat: 19.11973, lng: 72.84641 }, alice);
    const written = store.writeReport.mock.calls[0][0];
    expect(written.cell).toBe('te7uc8t');
    expect(JSON.stringify(written)).not.toContain('19.1197');
    expect(res.source).toBe('live');
  });

  it('labels anything from a dev identity as simulated', async () => {
    const { service, store } = setup();
    await service.submit({ level: 'knee', ...ANDHERI }, dev);
    expect(store.writeReport.mock.calls[0][0].source).toBe('simulated');
  });

  it('answers 429 inside the rate-limit window and writes nothing', async () => {
    const { service, store, repo } = setup();
    repo.reserveReport.mockResolvedValue({ ok: false, nextAllowedAt: new Date() });
    await expect(service.submit({ level: 'knee', ...ANDHERI }, alice)).rejects.toMatchObject({ status: 429 });
    expect(store.writeReport).not.toHaveBeenCalled();
  });

  it('frees the slot and returns a readable 502 when Arkiv fails', async () => {
    const { service, store, repo } = setup();
    store.writeReport.mockRejectedValue(new Error('nonce too low\nraw RPC details'));
    const err = await service.submit({ level: 'knee', ...ANDHERI }, alice).catch((e) => e);
    expect(err).toBeInstanceOf(BadGatewayException);
    expect((err as HttpException).message).toBe('Could not write to Arkiv: nonce too low');
    expect(repo.failReport).toHaveBeenCalledWith('1');
  });
});

describe('ReportsService.vote', () => {
  const confirm = { vote: 'confirm' as const, ...ANDHERI };

  it('records a vote from a nearby human, expiring with the report', async () => {
    const { service, store, repo } = setup();
    await service.vote(KEY, confirm, bob);
    expect(store.writeVote.mock.calls[0][0]).toMatchObject({
      report: KEY,
      reportExpiresAtBlock: 1_000n,
      voter: bob.pseudonym,
    });
    expect(repo.completeVote).toHaveBeenCalledWith('7', '0xvote');
  });

  it.each<[string, Parameters<typeof setup>[0], Reporter, typeof confirm, new (...a: never[]) => Error]>([
    ['an unknown or expired report', { report: null }, bob, confirm, NotFoundException],
    ['your own report', {}, alice, confirm, ForbiddenException],
    ['a report about to expire', { secondsLeft: 30 }, bob, confirm, GoneException],
    [
      'a report more than 1 km away',
      {},
      bob,
      { vote: 'confirm', lat: 19.0544, lng: 72.8406 },
      ForbiddenException,
    ],
  ])('refuses a vote on %s without writing', async (_name, opts, who, input, type) => {
    const { service, store } = setup(opts);
    await expect(service.vote(KEY, input, who)).rejects.toBeInstanceOf(type);
    expect(store.writeVote).not.toHaveBeenCalled();
  });

  it('refuses a second vote by the same human', async () => {
    const { service, store, repo } = setup();
    repo.reserveVote.mockResolvedValue(null);
    await expect(service.vote(KEY, confirm, bob)).rejects.toBeInstanceOf(ConflictException);
    expect(store.writeVote).not.toHaveBeenCalled();
  });
});
