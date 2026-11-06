/**
 * @worldcoin/idkit-core ships CommonJS builds (used at runtime) but its type declarations
 * resolve as ESM, which TypeScript (node16) refuses to statically import from a CommonJS
 * file. Same workaround as src/arkiv/viem.ts.
 */
import type * as Signing from '@worldcoin/idkit-core/signing' with { 'resolution-mode': 'import' };
import type * as Hashing from '@worldcoin/idkit-core/hashing' with { 'resolution-mode': 'import' };

export const { signRequest }: typeof Signing = require('@worldcoin/idkit-core/signing');
export const { hashSignal }: typeof Hashing = require('@worldcoin/idkit-core/hashing');
