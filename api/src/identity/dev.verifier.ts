import { UnauthorizedException } from '@nestjs/common';
import { HumanVerifier, VerifiedHuman } from './human-verifier';

/**
 * Development and demo seeding only (REPORTER_VERIFIER=dev). Accepts `{ devId }` as
 * the "proof". Proves nothing, so everything it admits is labelled simulated.
 */
export class DevVerifier implements HumanVerifier {
  readonly name = 'dev' as const;

  async verify(proof: unknown): Promise<VerifiedHuman> {
    const devId = (proof as { devId?: unknown } | null)?.devId;
    if (typeof devId !== 'string' || !/^[A-Za-z0-9_-]{3,64}$/.test(devId)) {
      throw new UnauthorizedException('Dev mode: proof must be { devId: "3-64 chars [A-Za-z0-9_-]" }');
    }
    return { nullifier: `dev:${devId}`, method: 'dev' };
  }
}
