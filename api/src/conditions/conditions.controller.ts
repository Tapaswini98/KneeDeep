import { BadRequestException, Controller, Get, Query, Res, ServiceUnavailableException } from '@nestjs/common';
import type { Response } from 'express';
import { prefixesCovering } from '../geo/geo';
import { QUERY_ID_HEADER } from '../payments/paywall';
import { PaymentsService } from '../payments/payments.service';
import { QueriesRepository } from '../queries/queries.repository';
import { conditionsQuerySchema } from './conditions.query';

/**
 * GET /v1/conditions?lat&lng&radius  (paid, x402)
 *
 * By the time this runs the x402 middleware has verified the payment; it settles
 * after we respond. A 4xx here cancels settlement, so invalid queries are free.
 */
@Controller('v1/conditions')
export class ConditionsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly queries: QueriesRepository,
  ) {}

  @Get()
  async get(@Query() raw: Record<string, string>, @Res({ passthrough: true }) res: Response) {
    if (!this.payments.enabled) throw new ServiceUnavailableException('Payments are not configured');

    const parsed = conditionsQuerySchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map((i) => i.message));
    const { lat, lng, radius } = parsed.data;
    const cells = prefixesCovering(lat, lng, radius);

    // S2 stub: the paid pipeline is real, the data is not yet. S3 replaces this with
    // Arkiv reads + the fusion engine. Labelled so it can never pass as live data.
    const dataStatus = 'stub' as const;
    const queryId = await this.queries.create({
      lat,
      lng,
      radiusM: radius,
      cells,
      amountTinybars: BigInt(this.payments.quote!.amount),
      dataStatus,
    });
    res.setHeader(QUERY_ID_HEADER, queryId);

    return {
      queryId,
      query: { lat, lng, radiusM: radius, searchedPrefixes: cells },
      generatedAt: new Date().toISOString(),
      dataStatus,
      notice: 'STUB ANSWER: no real observations yet. Do not route on this.',
      areas: [],
    };
  }
}
