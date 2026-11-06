import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/config';
import { DbService } from '../db/db.service';
import { HUMAN_VERIFIER, HumanVerifier, pseudonymFor } from './human-verifier';

export interface Reporter {
  pseudonym: string;
  method: 'world' | 'dev';
}

interface Claims {
  sub: string;
  m: 'world' | 'dev';
  exp: number;
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url');

/**
 * A human proves they are unique once (World ID), then gets a short-lived signed session
 * for reporting and voting. The token carries only the pseudonym, never the nullifier.
 * Per-human limits (one report per cell per 30 min, one vote per report) key on the pseudonym.
 */
@Injectable()
export class SessionsService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(HUMAN_VERIFIER) private readonly verifier: HumanVerifier,
    private readonly db: DbService,
  ) {}

  private get salt(): string {
    if (!this.config.PSEUDONYM_SALT) throw new ServiceUnavailableException('PSEUDONYM_SALT is not set');
    return this.config.PSEUDONYM_SALT;
  }

  private get key(): Buffer {
    return createHash('sha256').update(`kneedeep-session:${this.salt}`).digest();
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.key).update(payload).digest('base64url');
  }

  /** Verify a proof of human and open a reporter session. */
  async open(proof: unknown) {
    const human = await this.verifier.verify(proof);
    const pseudonym = pseudonymFor(this.salt, human.nullifier);
    await this.db.query('INSERT INTO reporters (pseudonym) VALUES ($1) ON CONFLICT DO NOTHING', [pseudonym]);

    const exp = Math.floor(Date.now() / 1000) + Math.round(this.config.REPORTER_SESSION_HOURS * 3600);
    const payload = b64(JSON.stringify({ sub: pseudonym, m: human.method, exp } satisfies Claims));
    return {
      token: `${payload}.${this.sign(payload)}`,
      reporter: pseudonym.slice(0, 12),
      method: human.method,
      source: human.method === 'world' ? 'live' : 'simulated',
      expiresAt: new Date(exp * 1000).toISOString(),
    };
  }

  /** From an `Authorization: Bearer <token>` header. Throws 401 if absent, forged or expired. */
  authenticate(authorization: string | undefined): Reporter {
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) throw new UnauthorizedException('Verify with World ID first (missing reporter session)');
    const [payload, sig] = token.split('.');
    const expected = this.sign(payload ?? '');
    if (!payload || !sig || sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      throw new UnauthorizedException('Invalid reporter session');
    }
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Claims;
    if (claims.exp < Date.now() / 1000) throw new UnauthorizedException('Reporter session expired; verify again');
    // A dev session must never pass as a real human after switching to World ID mode.
    if (claims.m !== this.verifier.name) throw new UnauthorizedException('Session was issued by another verifier');
    return { pseudonym: claims.sub, method: claims.m };
  }
}
