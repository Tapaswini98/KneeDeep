import type { RequestHandler } from 'express';
import { HTTPFacilitatorClient } from '@x402/core/server';
import type { Network } from '@x402/core/types';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import { ExactHederaScheme } from '@x402/hedera/exact/server';

/** HBAR on Hedera; amounts are tinybars. */
export const HBAR = '0.0.0';

/** Set by the conditions handler so the after-settle hook knows which query was paid for. */
export const QUERY_ID_HEADER = 'x-kneedeep-query-id';

export const CONDITIONS_ROUTE = 'GET /v1/conditions';

export interface PaywallOptions {
  facilitatorUrl: string;
  network: Network;
  payTo: string;
  priceTinybars: bigint;
  onSettled: (
    queryId: string,
    settlement: { txId: string; payer?: string; network: string },
  ) => Promise<void>;
  onSettleFailed: (queryId: string | undefined, error: Error) => void;
}

/** Response headers the handler set, as the x402 HTTP transport hands them to settle hooks. */
function queryIdFrom(transportContext: unknown): string | undefined {
  const headers = (transportContext as { responseHeaders?: Record<string, string> } | undefined)
    ?.responseHeaders;
  return headers?.[QUERY_ID_HEADER];
}

/**
 * x402 v2 paywall for GET /v1/conditions, settling in HBAR on Hedera through a
 * facilitator (which pays the network fee). Flow per request:
 *   no payment  -> 402 with PAYMENT-REQUIRED
 *   payment     -> facilitator verifies -> handler runs -> facilitator settles -> response
 * If the handler fails (4xx/5xx) settlement is cancelled, so bad requests are never charged.
 */
export function createConditionsPaywall(opts: PaywallOptions): RequestHandler {
  const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: opts.facilitatorUrl })).register(
    opts.network,
    new ExactHederaScheme(),
  );

  server.onAfterSettle(async ({ result, transportContext }) => {
    const queryId = queryIdFrom(transportContext);
    if (!queryId) return;
    await opts.onSettled(queryId, { txId: result.transaction, payer: result.payer, network: result.network });
  });

  server.onSettleFailure(async ({ error, transportContext }) => {
    opts.onSettleFailed(queryIdFrom(transportContext), error);
  });

  return paymentMiddleware(
    {
      [CONDITIONS_ROUTE]: {
        accepts: {
          scheme: 'exact',
          network: opts.network,
          payTo: opts.payTo,
          price: { asset: HBAR, amount: opts.priceTinybars.toString() },
          // Hedera transactions are valid for 120 s from creation.
          maxTimeoutSeconds: 120,
        },
        description:
          'Street-level conditions (waterlogging, closures) near a point in Mumbai, from verified humans, ' +
          'with an explainable confidence score per ~150 m cell.',
        mimeType: 'application/json',
        serviceName: 'KneeDeep',
        tags: ['mumbai', 'flooding', 'routing', 'street-conditions'],
      },
    },
    server,
  ) as RequestHandler;
}
