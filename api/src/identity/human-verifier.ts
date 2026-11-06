import { createHash } from 'node:crypto';

export interface VerifiedHuman {
  /** Stable per human (and per World ID action). Never stored or published; only its salted hash is. */
  nullifier: string;
  /** 'world' proofs make reports live; 'dev' reports are always labelled simulated. */
  method: 'world' | 'dev';
}

export interface VerifyContext {
  /** What the proof authorises, e.g. "report" or "vote". */
  purpose: 'report' | 'vote';
  /** Binds the proof to this exact submission so it cannot be replayed for another. */
  signal: string;
}

export interface HumanVerifier {
  readonly name: 'world' | 'dev';
  /** Throws UnauthorizedException when the proof is missing or invalid. */
  verify(proof: unknown, ctx: VerifyContext): Promise<VerifiedHuman>;
}

export const HUMAN_VERIFIER = Symbol('HUMAN_VERIFIER');

/** Public reporter id: sha256(salt ":" nullifier), hex. Unlinkable to the nullifier without the salt. */
export function pseudonymFor(salt: string, nullifier: string): string {
  return createHash('sha256').update(`${salt}:${nullifier}`).digest('hex');
}
