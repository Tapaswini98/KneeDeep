/**
 * viem ships a CommonJS build (used at runtime here) but marks its type declarations
 * as ESM, so TypeScript (node16) refuses a static `import ... from 'viem'` in a
 * CommonJS file. Import the types in ESM resolution mode and require the CJS build.
 * Everything else imports viem through this file.
 */
import type * as ViemTypes from 'viem' with { 'resolution-mode': 'import' };
import type * as ViemAccountsTypes from 'viem/accounts' with { 'resolution-mode': 'import' };

export const viem: typeof ViemTypes = require('viem');
export const viemAccounts: typeof ViemAccountsTypes = require('viem/accounts');

export type Hex = ViemTypes.Hex;
