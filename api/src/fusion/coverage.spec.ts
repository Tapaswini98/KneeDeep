import { coverageState, FRESH_MIN } from './coverage';
import { fuseCell, ReportInput, VoteInput } from './fusion';
import { STALE_AFTER_MIN } from './passability';

const NOW = 1_800_000_000;
const CELL = 'te7uc8t';
let seq = 0;
const report = (reporter: string, level: ReportInput['level'], agoMin: number): ReportInput => ({
  key: `0xr${++seq}`,
  cell: CELL,
  level,
  reportedAt: NOW - agoMin * 60,
  reporter,
  source: 'live',
});
const vote = (r: ReportInput, voter: string, v: VoteInput['vote'], agoMin: number): VoteInput => ({
  report: r.key,
  vote: v,
  voter,
  votedAt: NOW - agoMin * 60,
  source: 'live',
});
const state = (reports: ReportInput[], votes: VoteInput[] = []) =>
  coverageState(fuseCell(CELL, reports, votes, { now: NOW })!);

describe('coverageState', () => {
  it('corroborated: two fresh humans agree (a confirmation counts)', () => {
    expect(state([report('a', 'knee', 10), report('b', 'knee', 20)])).toEqual({
      state: 'corroborated',
      reason: '2 independent humans agree; newest 10 min ago.',
    });
    const r = report('a', 'dry', 30);
    expect(state([r], [vote(r, 'b', 'confirm', 5)]).state).toBe('corroborated');
  });

  it('unverified: one human, or corroborated but older than FRESH_MIN', () => {
    expect(state([report('a', 'waist', 5)])).toEqual({
      state: 'unverified',
      reason: 'One human, not yet confirmed; newest 5 min ago.',
    });
    expect(state([report('a', 'dry', FRESH_MIN + 10), report('b', 'dry', FRESH_MIN + 15)]).state).toBe(
      'unverified',
    );
  });

  it('conflicting: contradicting reports or disputes', () => {
    expect(state([report('a', 'knee', 10), report('b', 'dry', 5)]).state).toBe('conflicting');
    const r = report('a', 'knee', 10);
    expect(state([r], [vote(r, 'b', 'dispute', 4)])).toEqual({
      state: 'conflicting',
      reason: '2 humans disagree (1 dispute); newest 10 min ago.',
    });
  });

  it('stale: newest evidence older than STALE_AFTER_MIN, whatever it says', () => {
    expect(
      state([report('a', 'knee', STALE_AFTER_MIN + 5), report('b', 'dry', STALE_AFTER_MIN + 9)]).state,
    ).toBe('stale');
  });

  it('never reveals the level (that is the paid answer)', () => {
    const { reason } = state([report('a', 'waist', 5), report('b', 'waist', 8)]);
    expect(reason).not.toMatch(/dry|ankle|knee|waist|closed/);
  });
});
