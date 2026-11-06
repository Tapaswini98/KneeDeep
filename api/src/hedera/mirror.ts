/** Hedera Mirror Node REST reads. The SDK's AccountBalanceQuery is gone in @hiero-ledger/sdk 2.90. */

export interface MirrorAccount {
  account: string;
  balance: { balance: number | string };
  key?: { _type?: string; key?: string } | null;
}

export async function fetchAccount(mirrorUrl: string, accountId: string): Promise<MirrorAccount> {
  const res = await fetch(`${mirrorUrl}/api/v1/accounts/${accountId}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404) throw new Error(`Account ${accountId} not found on this network`);
  if (!res.ok) throw new Error(`Mirror node ${res.status} for account ${accountId}`);
  return (await res.json()) as MirrorAccount;
}

export async function fetchBalanceTinybars(mirrorUrl: string, accountId: string): Promise<bigint> {
  const account = await fetchAccount(mirrorUrl, accountId);
  return BigInt(account.balance.balance);
}

export function formatHbar(tinybars: bigint): string {
  const whole = tinybars / 100_000_000n;
  const frac = (tinybars % 100_000_000n).toString().padStart(8, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac} HBAR` : `${whole} HBAR`;
}
