/**
 * Payout arithmetic. Pure and integer-only (tinybars as bigint): no floats near money.
 */

export interface Credit {
  reporter: string;
  amountTinybars: bigint;
}

/**
 * Split one paid query between the reporters it used: `percent` of the payment, divided equally
 * (one share per human, however many of their reports were used). Rounding dust stays with the
 * platform, so the credits never add up to more than the reporters' share.
 */
export function splitRevenue(paidTinybars: bigint, reporters: string[], percent: number): Credit[] {
  const humans = [...new Set(reporters)].sort();
  if (humans.length === 0 || percent <= 0) return [];
  const pool = (paidTinybars * BigInt(percent)) / 100n;
  const each = pool / BigInt(humans.length);
  if (each <= 0n) return [];
  return humans.map((reporter) => ({ reporter, amountTinybars: each }));
}

export interface UnpaidEarning {
  id: string;
  accountId: string;
  amountTinybars: bigint;
}

export interface BatchPlan {
  transfers: { accountId: string; amountTinybars: bigint }[];
  /** The earnings this batch settles; everything else waits for a later batch. */
  earningIds: string[];
  totalTinybars: bigint;
}

/**
 * Choose what one batch pays: unpaid earnings summed per Hedera account, accounts owed at least
 * `minTinybars`, largest first, at most `maxRecipients` (one Hedera transfer has a size limit).
 */
export function planBatch(
  earnings: UnpaidEarning[],
  opts: { minTinybars: bigint; maxRecipients: number },
): BatchPlan {
  const byAccount = new Map<string, { amount: bigint; ids: string[] }>();
  for (const e of earnings) {
    const acc = byAccount.get(e.accountId) ?? { amount: 0n, ids: [] };
    acc.amount += e.amountTinybars;
    acc.ids.push(e.id);
    byAccount.set(e.accountId, acc);
  }
  const chosen = [...byAccount.entries()]
    .filter(([, a]) => a.amount >= opts.minTinybars)
    .sort(([idA, a], [idB, b]) =>
      a.amount === b.amount ? idA.localeCompare(idB) : a.amount > b.amount ? -1 : 1,
    )
    .slice(0, opts.maxRecipients);
  return {
    transfers: chosen.map(([accountId, a]) => ({ accountId, amountTinybars: a.amount })),
    earningIds: chosen.flatMap(([, a]) => a.ids),
    totalTinybars: chosen.reduce((sum, [, a]) => sum + a.amount, 0n),
  };
}

/** Hedera account ids we pay: shard.realm.num. EVM-address aliases are refused (they may not exist yet). */
export const HEDERA_ACCOUNT_ID = /^0\.0\.\d{1,12}$/;
