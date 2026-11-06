/**
 * KneeDeep client for agents: discovers the paid endpoint, pays per query via
 * x402 on Hedera with its own key, and never needs a human to approve.
 */
import { decodePaymentResponseHeader, wrapFetchWithPaymentFromConfig } from '@x402/fetch';
import { createClientHederaSigner, ExactHederaScheme, HBAR_ASSET_ID, PrivateKey } from '@x402/hedera';

export interface Catalog {
  service: string;
  endpoints: {
    id: string;
    method: string;
    path: string;
    payment: { network: string; asset: string; amount: string; payTo: string } | null;
  }[];
}

export type Level = 'dry' | 'ankle' | 'knee' | 'waist' | 'closed';
export type Passability = 'safe' | 'risky' | 'blocked' | 'unknown';
export type Vehicle = 'two_wheeler';

export interface Area {
  cell: string;
  center: { lat: number; lng: number };
  distanceM: number;
  /** Null when contested: treat as unknown, not as safe. */
  level: Level | null;
  confidence: number;
  confidenceLabel: 'high' | 'medium' | 'low';
  explanation: string;
  /** Computed by KneeDeep from the evidence for the requested vehicle. */
  passability: Passability;
  passabilityReason: string;
  evidenceAgeMin: number;
  inputs: { supportingHumans: number; newestAgeMin: number; disputes: number };
  source: 'live' | 'simulated' | 'mixed';
}

export interface ConditionsAnswer {
  queryId: string;
  generatedAt: string;
  dataStatus: 'live' | 'simulated' | 'mixed' | 'empty';
  notices: string[];
  /** One verdict for the queried point: the worst area within the radius decides (unknown if none). */
  assessment: { vehicle: Vehicle; passability: Passability; reason: string; decidedBy: string | null };
  areas: Area[];
}

export interface PaidAnswer {
  answer: ConditionsAnswer;
  payment?: { txId: string; payer?: string; network: string; hashscan: string };
}

export interface AgentWallet {
  accountId: string;
  privateKey: string;
  keyType: 'ECDSA' | 'ED25519';
  network: 'hedera:testnet' | 'hedera:mainnet';
  /** Hard cap per query in tinybars. The client refuses to sign anything above it. */
  maxTinybarsPerQuery: bigint;
}

function parseKey(raw: string, type: 'ECDSA' | 'ED25519') {
  const hex = raw.trim().replace(/^0x/, '');
  if (hex.startsWith('30')) return PrivateKey.fromStringDer(hex);
  return type === 'ECDSA' ? PrivateKey.fromStringECDSA(hex) : PrivateKey.fromStringED25519(hex);
}

/** "0.0.123@1700000000.000000042" -> HashScan link using the dashed id "0.0.123-1700000000-000000042". */
export function hashscanTx(network: string, txId: string): string {
  const [account, ts = ''] = txId.split('@');
  const [secs, nanos = '0'] = ts.split('.');
  const dashed = ts ? `${account}-${secs}-${nanos}` : txId;
  return `https://hashscan.io/${network.replace('hedera:', '')}/transaction/${dashed}`;
}

export class KneeDeepClient {
  private readonly paidFetch: typeof fetch;

  constructor(
    private readonly baseUrl: string,
    private readonly wallet: AgentWallet,
  ) {
    const signer = createClientHederaSigner(wallet.accountId, parseKey(wallet.privateKey, wallet.keyType), {
      network: wallet.network,
    });
    this.paidFetch = wrapFetchWithPaymentFromConfig(fetch, {
      schemes: [{ network: wallet.network, client: new ExactHederaScheme(signer) }],
      // HBAR is not one of x402's default (USD-pegged) assets, so allow it explicitly, with a cap.
      spendControls: {
        allowedAssets: [
          {
            network: wallet.network,
            asset: HBAR_ASSET_ID,
            maxAmountPerPayment: wallet.maxTinybarsPerQuery.toString(),
          },
        ],
      },
    });
  }

  /** Free. Tells the agent what is for sale and the expected price before it pays. */
  async discover(): Promise<Catalog['endpoints'][number]> {
    const res = await fetch(`${this.baseUrl}/v1`, { signal: AbortSignal.timeout(10_000) }).catch(() => {
      throw new Error(
        `Cannot reach the KneeDeep API at ${this.baseUrl}. Start it in another terminal: npm run dev`,
      );
    });
    if (!res.ok) throw new Error(`Catalog ${res.status}`);
    const catalog = (await res.json()) as Catalog;
    const endpoint = catalog.endpoints.find((e) => e.id === 'conditions');
    if (!endpoint?.payment) throw new Error('KneeDeep does not offer a paid conditions endpoint right now');
    if (BigInt(endpoint.payment.amount) > this.wallet.maxTinybarsPerQuery) {
      throw new Error(
        `Price ${endpoint.payment.amount} tinybars exceeds this agent's cap of ${this.wallet.maxTinybarsPerQuery}`,
      );
    }
    return endpoint;
  }

  /** Paid. 402 -> sign HBAR transfer -> retry -> answer + settled transaction. */
  async conditions(
    lat: number,
    lng: number,
    radiusM: number,
    vehicle: Vehicle = 'two_wheeler',
  ): Promise<PaidAnswer> {
    const url = `${this.baseUrl}/v1/conditions?lat=${lat}&lng=${lng}&radius=${radiusM}&vehicle=${vehicle}`;
    const res = await this.paidFetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`GET /v1/conditions -> ${res.status}: ${(await res.text()).slice(0, 300)}`);

    const header = res.headers.get('PAYMENT-RESPONSE');
    const settle = header ? decodePaymentResponseHeader(header) : undefined;
    return {
      answer: (await res.json()) as ConditionsAnswer,
      payment: settle?.success
        ? {
            txId: settle.transaction,
            payer: settle.payer,
            network: settle.network,
            hashscan: hashscanTx(settle.network, settle.transaction),
          }
        : undefined,
    };
  }

  /**
   * Free, but authenticated: record this trip's decision on the KneeDeep dashboard. The token
   * (AGENT_API_TOKEN, shared with the server) keeps the public from posting made-up trips.
   */
  async recordTrip(trip: unknown, token: string): Promise<{ id: string }> {
    const res = await fetch(`${this.baseUrl}/v1/trips`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(trip),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`POST /v1/trips -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as { id: string };
  }
}
