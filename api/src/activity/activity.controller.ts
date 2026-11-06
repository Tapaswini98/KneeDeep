import { Controller, Get, Query } from '@nestjs/common';
import { hashscanTxUrl } from '../hedera/keys';
import { PaymentsService } from '../payments/payments.service';
import { QueriesRepository } from '../queries/queries.repository';

/**
 * GET /v1/activity  (free). What agents asked, what they were told, and the Hedera
 * transaction that paid for it. Feeds the live dashboard.
 */
@Controller('v1/activity')
export class ActivityController {
  constructor(
    private readonly queries: QueriesRepository,
    private readonly payments: PaymentsService,
  ) {}

  @Get()
  async activity(@Query('limit') limitRaw?: string) {
    const limit = Math.min(Math.max(Number(limitRaw) || 20, 1), 100);
    const [recent, totals] = await Promise.all([this.queries.recent(limit), this.queries.totals()]);
    return {
      generatedAt: new Date().toISOString(),
      price: this.payments.quote ?? null,
      totals,
      queries: recent.map((q) => ({
        ...q,
        hashscan: q.paymentTxId && q.network ? hashscanTxUrl(q.network, q.paymentTxId) : null,
      })),
    };
  }
}
