import { Inject, Injectable, Logger } from '@nestjs/common';
import type { RequestHandler } from 'express';
import type { Network } from '@x402/core/types';
import { APP_CONFIG, AppConfig } from '../config/config';
import { hashscanTxUrl } from '../hedera/keys';
import { QueriesRepository } from '../queries/queries.repository';
import { createConditionsPaywall, HBAR } from './paywall';

export interface PriceQuote {
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  facilitator: string;
}

@Injectable()
export class PaymentsService {
  private readonly log = new Logger(PaymentsService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly queries: QueriesRepository,
  ) {}

  /** Paid endpoints need somewhere to send the money. Without it they refuse to serve (never free). */
  get enabled(): boolean {
    return Boolean(this.config.HEDERA_ACCOUNT_ID);
  }

  get quote(): PriceQuote | undefined {
    if (!this.config.HEDERA_ACCOUNT_ID) return undefined;
    return {
      network: this.config.HEDERA_NETWORK,
      asset: HBAR,
      amount: this.config.CONDITIONS_PRICE_TINYBARS.toString(),
      payTo: this.config.HEDERA_ACCOUNT_ID,
      facilitator: this.config.FACILITATOR_URL,
    };
  }

  /** Express middleware installed in main.ts; a no-op pass-through when payments are not configured. */
  middleware(): RequestHandler {
    if (!this.config.HEDERA_ACCOUNT_ID) {
      this.log.warn('HEDERA_ACCOUNT_ID not set: paid endpoints will answer 503');
      return (_req, _res, next) => next();
    }
    return createConditionsPaywall({
      facilitatorUrl: this.config.FACILITATOR_URL,
      network: this.config.HEDERA_NETWORK as Network,
      payTo: this.config.HEDERA_ACCOUNT_ID,
      priceTinybars: this.config.CONDITIONS_PRICE_TINYBARS,
      onSettled: async (queryId, s) => {
        try {
          const updated = await this.queries.markPaid(queryId, s);
          this.log.log(
            `Query ${queryId} paid by ${s.payer ?? 'unknown'}: ${hashscanTxUrl(s.network, s.txId)}` +
              (updated ? '' : ' (already recorded)'),
          );
        } catch (err) {
          // Funds already moved onchain; never fail the paid response over bookkeeping. Log loudly instead.
          this.log.error(`Query ${queryId} settled as ${s.txId} but could not be recorded: ${String(err)}`);
        }
      },
      onSettleFailed: (queryId, error) => {
        this.log.warn(`Settlement failed for query ${queryId ?? '(none)'}: ${error.message}`);
      },
    });
  }
}
