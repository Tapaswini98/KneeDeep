import { Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { HumanVerifier, VerifiedHuman, WORLD_SIGNAL } from './human-verifier';
import { hashSignal } from './idkit';

/** The IDKit uniqueness result, as the browser receives it and forwards it to us untouched. */
interface IdkitResult {
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

export interface WorldIdOptions {
  rpId?: string;
  action: string;
  environment: 'production' | 'staging';
  baseUrl: string;
  /** Also accept World ID 3.0 Orb proofs (the legacy form of Proof of Human). */
  allowLegacy: boolean;
}

/**
 * Proof of Human is the minimum credential that answers our question: is this one unique person?
 * In World ID 3.0 the same guarantee came from an Orb verification.
 */
const CREDENTIALS: Record<string, string[]> = {
  '4.0': ['proof_of_human'],
  '3.0': ['orb', 'proof_of_human'],
};

const sameField = (a: string, b: string) => {
  try {
    return BigInt(a) === BigInt(b);
  } catch {
    return a.toLowerCase() === b.toLowerCase();
  }
};

/**
 * Verifies a World ID Proof of Human server-side with the Developer Portal.
 * Before calling World it checks what the portal does not: protocol version, our action,
 * the expected environment, the credential, and that the proof is bound to our signal.
 */
export class WorldIdVerifier implements HumanVerifier {
  readonly name = 'world' as const;
  private readonly log = new Logger(WorldIdVerifier.name);
  private readonly expectedSignalHash = hashSignal(WORLD_SIGNAL);

  constructor(private readonly opts: WorldIdOptions) {}

  async verify(proof: unknown): Promise<VerifiedHuman> {
    if (!this.opts.rpId) throw new ServiceUnavailableException('WORLD_RP_ID is not set');
    const { result, credentials } = this.checkShape(proof);

    let res: Response;
    try {
      res = await fetch(`${this.opts.baseUrl}/api/v4/verify/${this.opts.rpId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Forwarded as-is (IDKit 4 needs no reshaping); environment pinned to ours.
        body: JSON.stringify({ ...result, environment: this.opts.environment }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new ServiceUnavailableException(`World ID verify unreachable: ${(err as Error).message}`);
    }
    const body = (await res
      .json()
      .catch(() => ({ success: false, detail: `HTTP ${res.status}` }))) as VerifyResponse;

    if (!res.ok || !body.success) {
      const why =
        body.results?.find((r) => !r.success)?.detail ?? body.detail ?? body.code ?? `HTTP ${res.status}`;
      this.log.warn(
        `World ID rejected a ${result.protocol_version} proof: ${body.code ?? res.status} ${why}`,
      );
      throw new UnauthorizedException(`World ID verification failed: ${why}`);
    }
    if (body.environment && body.environment !== this.opts.environment) {
      throw new UnauthorizedException(`Proof is for ${body.environment}, expected ${this.opts.environment}`);
    }
    // World may report success if any one credential passes; we need the human credential itself.
    const human = body.results?.find((r) => r.success && credentials.includes(r.identifier));
    const nullifier = human?.nullifier ?? (body.results ? undefined : body.nullifier);
    if (!nullifier) throw new UnauthorizedException('Proof of Human was not verified');
    // World's answer is the authority; the browser's copy should match it. Flag it if not.
    const claimed = result.responses.find((x) => credentials.includes(x.identifier))?.nullifier;
    if (claimed && !sameField(claimed, nullifier)) {
      this.log.warn("World returned a different nullifier than the proof carried; using World's");
    }

    // Normalise (hex or decimal) so one human always maps to one pseudonym per protocol version.
    const version = result.protocol_version === '4.0' ? 'v4' : 'v3';
    return { nullifier: `world:${version}:${BigInt(nullifier).toString()}`, method: 'world' };
  }

  private checkShape(proof: unknown): { result: IdkitResult; credentials: string[] } {
    const r = proof as Partial<IdkitResult> | null;
    if (!r || typeof r !== 'object' || !Array.isArray(r.responses)) {
      throw new UnauthorizedException('Missing World ID proof');
    }
    const version = r.protocol_version ?? '';
    if (version === '3.0' && !this.opts.allowLegacy) {
      throw new UnauthorizedException(
        'World App returned a legacy World ID 3.0 proof; this server only accepts 4.0 (set WORLD_ALLOW_LEGACY_PROOFS=true to allow Orb 3.0 proofs)',
      );
    }
    const credentials = CREDENTIALS[version];
    if (!credentials || !r.action) {
      throw new UnauthorizedException('Only World ID uniqueness proofs (with an action) are accepted');
    }
    if (r.action !== this.opts.action) {
      throw new UnauthorizedException(`Proof is for action "${r.action}", expected "${this.opts.action}"`);
    }
    if (r.environment && r.environment !== this.opts.environment) {
      throw new UnauthorizedException(`Proof is for ${r.environment}, expected ${this.opts.environment}`);
    }
    const human = r.responses.find((x) => credentials.includes(x.identifier));
    if (!human) {
      const got = r.responses.map((x) => x.identifier).join(', ') || 'none';
      throw new UnauthorizedException(`Proof of Human credential is required (got: ${got})`);
    }
    if (!human.signal_hash || !sameField(human.signal_hash, this.expectedSignalHash)) {
      throw new UnauthorizedException('Proof is not bound to the KneeDeep signal');
    }
    return { result: r as IdkitResult, credentials };
  }
}
