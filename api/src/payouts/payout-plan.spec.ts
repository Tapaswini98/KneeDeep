import { HEDERA_ACCOUNT_ID, planBatch, splitRevenue } from './payout-plan';

describe('splitRevenue', () => {
  it('gives the reporters 70% of a 0.1 HBAR query, split equally', () => {
    const credits = splitRevenue(10_000_000n, ['b', 'a'], 70);
    expect(credits).toEqual([
      { reporter: 'a', amountTinybars: 3_500_000n },
      { reporter: 'b', amountTinybars: 3_500_000n },
    ]);
  });

  it('pays each human once, however many of their reports were used', () => {
    expect(splitRevenue(10_000_000n, ['a', 'a', 'b'], 70)).toHaveLength(2);
  });

  it('never credits more than the reporter share (dust stays with the platform)', () => {
    const credits = splitRevenue(10_000_000n, ['a', 'b', 'c'], 70);
    const total = credits.reduce((s, c) => s + c.amountTinybars, 0n);
    expect(total).toBe(6_999_999n);
    expect(total).toBeLessThanOrEqual(7_000_000n);
  });

  it('credits nobody when no report earns, or the share rounds to zero', () => {
    expect(splitRevenue(10_000_000n, [], 70)).toEqual([]);
    expect(splitRevenue(1n, ['a', 'b'], 70)).toEqual([]);
    expect(splitRevenue(10_000_000n, ['a'], 0)).toEqual([]);
  });
});

describe('planBatch', () => {
  const e = (id: string, accountId: string, amount: number) => ({
    id,
    accountId,
    amountTinybars: BigInt(amount),
  });

  it('sums earnings per account into one transfer each', () => {
    const plan = planBatch([e('1', '0.0.10', 300), e('2', '0.0.10', 200), e('3', '0.0.11', 400)], {
      minTinybars: 1n,
      maxRecipients: 9,
    });
    expect(plan.transfers).toEqual([
      { accountId: '0.0.10', amountTinybars: 500n },
      { accountId: '0.0.11', amountTinybars: 400n },
    ]);
    expect(plan.earningIds.sort()).toEqual(['1', '2', '3']);
    expect(plan.totalTinybars).toBe(900n);
  });

  it('leaves accounts below the minimum for a later batch', () => {
    const plan = planBatch([e('1', '0.0.10', 50), e('2', '0.0.11', 500)], {
      minTinybars: 100n,
      maxRecipients: 9,
    });
    expect(plan.transfers.map((t) => t.accountId)).toEqual(['0.0.11']);
    expect(plan.earningIds).toEqual(['2']);
  });

  it('caps recipients per transfer, paying the largest balances first', () => {
    const many = Array.from({ length: 12 }, (_, i) => e(String(i), `0.0.${100 + i}`, 1000 + i));
    const plan = planBatch(many, { minTinybars: 1n, maxRecipients: 9 });
    expect(plan.transfers).toHaveLength(9);
    expect(plan.transfers[0]).toEqual({ accountId: '0.0.111', amountTinybars: 1011n });
    expect(plan.earningIds).not.toContain('0');
  });

  it('plans nothing when nothing is owed', () => {
    expect(planBatch([], { minTinybars: 1n, maxRecipients: 9 })).toEqual({
      transfers: [],
      earningIds: [],
      totalTinybars: 0n,
    });
  });
});

describe('HEDERA_ACCOUNT_ID', () => {
  it('accepts 0.0.x ids only', () => {
    expect(HEDERA_ACCOUNT_ID.test('0.0.5123456')).toBe(true);
    expect(HEDERA_ACCOUNT_ID.test('0.0.')).toBe(false);
    expect(HEDERA_ACCOUNT_ID.test('0x1234abcd')).toBe(false);
    expect(HEDERA_ACCOUNT_ID.test('1.2.3')).toBe(false);
  });
});
