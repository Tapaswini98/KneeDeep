import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { APP_CONFIG, AppConfig } from '../config/config';
import { HederaService } from '../hedera/hedera.service';
import { PayoutsService } from './payouts.service';

/** Runs a payout batch every PAYOUT_INTERVAL_MINUTES (0 disables it; `npm run payout` runs one now). */
@Injectable()
export class PayoutsScheduler implements OnApplicationBootstrap {
  private readonly log = new Logger(PayoutsScheduler.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly hedera: HederaService,
    private readonly payouts: PayoutsService,
    private readonly registry: SchedulerRegistry,
  ) {}

  onApplicationBootstrap() {
    const minutes = this.config.PAYOUT_INTERVAL_MINUTES;
    if (minutes === 0) {
      this.log.log('Automatic payouts off (PAYOUT_INTERVAL_MINUTES=0); run them with: npm run payout');
      return;
    }
    if (!this.hedera.configured) {
      this.log.warn('Automatic payouts off: the platform Hedera account is not configured');
      return;
    }
    this.registry.addInterval(
      'reporter-payouts',
      setInterval(() => void this.tick(), minutes * 60_000),
    );
    this.log.log(
      `Reporter payouts every ${minutes} min (${this.config.REPORTER_SHARE_PERCENT}% of each paid query)`,
    );
  }

  private async tick() {
    try {
      const outcome = await this.payouts.runBatch();
      if (outcome.status === 'waiting') this.log.log(outcome.reason);
    } catch (err) {
      this.log.error(`Payout run failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
