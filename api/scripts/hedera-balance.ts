/**
 * S1 checkpoint: the platform account exists, its key type is right, and the
 * facilitator supports our network. Also prints the agent account if configured.
 *   npm run hedera:balance
 */
import { readConfig } from '../src/config/config';
import { hashscanAccountUrl, KeyType, parsePrivateKey } from '../src/hedera/keys';
import { fetchAccount, formatHbar } from '../src/hedera/mirror';

async function checkAccount(label: string, accountId: string, rawKey: string | undefined, keyType: KeyType) {
  const config = readConfig();
  const acct = await fetchAccount(config.HEDERA_MIRROR_NODE_URL, accountId);
  console.log(`${label} ${accountId}: ${formatHbar(BigInt(acct.balance.balance))}`);
  console.log(`  ${hashscanAccountUrl(config.HEDERA_NETWORK, accountId)}`);
  if (!rawKey) {
    console.log('  (no private key set, key check skipped)');
    return true;
  }
  // Catch the ECDSA-vs-ED25519 mix-up now, not as INVALID_SIGNATURE at settle time.
  const ours = parsePrivateKey(rawKey, keyType).publicKey.toStringRaw().toLowerCase();
  const onchain = acct.key?.key?.toLowerCase();
  if (onchain && !onchain.endsWith(ours)) {
    console.log(`  WARNING: private key does not match the account's public key. Check the key type (${keyType}).`);
    return false;
  }
  console.log('  Key matches the account.');
  return true;
}

async function main() {
  const config = readConfig();
  if (!config.HEDERA_ACCOUNT_ID) throw new Error('Set HEDERA_ACCOUNT_ID in .env (https://portal.hedera.com)');

  let ok = await checkAccount('Platform', config.HEDERA_ACCOUNT_ID, config.HEDERA_PRIVATE_KEY, config.HEDERA_KEY_TYPE);

  const agentId = process.env.AGENT_HEDERA_ACCOUNT_ID?.trim();
  if (agentId) {
    const agentType = (process.env.AGENT_HEDERA_KEY_TYPE?.trim() || 'ECDSA') as KeyType;
    ok = (await checkAccount('Agent   ', agentId, process.env.AGENT_HEDERA_PRIVATE_KEY?.trim(), agentType)) && ok;
  }

  const res = await fetch(`${config.FACILITATOR_URL}/supported`, { signal: AbortSignal.timeout(10_000) });
  const body = (await res.json()) as { kinds?: { network: string; scheme: string; extra?: unknown }[] };
  const kinds = (body.kinds ?? []).filter((k) => k.network === config.HEDERA_NETWORK);
  if (kinds.length === 0) {
    console.log(`Facilitator ${config.FACILITATOR_URL} does NOT list ${config.HEDERA_NETWORK}.`);
    ok = false;
  } else {
    for (const k of kinds) console.log(`Facilitator ${config.FACILITATOR_URL}: ${k.scheme} on ${k.network}`);
  }
  if (!ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
