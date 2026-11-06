import { confidenceLabel, fuse, fuseCell, recencyWeight, ReportInput, VoteInput } from './fusion';

const NOW = 1_800_000_000;
const CELL = 'te7uc8t';
const min = (m: number) => NOW - m * 60;

let seq = 0;
function report(reporter: string, level: ReportInput['level'], agoMin: number, extra: Partial<ReportInput> = {}) {
  return { key: `0xr${++seq}`, cell: CELL, level, reportedAt: min(agoMin), reporter, source: 'live', ...extra } as ReportInput;
}
function vote(r: ReportInput, voter: string, v: VoteInput['vote'], agoMin: number, extra: Partial<VoteInput> = {}) {
  return { report: r.key, vote: v, voter, votedAt: min(agoMin), source: 'live', ...extra } as VoteInput;
}
const fuseOne = (reports: ReportInput[], votes: VoteInput[] = []) => fuseCell(CELL, reports, votes, { now: NOW })!;

describe('recency weighting', () => {
  it('halves every half-life', () => {
    expect(recencyWeight(0)).toBe(1);
    expect(recencyWeight(45)).toBeCloseTo(0.5);
    expect(recencyWeight(90)).toBeCloseTo(0.25);
  });

  it('makes the same evidence less confident as it ages', () => {
    const fresh = fuseOne([report('a', 'knee', 5), report('b', 'knee', 5), report('c', 'knee', 5)]);
    const old = fuseOne([report('a', 'knee', 120), report('b', 'knee', 120), report('c', 'knee', 120)]);
    expect(fresh.confidence).toBeGreaterThan(old.confidence);
  });

  it('drops reports older than the max age and from the future', () => {
    expect(fuseOne([report('a', 'knee', 181), report('b', 'knee', 10)]).inputs.reports).toBe(1);
    expect(fuseCell(CELL, [report('a', 'knee', -5)], [], { now: NOW })).toBeNull();
  });

  it('lets a fresher report outweigh an older contradicting one', () => {
    const a = fuseOne([report('a', 'waist', 100), report('b', 'dry', 2)]);
    expect(a.level).toBe('dry');
  });
});

describe('corroboration', () => {
  it('never gives a single report high confidence, however fresh', () => {
    const a = fuseOne([report('a', 'knee', 0)]);
    expect(a.level).toBe('knee');
    expect(a.confidence).toBeLessThanOrEqual(0.5);
    expect(a.confidenceLabel).not.toBe('high');
    expect(a.explanation).toContain('not yet corroborated');
  });

  it('gives three fresh agreeing humans high confidence and explains why', () => {
    const a = fuseOne([report('a', 'knee', 12), report('b', 'knee', 20), report('c', 'knee', 25)]);
    expect(a.level).toBe('knee');
    expect(a.confidenceLabel).toBe('high');
    expect(a.inputs).toMatchObject({ supportingHumans: 3, reports: 3, disputes: 0, newestAgeMin: 12, oldestAgeMin: 25 });
    expect(a.explanation).toBe('3 independent humans report knee-deep water; newest 12 min ago, oldest 25 min ago.');
  });

  it('counts each human once: a repeat reporter does not corroborate themselves', () => {
    const a = fuseOne([report('a', 'knee', 40), report('a', 'knee', 10)]);
    expect(a.inputs.reports).toBe(1);
    expect(a.inputs.supportingHumans).toBe(1);
    expect(a.reports[0].corroborated).toBe(false);
  });

  it('counts a confirmation from another human as corroboration', () => {
    const r = report('a', 'knee', 10);
    const a = fuseOne([r], [vote(r, 'b', 'confirm', 5)]);
    expect(a.inputs.supportingHumans).toBe(2);
    expect(a.reports[0].corroborated).toBe(true);
    expect(a.confidence).toBeGreaterThan(fuseOne([report('a', 'knee', 10)]).confidence);
  });

  it('ignores a reporter voting on their own report', () => {
    const r = report('a', 'knee', 10);
    const a = fuseOne([r], [vote(r, 'a', 'confirm', 5)]);
    expect(a.inputs.confirmations).toBe(0);
    expect(a.reports[0].corroborated).toBe(false);
  });
});

describe('contradictions and disputes', () => {
  it('lowers confidence when a dispute arrives', () => {
    const r1 = report('a', 'knee', 10);
    const r2 = report('b', 'knee', 10);
    const clean = fuseOne([r1, r2]);
    const disputed = fuseOne([r1, r2], [vote(r1, 'c', 'dispute', 5)]);
    expect(disputed.confidence).toBeLessThan(clean.confidence);
    expect(disputed.explanation).toContain('1 dispute');
  });

  it('lowers confidence when another human reports a different level', () => {
    const agree = fuseOne([report('a', 'knee', 10), report('b', 'knee', 10)]);
    const split = fuseOne([report('a', 'knee', 10), report('b', 'knee', 10), report('c', 'dry', 10)]);
    expect(split.level).toBe('knee');
    expect(split.confidence).toBeLessThan(agree.confidence);
    expect(split.inputs.contradictingReports).toBe(1);
    expect(split.explanation).toContain('1 contradicting report (dry)');
  });

  it('breaks ties toward the more severe level', () => {
    expect(fuseOne([report('a', 'ankle', 10), report('b', 'waist', 10)]).level).toBe('waist');
  });

  it('marks a cell contested when disputes outweigh every report', () => {
    const r = report('a', 'knee', 30);
    const a = fuseOne([r], [vote(r, 'b', 'dispute', 2), vote(r, 'c', 'dispute', 2)]);
    expect(a.level).toBeNull();
    expect(a.confidence).toBe(0);
    expect(a.confidenceLabel).toBe('low');
    expect(a.explanation).toMatch(/^Contested/);
  });

  it('keeps only one vote per human per report (the latest)', () => {
    const r = report('a', 'knee', 20);
    const a = fuseOne([r], [vote(r, 'b', 'dispute', 15), vote(r, 'b', 'confirm', 5)]);
    expect(a.inputs).toMatchObject({ confirmations: 1, disputes: 0 });
  });
});

describe('labels, sources and cells', () => {
  it('requires two supporting humans for high', () => {
    expect(confidenceLabel(0.9, 1)).toBe('medium');
    expect(confidenceLabel(0.7, 2)).toBe('high');
    expect(confidenceLabel(0.39, 3)).toBe('low');
  });

  it('reports the data source honestly', () => {
    expect(fuseOne([report('a', 'knee', 5, { source: 'simulated' })]).source).toBe('simulated');
    expect(fuseOne([report('a', 'knee', 5), report('b', 'knee', 5, { source: 'simulated' })]).source).toBe('mixed');
  });

  it('fuses each cell independently and omits cells with nothing fresh', () => {
    const other = report('z', 'waist', 5, { cell: 'te7uc8v' });
    const stale = report('y', 'knee', 500, { cell: 'te7uc8w' });
    const answers = fuse([report('a', 'knee', 5), other, stale], [], { now: NOW });
    expect(answers.map((a) => a.cell).sort()).toEqual(['te7uc8t', 'te7uc8v']);
  });
});
