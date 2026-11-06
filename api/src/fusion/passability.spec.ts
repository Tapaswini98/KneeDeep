import { fuseCell, ReportInput, VoteInput } from './fusion';
import { assessPoint, derivePassability, STALE_AFTER_MIN } from './passability';

const NOW = 1_800_000_000;
const CELL = 'te7uc8t';
const min = (m: number) => NOW - m * 60;

let seq = 0;
const report = (reporter: string, level: ReportInput['level'], agoMin: number): ReportInput => ({
  key: `0xr${++seq}`,
  cell: CELL,
  level,
  reportedAt: min(agoMin),
  reporter,
  source: 'live',
});
const vote = (r: ReportInput, voter: string, v: VoteInput['vote'], agoMin: number): VoteInput => ({
  report: r.key,
  vote: v,
  voter,
  votedAt: min(agoMin),
  source: 'live',
});
const area = (reports: ReportInput[], votes: VoteInput[] = []) =>
  fuseCell(CELL, reports, votes, { now: NOW })!;
const judge = (reports: ReportInput[], votes: VoteInput[] = []) => derivePassability(area(reports, votes));

describe('derivePassability (two-wheeler)', () => {
  it('1. no reports -> unknown, never safe', () => {
    const p = derivePassability(null);
    expect(p.passability).toBe('unknown');
    expect(p.reason).toBe('No reports in the last 3 h. No data is not dry.');
  });

  it('2. contested -> unknown, saying who disagrees', () => {
    const knee = report('a', 'knee', 10);
    const p = judge([knee], [vote(knee, 'b', 'dispute', 5), vote(knee, 'c', 'dispute', 4)]);
    expect(p).toEqual({
      passability: 'unknown',
      reason: 'Disputed: 1 says knee-deep, but 2 humans dispute it.',
    });
  });

  it('2. contested by contradicting reports names each level', () => {
    const knee1 = report('a', 'knee', 10);
    const knee2 = report('b', 'knee', 12);
    const dry = report('c', 'dry', 8);
    const votes = ['d', 'e', 'f', 'g'].flatMap((v) => [
      vote(knee1, v, 'dispute', 3),
      vote(knee2, v, 'dispute', 3),
    ]);
    const p = judge(
      [knee1, knee2, dry],
      [...votes, ...['d', 'e', 'f', 'g'].map((v) => vote(dry, v, 'dispute', 3))],
    );
    expect(p.passability).toBe('unknown');
    expect(p.reason).toBe('Reports disagree: 2 say knee-deep, 1 says dry.');
  });

  it('3. stale evidence -> unknown, even if it was corroborated', () => {
    const p = judge([report('a', 'dry', STALE_AFTER_MIN + 30), report('b', 'dry', STALE_AFTER_MIN + 40)]);
    expect(p).toEqual({ passability: 'unknown', reason: 'Newest report is 2 h old; too stale to rely on.' });
  });

  it('3. a fresh confirmation keeps an older report current', () => {
    const old = report('a', 'dry', STALE_AFTER_MIN + 30);
    const other = report('b', 'dry', STALE_AFTER_MIN + 20);
    expect(judge([old, other], [vote(old, 'c', 'confirm', 5)]).passability).toBe('safe');
  });

  it('4. corroborated waist or closed -> blocked', () => {
    const p = judge([report('a', 'waist', 5), report('b', 'waist', 10), report('c', 'waist', 15)]);
    expect(p).toEqual({ passability: 'blocked', reason: '3 humans report waist-deep water.' });
    expect(judge([report('a', 'closed', 5), report('b', 'closed', 9)]).passability).toBe('blocked');
  });

  it('5. corroborated knee -> blocked for a two-wheeler', () => {
    const p = judge([report('a', 'knee', 5), report('b', 'knee', 10)]);
    expect(p).toEqual({
      passability: 'blocked',
      reason: 'Knee-deep is impassable for a two-wheeler: 2 humans report it.',
    });
  });

  it('6. one unconfirmed report of deep water -> risky, not blocked (even at medium confidence)', () => {
    const a = area([report('a', 'knee', 2)]);
    expect(a.confidenceLabel).toBe('medium');
    expect(derivePassability(a)).toEqual({
      passability: 'risky',
      reason: 'One unconfirmed report of knee-deep water.',
    });
    expect(judge([report('a', 'ankle', 5)]).passability).toBe('risky');
  });

  it('6. low-confidence flooding backed by several humans -> risky', () => {
    const p = judge([
      report('a', 'knee', 10),
      report('b', 'knee', 15),
      report('c', 'dry', 12),
      report('d', 'dry', 14),
    ]);
    expect(p.passability).toBe('risky');
    expect(p.reason).toMatch(/^2 humans report knee-deep water, but confidence is low/);
  });

  it('7. corroborated dry or ankle -> safe', () => {
    expect(judge([report('a', 'dry', 12), report('b', 'dry', 30)])).toEqual({
      passability: 'safe',
      reason: '2 humans report dry, newest 12 min ago.',
    });
    const ankle = judge([report('a', 'ankle', 12), report('b', 'ankle', 20)]);
    expect(ankle).toEqual({
      passability: 'safe',
      reason: '2 humans report ankle-deep water, newest 12 min ago; passable with care.',
    });
  });

  it('7. a confirmation counts as a second human', () => {
    const r = report('a', 'dry', 10);
    expect(judge([r], [vote(r, 'b', 'confirm', 4)]).passability).toBe('safe');
  });

  it('8. a single dry report -> unknown, never safe', () => {
    expect(judge([report('a', 'dry', 1)])).toEqual({
      passability: 'unknown',
      reason: 'Only one unconfirmed dry report.',
    });
  });
});

describe('assessPoint', () => {
  const dry = area([report('a', 'dry', 5), report('b', 'dry', 6)]);
  const knee = { ...area([report('c', 'knee', 5), report('d', 'knee', 6)]), cell: 'te7uc8v' };

  it('lets the worst nearby area decide', () => {
    expect(assessPoint([dry, knee])).toMatchObject({ passability: 'blocked', cell: 'te7uc8v' });
  });

  it('is unknown with no areas at all', () => {
    expect(assessPoint([])).toMatchObject({ passability: 'unknown', cell: null });
  });
});
