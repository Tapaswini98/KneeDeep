import { Controller, Get } from '@nestjs/common';
import { MAX_RADIUS_M, DEFAULT_RADIUS_M } from '../conditions/conditions.query';
import { PaymentsService } from '../payments/payments.service';

/**
 * GET /v1  (free). How an agent discovers what KneeDeep sells and what it costs,
 * before paying for anything. The 402 response carries the binding quote.
 */
@Controller('v1')
export class CatalogController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  catalog() {
    return {
      service: 'KneeDeep',
      description: 'Street-level truth for AI agents: verified, perishable, paid.',
      coverage: 'Mumbai',
      endpoints: [
        {
          id: 'conditions',
          method: 'GET',
          path: '/v1/conditions',
          params: {
            lat: 'number, required',
            lng: 'number, required',
            radius: `metres, optional, default ${DEFAULT_RADIUS_M}, max ${MAX_RADIUS_M}`,
          },
          payment: this.payments.quote
            ? { protocol: 'x402', version: 2, scheme: 'exact', ...this.payments.quote }
            : null,
          returns:
            'Per ~150 m cell: water level, confidence 0-1, and the inputs behind it ' +
            '(distinct reporters, report ages, confirmations, disputes).',
        },
      ],
    };
  }
}
