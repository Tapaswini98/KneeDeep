import { Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { hashSignal } from './idkit';
import { HumanVerifier, VerifiedHuman, WORLD_SIGNAL } from './human-verifier';

/** The IDKit 4.0 uniqueness result, as the browser receives it and forwards it to us untouched. */
interface IdkitResultV4 {
  protocol_version: string;
  nonce: string;
  action?: string;
  environment?: string;
  responses: { identifier: string; nullifier?: string; signal_hash?: string; proof: unknown }[];
}

interface VerifyResponse {
  success: boolean;
  code?: string;
  detail?: string;
  nullifier?: string;
  environment?: string;
  results?: { identifier: string; success: boolean; nullifier?: string; code?: string; detail?: string }[];
}

/** Proof of Human is the minimum credential that answers our question: is this one unique person? */
const REQUIRED_CREDENTIAL = 'proof_of_human';

const sameField = (a: string, b: string) => {
  try {
    return BigInt(a) === BigInt(b);
  } catch {
    return a.toLowerCase() === b.toLowerCase();
  }
};

/**
 * Verifies a World ID 4.0 Proof of Human server-side with the Developer Portal.
 * Before calling World it checks what the portal does not: protocol version (no legacy
 * 3.0 proofs, whose nullifiers differ and would let one person register twice), our
 * action, the expected environment, and that the proof is bound to our signal.
 */
export class WorldIdVerifier implements HumanVerifier {
  readonly name = 'world' as const;
  private readonly log = new Logger(WorldIdVerifier.name);
  private readonly expectedSignalHash = hashSignal(WORLD_SIGNAL);

  constructor(
    private readonly opts: { rpId?: string; action: string; environment: 'production' | 'staging'; baseUrl: string },
  ) {}

  async verify(proof: unknown): Promise<VerifiedHuman> {
    if (!this.opts.rpId) throw new ServiceUnavailableException('WORLD_RP_ID is not set');
    const result = this.checkShape(proof);

    const res = await fetch(`${this.opts.baseUrl}/api/v4/verify/${this.opts.rpId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Forwarded as-is (IDKit 4 needs no reshaping); environment pinned to ours.
      body: JSON.stringify({ ...result, environment: this.opts.environment }),
      signal: AbortSignal.timeout(15_000),
    }).catch((err: Error) => {
      throw new ServiceUnavailableException(`World ID verify unreachable: ${err.message}`);
    });
    const body = (await res.json().catch(() => ({ success: false, detail: `HTTP ${res.status}` }))) as VerifyResponse;

    if (!res.ok || !body.success) {
      this.log.warn(`World ID rejected proof: ${body.code ?? res.status} ${body.detail ?? ''}`);
      throw new UnauthorizedException(`World ID verification failed: ${body.detail ?? body.code ?? res.status}`);
    }
    if (body.environment && body.environment !== this.opts.environment) {
      throw new UnauthorizedException(`Proof is for ${body.environment}, expected ${this.opts.environment}`);
    }
    // World may report success if any one credential passes; we need Proof of Human specifically.
    const human = body.results?.find((r) => r.success && r.identifier === REQUIRED_CREDENTIAL);
    const nullifier = human?.nullifier ?? (body.results ? undefined : body.nullifier);
    if (!nullifier) throw new UnauthorizedException('Proof of Human was not verified');

    // Normalise (hex or decimal) so one human always maps to one pseudonym.
    return { nullifier: `world:${BigInt(nullifier).toString()}`, method: 'world' };
  }

  private checkShape(proof: unknown): IdkitResultV4 {
    const r = proof as Partial<IdkitResultV4> | null;
    if (!r || typeof r !== 'object' || !Array.isArray(r.responses)) {
      throw new UnauthorizedException('Missing World ID proof');
    }
    if (r.protocol_version !== '4.0' || !r.action) {
      throw new UnauthorizedException('Only World ID 4.0 uniqueness proofs are accepted');
    }
    if (r.action !== this.opts.action) {
      throw new UnauthorizedException(`Proof is for action "${r.action}", expected "${this.opts.action}"`);
    }
    if (r.environment && r.environment !== this.opts.environment) {
      throw new UnauthorizedException(`Proof is for ${r.environment}, expected ${this.opts.environment}`);
    }
    const poh = r.responses.find((x) => x.identifier === REQUIRED_CREDENTIAL);
    if (!poh) throw new UnauthorizedException('Proof of Human credential is required');
    if (!poh.signal_hash || !sameField(poh.signal_hash, this.expectedSignalHash)) {
      throw new UnauthorizedException('Proof is not bound to the KneeDeep signal');
    }
    return r as IdkitResultV4;
  }
}
