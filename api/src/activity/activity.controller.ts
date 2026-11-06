import { Controller, Get, Inject, Query } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/config';
import { hashscanTxUrl } from '../hedera/keys';
import { PaymentsService } from '../payments/payments.service';
import { PayoutsRepository } from '../payouts/payouts.repository';
import { QueriesRepository } from '../queries/queries.repository';

/**
 * GET /v1/activity  (free). What agents asked, what they were told, the Hedera transaction that
 * paid for it, and the batched payouts to reporters. Feeds the live dashboard.
 */
@Controller('v1/activity')
export class ActivityController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly queries: QueriesRepository,
    private readonly payments: PaymentsService,
    private readonly payouts: PayoutsRepository,
  ) {}

  @Get()
  async activity(@Query('limit') limitRaw?: string) {
    const limit = Math.min(Math.max(Number(limitRaw) || 20, 1), 100);
    const [recent, totals, payouts, payoutTotals] = await Promise.all([
      this.queries.recent(limit),
      this.queries.totals(),
      this.payouts.recent(5),
      this.payouts.totals(),
    ]);
    return {
      generatedAt: new Date().toISOString(),
      price: this.payments.quote ?? null,
      totals,
      queries: recent.map((q) => ({
        ...q,
        hashscan: q.paymentTxId && q.network ? hashscanTxUrl(q.network, q.paymentTxId) : null,
      })),
      payouts: {
        reporterSharePercent: this.config.REPORTER_SHARE_PERCENT,
        ...payoutTotals,
        recent: payouts.map((p) => ({
          ...p,
          hashscan: p.txId && p.network && p.status === 'settled' ? hashscanTxUrl(p.network, p.txId) : null,
        })),
      },
    };
  }
}
