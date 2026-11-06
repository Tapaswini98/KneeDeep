import { Global, Logger, Module, NotImplementedException } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/config';
import { DevVerifier } from './dev.verifier';
import { HUMAN_VERIFIER, HumanVerifier } from './human-verifier';

/** Fails closed: until World ID verification is wired (S4), 'world' mode accepts nobody. */
class WorldIdNotWiredVerifier implements HumanVerifier {
  readonly name = 'world' as const;
  async verify(): Promise<never> {
    throw new NotImplementedException('World ID verification is not wired yet');
  }
}

@Global()
@Module({
  providers: [
    {
      provide: HUMAN_VERIFIER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): HumanVerifier => {
        if (config.REPORTER_VERIFIER === 'dev') {
          new Logger('Identity').warn('REPORTER_VERIFIER=dev: no proof of human; all reports are SIMULATED');
          return new DevVerifier();
        }
        return new WorldIdNotWiredVerifier();
      },
    },
  ],
  exports: [HUMAN_VERIFIER],
})
export class IdentityModule {}
