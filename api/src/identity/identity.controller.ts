import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { signRequest } from './idkit';
import { APP_CONFIG, AppConfig } from '../config/config';
import { HUMAN_VERIFIER, HumanVerifier, WORLD_SIGNAL } from './human-verifier';
import { SessionsService } from './sessions.service';

@Controller('v1/identity')
export class IdentityController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(HUMAN_VERIFIER) private readonly verifier: HumanVerifier,
    private readonly sessions: SessionsService,
  ) {}

  /**
   * Everything the browser needs to start an IDKit request. The RP signature is made
   * here: the signing key never leaves the server. Signatures live 5 minutes.
   */
  @Get('context')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  context() {
    if (this.verifier.name === 'dev') return { mode: 'dev' as const };
    const {
      WORLD_APP_ID,
      WORLD_RP_ID,
      WORLD_RP_SIGNING_KEY,
      WORLD_ACTION,
      WORLD_ENVIRONMENT,
      WORLD_ALLOW_LEGACY_PROOFS,
    } = this.config;
    if (!WORLD_APP_ID || !WORLD_RP_ID || !WORLD_RP_SIGNING_KEY) {
      throw new ServiceUnavailableException('World ID is not configured');
    }
    const sig = signRequest({ action: WORLD_ACTION, signingKeyHex: WORLD_RP_SIGNING_KEY });
    return {
      mode: 'world' as const,
      app_id: WORLD_APP_ID,
      action: WORLD_ACTION,
      environment: WORLD_ENVIRONMENT,
      signal: WORLD_SIGNAL,
      allow_legacy_proofs: WORLD_ALLOW_LEGACY_PROOFS,
      rp_context: {
        rp_id: WORLD_RP_ID,
        nonce: sig.nonce,
        created_at: sig.createdAt,
        expires_at: sig.expiresAt,
        signature: sig.sig,
      },
    };
  }

  /** 200 if the session in `Authorization: Bearer …` is still valid in the current mode, else 401. */
  @Get('me')
  me(@Headers('authorization') auth: string | undefined) {
    return this.sessions.describe(auth);
  }

  /** Exchange a proof of human (the IDKit result, untouched) for a reporter session. */
  @Post('session')
  @HttpCode(201)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  open(@Body() body: { proof?: unknown }) {
    return this.sessions.open(body?.proof);
  }
}
