import { describe, expect, it } from 'bun:test';
import { decodeAbiParameters } from 'viem';
import { ATTESTATION_ABI, encodeAttestation } from './attestation';
import { CONTESTED, computeVerdict, queryBody, type RpcEntity, toReport, toVote } from './evidence';

const NOW = 1_800_000_000;
const hex = (n: number) => `0x${n.toString(16)}`;

const report = (
  key: string,
  reporter: string,
  level: string,
  agoMin: number,
  source = 'live',
): RpcEntity => ({
  key,
  attributes: [
    { name: 'level', type: 'str', value: level },
    { name: 'cell', type: 'str', value: 'te7uc8t' },
    { name: 'reportedAt', type: 'u64', value: hex(NOW - agoMin * 60) },
    { name: 'reporter', type: 'str', value: reporter },
    { name: 'source', type: 'str', value: source },
  ],
});

const vote = (reportKey: string, voter: string, v: string, agoMin: number): RpcEntity => ({
  key: `0xv${voter}`,
  attributes: [
    { name: 'report', type: 'key', value: reportKey },
    { name: 'vote', type: 'str', value: v },
    { name: 'cell', type: 'str', value: 'te7uc8t' },
    { name: 'votedAt', type: 'u64', value: hex(NOW - agoMin * 60) },
    { name: 'voter', type: 'str', value: voter },
    { name: 'source', type: 'str', value: 'live' },
  ],
});

describe('decoding Arkiv entities', () => {
  it('reads a report as the API does (hex u64, lower-case key)', () => {
    expect(toReport(report('0xABC', 'asha', 'knee', 10))).toEqual({
      key: '0xabc',
      cell: 'te7uc8t',
      level: 'knee',
      reportedAt: NOW - 600,
      reporter: 'asha',
      source: 'live',
    });
  });

  it('skips malformed entities instead of trusting them', () => {
    expect(toReport(report('0x1', 'asha', 'neck-deep', 10))).toBeNull();
    expect(toReport(report('0x1', 'asha', 'knee', 10, 'rumour'))).toBeNull();
    expect(toVote(vote('0x1', 'ravi', 'maybe', 5))).toBeNull();
  });
});

describe('computeVerdict', () => {
  const reports = [report('0x1', 'asha', 'knee', 20), report('0x2', 'ravi', 'knee', 10)].map((e) =>
    toReport(e)!,
  );
  const votes = [toVote(vote('0x1', 'meera', 'confirm', 5))!];

  it('recomputes the area with the fusion engine', () => {
    const v = computeVerdict(reports, votes, { asOf: NOW, arkivBlock: 7, maxAreas: 10 });
    expect(v.reports).toBe(2);
    expect(v.votes).toBe(1);
    expect(v.areas).toHaveLength(1);
    expect(v.areas[0]).toMatchObject({ cell: 'te7uc8t', level: 2, supporters: 3, reports: 2 });
    expect(v.areas[0].confidenceBps).toBeGreaterThan(7000);
  });

  it('is deterministic: the same evidence in any order gives the same hash', () => {
    const a = computeVerdict(reports, votes, { asOf: NOW, arkivBlock: 7, maxAreas: 10 });
    const b = computeVerdict([...reports].reverse(), votes, { asOf: NOW, arkivBlock: 7, maxAreas: 10 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('changes the evidence hash when the evidence changes', () => {
    const a = computeVerdict(reports, votes, { asOf: NOW, arkivBlock: 7, maxAreas: 10 });
    const b = computeVerdict(reports, [], { asOf: NOW, arkivBlock: 7, maxAreas: 10 });
    expect(a.evidenceHash).not.toBe(b.evidenceHash);
  });

  it('marks contested areas as 255', () => {
    const lone = [toReport(report('0x9', 'asha', 'knee', 10))!];
    const disputes = ['ravi', 'meera', 'kabir'].map((who) => toVote(vote('0x9', who, 'dispute', 5))!);
    const v = computeVerdict(lone, disputes, { asOf: NOW, arkivBlock: 7, maxAreas: 10 });
    expect(v.areas[0].level).toBe(CONTESTED);
  });
});

describe('wire formats', () => {
  it('asks Arkiv for one page of 100, with an offset after the first', () => {
    const body = JSON.parse(queryBody("arkiv.schema = str('x')", ['level'], 100));
    expect(body.method).toBe('arkiv_query');
    expect(body.params[1]).toMatchObject({ limit: '0x64', offset: '0x64' });
  });

  it('encodes the attestation the contract decodes', () => {
    const v = computeVerdict([toReport(report('0x1', 'asha', 'knee', 10))!], [], {
      asOf: NOW,
      arkivBlock: 7,
      maxAreas: 10,
    });
    const [decoded] = decodeAbiParameters(ATTESTATION_ABI, encodeAttestation(v));
    expect(decoded.asOf).toBe(BigInt(NOW));
    expect(decoded.areas[0].cell).toBe('te7uc8t');
  });
});
