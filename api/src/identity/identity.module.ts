import { Global, Logger, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/config';
import { DevVerifier } from './dev.verifier';
import { HUMAN_VERIFIER, HumanVerifier } from './human-verifier';
import { IdentityController } from './identity.controller';
import { SessionsService } from './sessions.service';
import { WorldIdVerifier } from './world-id.verifier';

@Global()
@Module({
  providers: [
    {
      provide: HUMAN_VERIFIER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): HumanVerifier => {
        const log = new Logger('Identity');
        if (config.REPORTER_VERIFIER === 'dev') {
          log.warn('REPORTER_VERIFIER=dev: no proof of human; all reports are SIMULATED');
          return new DevVerifier();
        }
        log.log(
          `World ID verification (${config.WORLD_ENVIRONMENT}, action "${config.WORLD_ACTION}", ` +
            `legacy 3.0 proofs ${config.WORLD_ALLOW_LEGACY_PROOFS ? 'allowed' : 'rejected'})`,
        );
        return new WorldIdVerifier({
          rpId: config.WORLD_RP_ID,
          action: config.WORLD_ACTION,
          environment: config.WORLD_ENVIRONMENT,
          baseUrl: config.WORLD_VERIFY_BASE_URL,
          allowLegacy: config.WORLD_ALLOW_LEGACY_PROOFS,
        });
      },
    },
    SessionsService,
  ],
  controllers: [IdentityController],
  exports: [HUMAN_VERIFIER, SessionsService],
})
export class IdentityModule {}
