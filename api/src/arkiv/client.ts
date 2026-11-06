import { createPublicClient, createWalletClient } from '@arkiv-network/sdk';
import { rabdi } from '@arkiv-network/sdk/chains';
import { viem, viemAccounts } from './viem';

const { http, isHex } = viem;
const { privateKeyToAccount } = viemAccounts;

/** Rabdi is Arkiv's testnet. Explorer: https://rabdi.explorer.arkiv.network */
export function arkivChain(accessKey: string) {
  return rabdi({ accessKey });
}

export function arkivPublicClient(accessKey: string) {
  return createPublicClient({ chain: arkivChain(accessKey), transport: http() });
}

/** The backend writes reports on reporters' behalf (an MVP trade-off: reporters don't own entries). */
export function arkivWalletClient(accessKey: string, privateKey: string) {
  const pk = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
  if (!isHex(pk) || pk.length !== 66) throw new Error('ARKIV_PRIVATE_KEY must be a 32-byte hex private key');
  return createWalletClient({
    chain: arkivChain(accessKey),
    transport: http(),
    account: privateKeyToAccount(pk),
  });
}

export type ArkivPublicClient = ReturnType<typeof arkivPublicClient>;
export type ArkivWalletClient = ReturnType<typeof arkivWalletClient>;

export const ARKIV_EXPLORER = 'https://rabdi.explorer.arkiv.network';

export function arkivExplorerTx(txHash: string): string {
  return `${ARKIV_EXPLORER}/tx/${txHash}`;
}

export function arkivExplorerEntity(entityKey: string): string {
  return `${ARKIV_EXPLORER}/entity/${entityKey}`;
}

export function arkivExplorerAddress(address: string): string {
  return `${ARKIV_EXPLORER}/address/${address}`;
}
