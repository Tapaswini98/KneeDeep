import { toDashedTxId } from './keys';

/** Hedera Mirror Node REST reads. The SDK's AccountBalanceQuery is gone in @hiero-ledger/sdk 2.90. */

export interface MirrorAccount {
  account: string;
  balance: { balance: number | string };
  key?: { _type?: string; key?: string } | null;
  deleted?: boolean;
  receiver_sig_required?: boolean | null;
}

export interface MirrorTransaction {
  transaction_id: string;
  result: string;
  consensus_timestamp: string;
  memo_base64?: string;
  transfers: { account: string; amount: number }[];
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

/**
 * A transaction by id ("0.0.123@1700000000.000000042" or the dashed form), or null if the mirror
 * node has not seen it (yet). Retries are the caller's job: the mirror node lags consensus by seconds.
 */
export async function fetchTransaction(mirrorUrl: string, txId: string): Promise<MirrorTransaction | null> {
  const res = await fetch(`${mirrorUrl}/api/v1/transactions/${toDashedTxId(txId)}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Mirror node ${res.status} for transaction ${txId}`);
  const body = (await res.json()) as { transactions?: MirrorTransaction[] };
  // A scheduled or duplicate submission can list several; the first is the one that executed.
  return body.transactions?.[0] ?? null;
}
