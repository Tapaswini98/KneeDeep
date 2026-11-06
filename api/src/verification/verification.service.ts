import { Inject, Injectable, Logger } from '@nestjs/common';
import { ArkivStore } from '../arkiv/arkiv.store';
import { viem } from '../arkiv/viem';
import { LEVELS, type Level } from '../arkiv/vocabulary';
import { APP_CONFIG, AppConfig } from '../config/config';
import { fuse } from '../fusion/fusion';

/** Same bound as KneeDeepAttestations.MAX_FUTURE_SECONDS: the cron's next run can be minutes ahead. */
const MAX_FUTURE_SECONDS = 15 * 60;

/** KneeDeepAttestations.latest() (cre/contracts/src/KneeDeepAttestations.sol). */
const ABI = [
  {
    type: 'function',
    name: 'latest',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'asOf', type: 'uint64' },
          { name: 'arkivBlock', type: 'uint64' },
          { name: 'evidenceHash', type: 'bytes32' },
          { name: 'reports', type: 'uint32' },
          { name: 'votes', type: 'uint32' },
          {
            name: 'areas',
            type: 'tuple[]',
            components: [
              { name: 'cell', type: 'string' },
              { name: 'level', type: 'uint8' },
              { name: 'confidenceBps', type: 'uint16' },
              { name: 'supporters', type: 'uint16' },
              { name: 'reports', type: 'uint16' },
            ],
          },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'attestationCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const;

const CONTESTED = 255;
const CACHE_MS = 30_000;

export type VerificationStatus = 'match' | 'mismatch' | 'not-served';

export interface VerifiedArea {
  cell: string;
  /** What the independent CRE workflow computed from public Arkiv evidence. Null = contested. */
  attested: { level: Level | null; confidence: number; supporters: number; reports: number };
  /** What KneeDeep's server answers for the same area, recomputed as of the attestation time. */
  kneedeep: { level: Level | null; confidence: number } | null;
  /** match: same level; mismatch: different level; not-served: KneeDeep has no answer there. */
  status: VerificationStatus;
}

export interface Verification {
  enabled: true;
  contract: string;
  contractUrl: string;
  attestations: number;
  asOf: string;
  ageMin: number;
  arkivBlock: string;
  evidenceHash: string;
  reports: number;
  votes: number;
  summary: { areas: number; match: number; mismatch: number; notServed: number };
  areas: VerifiedArea[];
  note: string;
}

const levelOf = (n: number): Level | null => (n === CONTESTED ? null : (LEVELS[n] ?? null));

/**
 * Reads the latest independent attestation (Chainlink CRE, on Sepolia) and checks KneeDeep's own
 * answers against it. The workflow reads the same public evidence from Arkiv without going through
 * this server, so a server that altered its answers would show up here as mismatches.
 */
@Injectable()
export class VerificationService {
  private readonly log = new Logger(VerificationService.name);
  private cache?: { at: number; value: Verification | { enabled: false; reason: string } };

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly store: ArkivStore,
  ) {}

  get enabled(): boolean {
    return Boolean(this.config.CRE_ATTESTATIONS_ADDRESS);
  }

  async latest(): Promise<Verification | { enabled: false; reason: string }> {
    if (!this.enabled) return { enabled: false, reason: 'CRE_ATTESTATIONS_ADDRESS is not configured' };
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value;
    const value = await this.read();
    this.cache = { at: Date.now(), value };
    return value;
  }

  private async read(): Promise<Verification | { enabled: false; reason: string }> {
    const address = this.config.CRE_ATTESTATIONS_ADDRESS as `0x${string}`;
    const client = viem.createPublicClient({ transport: viem.http(this.config.CRE_CHAIN_RPC_URL) });
    const [count, a] = await Promise.all([
      client.readContract({ address, abi: ABI, functionName: 'attestationCount' }),
      client.readContract({ address, abi: ABI, functionName: 'latest' }),
    ]);
    if (count === 0n) return { enabled: false, reason: 'No attestation yet' };

    const asOf = Number(a.asOf);
    // The contract refuses these too; never show a future-dated attestation as verification.
    if (asOf > Date.now() / 1000 + MAX_FUTURE_SECONDS) {
      return { enabled: false, reason: 'The latest attestation is dated in the future; ignored' };
    }
    const cells = a.areas.map((x) => x.cell);
    // KneeDeep's own answer for the same areas, through this server's data path, at the same time.
    const ours = new Map<string, { level: Level | null; confidence: number }>();
    if (cells.length) {
      const { reports, votes } = await this.store.findInArea(cells);
      for (const answer of fuse(reports, votes, { now: asOf })) {
        ours.set(answer.cell, { level: answer.level, confidence: answer.confidence });
      }
    }

    const areas: VerifiedArea[] = a.areas.map((x) => {
      const attested = {
        level: levelOf(x.level),
        confidence: x.confidenceBps / 10_000,
        supporters: x.supporters,
        reports: x.reports,
      };
      const kneedeep = ours.get(x.cell) ?? null;
      const status: VerificationStatus = !kneedeep
        ? 'not-served'
        : kneedeep.level === attested.level
          ? 'match'
          : 'mismatch';
      return { cell: x.cell, attested, kneedeep, status };
    });
    const count_ = (s: VerificationStatus) => areas.filter((x) => x.status === s).length;
    if (count_('mismatch')) this.log.warn(`${count_('mismatch')} area(s) differ from the CRE attestation`);

    return {
      enabled: true,
      contract: address,
      contractUrl: `${this.config.CRE_EXPLORER_URL}/address/${address}`,
      attestations: Number(count),
      asOf: new Date(asOf * 1000).toISOString(),
      ageMin: Math.max(0, Math.round((Date.now() / 1000 - asOf) / 6) / 10),
      arkivBlock: a.arkivBlock.toString(),
      evidenceHash: a.evidenceHash,
      reports: a.reports,
      votes: a.votes,
      summary: {
        areas: areas.length,
        match: count_('match'),
        mismatch: count_('mismatch'),
        notServed: count_('not-served'),
      },
      areas,
      note: 'Chainlink CRE nodes recomputed these areas from public Arkiv evidence and agreed on the result. Consensus proves what the evidence says, not that the human reports are true.',
    };
  }
}
