import { createHash } from 'node:crypto';

export interface VerifiedHuman {
  /** Stable per human for our World ID action. Never stored or published; only its salted hash is. */
  nullifier: string;
  /** 'world' makes a reporter's submissions live; 'dev' submissions are always labelled simulated. */
  method: 'world' | 'dev';
}

export interface HumanVerifier {
  readonly name: 'world' | 'dev';
  /** Throws UnauthorizedException when the proof is missing or invalid. */
  verify(proof: unknown): Promise<VerifiedHuman>;
}

export const HUMAN_VERIFIER = Symbol('HUMAN_VERIFIER');

/**
 * The signal every KneeDeep proof must carry. World ID binds it into the proof, and we
 * check its hash on the server, so a proof made for another app context is rejected.
 */
export const WORLD_SIGNAL = 'kneedeep:reporter-session';

/** Public reporter id: sha256(salt ":" nullifier), hex. Unlinkable to the nullifier without the salt. */
export function pseudonymFor(salt: string, nullifier: string): string {
  return createHash('sha256').update(`${salt}:${nullifier}`).digest('hex');
}
