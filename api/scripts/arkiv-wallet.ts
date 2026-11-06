/**
 * Create the backend's Arkiv writer wallet (testnet only).
 *   npm run arkiv:wallet
 * Paste the key into .env as ARKIV_PRIVATE_KEY and fund the address at https://hub.arkiv.network/faucet
 */
import { viemAccounts } from '../src/arkiv/viem';
import { readConfig } from '../src/config/config';

const { generatePrivateKey, privateKeyToAccount } = viemAccounts;

const config = readConfig();
if (config.ARKIV_PRIVATE_KEY) {
  console.log('ARKIV_PRIVATE_KEY is already set in .env; not generating a new one.');
  process.exit(0);
}
const key = generatePrivateKey();
console.log(`ARKIV_PRIVATE_KEY=${key}`);
console.log(`Address: ${privateKeyToAccount(key).address}`);
console.log('Fund it with tGLM: https://hub.arkiv.network/faucet');
