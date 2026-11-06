import { BadRequestException, Controller, Get, Query, Res, ServiceUnavailableException } from '@nestjs/common';
import type { Response } from 'express';
import { QUERY_ID_HEADER } from '../payments/paywall';
import { PaymentsService } from '../payments/payments.service';
import { QueriesRepository } from '../queries/queries.repository';
import { conditionsQuerySchema } from './conditions.query';
import { ConditionsService } from './conditions.service';

/**
 * GET /v1/conditions?lat&lng&radius  (paid, x402)
 *
 * By the time this runs the x402 middleware has verified the payment; it settles
 * after we respond. A 4xx/5xx here cancels settlement, so failed queries are free.
 */
@Controller('v1/conditions')
export class ConditionsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly conditions: ConditionsService,
    private readonly queries: QueriesRepository,
  ) {}

  @Get()
  async get(@Query() raw: Record<string, string>, @Res({ passthrough: true }) res: Response) {
    if (!this.payments.enabled) throw new ServiceUnavailableException('Payments are not configured');

    const parsed = conditionsQuerySchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map((i) => i.message));
    const { lat, lng, radius } = parsed.data;

    const result = await this.conditions.answer(lat, lng, radius);
    const queryId = await this.queries.create({
      lat,
      lng,
      radiusM: radius,
      cells: result.cells,
      amountTinybars: BigInt(this.payments.quote!.amount),
      dataStatus: result.dataStatus,
      used: result.used,
    });
    res.setHeader(QUERY_ID_HEADER, queryId);
    return { queryId, ...result.body };
  }
}
