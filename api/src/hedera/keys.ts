import { PrivateKey } from '@hiero-ledger/sdk';

export type KeyType = 'ECDSA' | 'ED25519';

/**
 * Portal keys arrive as raw hex (which can't tell ECDSA from ED25519) or as DER.
 * A wrong guess only surfaces later as INVALID_SIGNATURE, so the type is explicit
 * unless the key is DER-encoded (DER always starts with 0x30).
 */
export function parsePrivateKey(raw: string, type: KeyType): PrivateKey {
  const hex = raw.trim().replace(/^0x/, '');
  if (hex.startsWith('30')) return PrivateKey.fromStringDer(hex);
  return type === 'ECDSA' ? PrivateKey.fromStringECDSA(hex) : PrivateKey.fromStringED25519(hex);
}

export function hashscanTxUrl(network: string, txId: string): string {
  const net = network.replace('hedera:', '');
  return `https://hashscan.io/${net}/transaction/${encodeURIComponent(txId)}`;
}

export function hashscanAccountUrl(network: string, accountId: string): string {
  const net = network.replace('hedera:', '');
  return `https://hashscan.io/${net}/account/${accountId}`;
}
