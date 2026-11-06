/** Same-origin in dev (Vite proxies /v1 and /health to the API). Set VITE_API_URL when hosted separately. */
const BASE = import.meta.env.VITE_API_URL ?? '';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

let onUnauthorized: (() => void) | null = null;

/** Called whenever an authenticated request gets 401: the reporter session is no longer valid. */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

export async function api<T>(path: string, init?: RequestInit & { token?: string }): Promise<T> {
  const { token, ...rest } = init ?? {};
  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...rest.headers,
    },
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (res.status === 401 && token) onUnauthorized?.();
  if (!res.ok) {
    const message =
      (body as { message?: string | string[] } | undefined)?.message ?? `${res.status} ${res.statusText}`;
    throw new ApiError(res.status, Array.isArray(message) ? message.join(', ') : message);
  }
  return body as T;
}

export interface Health {
  ok: boolean;
  env?: 'development' | 'staging' | 'production';
  worldEnvironment?: 'production' | 'staging';
  postgres: { ok: boolean };
  arkiv: { ok: boolean; detail?: string };
  hedera: { ok: boolean; detail?: string };
}

export interface LiveReport {
  key: string;
  level: string;
  cell: string;
  center: { lat: number; lng: number };
  source: 'live' | 'simulated';
  reportedAt: string;
  ageMin: number;
  confirmations: number;
  disputes: number;
  /** Prefix of the reporter's pseudonym; equals ReporterSession.reporter for your own reports. */
  reporter: string;
  voters: { voter: string; vote: 'confirm' | 'dispute' }[];
  expiresInMin: number;
  explorer: { entity: string; tx: string | null };
}

export interface LiveReports {
  generatedAt: string;
  arkivBlock: string;
  writer: string | null;
  writerExplorer: string | null;
  reports: LiveReport[];
}

export interface AreaSummary {
  cell: string;
  level: string | null;
  confidence: number;
  confidenceLabel: 'high' | 'medium' | 'low';
  explanation: string;
  source: 'live' | 'simulated' | 'mixed';
}

export interface AgentQuery {
  id: string;
  createdAt: string;
  lat: number;
  lng: number;
  radiusM: number;
  dataStatus: 'live' | 'simulated' | 'mixed' | 'empty' | 'stub';
  amountTinybars: string;
  paid: boolean;
  paymentTxId: string | null;
  payer: string | null;
  hashscan: string | null;
  reportsUsed: number;
  corroboratedUsed: number;
  reportersCredited: number;
  summary: AreaSummary[];
}

export interface PayoutBatch {
  id: string;
  status: 'pending' | 'submitted' | 'settled' | 'failed';
  txId: string | null;
  totalTinybars: string;
  recipients: number;
  createdAt: string;
  settledAt: string | null;
  error: string | null;
  hashscan: string | null;
}

export interface Activity {
  generatedAt: string;
  price: { network: string; amount: string; payTo: string } | null;
  totals: { paidQueries: number; revenueTinybars: string };
  queries: AgentQuery[];
  payouts: {
    reporterSharePercent: number;
    paidOutTinybars: string;
    owedTinybars: string;
    batches: number;
    recent: PayoutBatch[];
  };
}

/** GET /v1/reporters/me: the signed-in reporter's earnings. Amounts are tinybars. */
export interface ReporterEarnings {
  reporter: string;
  earns: boolean;
  rule: string;
  payoutAccount: string | null;
  payoutAccountUrl: string | null;
  queriesCredited: number;
  owedTinybars: string;
  inFlightTinybars: string;
  paidTinybars: string;
  payouts: { id: string; amountTinybars: string; settledAt: string | null; hashscan: string | null }[];
}

export const formatHbar = (tinybars: string | number) =>
  `${(Number(tinybars) / 1e8).toLocaleString(undefined, { maximumFractionDigits: 4 })} HBAR`;

/** GET /v1/reporters/me/activity: the signed-in reporter's own reports and votes. */
export interface MyReport {
  key: string;
  level: string;
  cell: string;
  center: { lat: number; lng: number };
  source: 'live' | 'simulated';
  reportedAt: string;
  expiresAt: string | null;
  live: boolean;
  confirmations: number;
  disputes: number;
  paidAnswers: number;
  earningAnswers: number;
  earnedTinybars: string;
  explorer: { entity: string; tx: string | null };
}

export interface MyVote {
  key: string;
  vote: 'confirm' | 'dispute';
  votedAt: string;
  reportEarned: boolean;
  report: {
    key: string;
    level: string | null;
    source: 'live' | 'simulated' | null;
    live: boolean;
    center: { lat: number; lng: number };
  } | null;
  explorer: { entity: string; report: string };
}

export interface MyActivity {
  reporter: string;
  summary: {
    reports: number;
    liveReports: number;
    confirmationsReceived: number;
    disputesReceived: number;
    votes: number;
    paidAnswers: number;
    earnedTinybars: string;
  };
  reports: MyReport[];
  votes: MyVote[];
}

/** GET /v1/verification: the latest independent Chainlink CRE attestation, checked against KneeDeep. */
export interface VerifiedArea {
  cell: string;
  attested: { level: string | null; confidence: number; supporters: number; reports: number };
  kneedeep: { level: string | null; confidence: number } | null;
  status: 'match' | 'mismatch' | 'not-served';
}

export type Verification =
  | { enabled: false; reason: string }
  | {
      enabled: true;
      contract: string;
      contractUrl: string;
      attestations: number;
      asOf: string;
      ageMin: number;
      arkivBlock: string;
      evidenceHash: string;
      reports: number;
      votes: number;
      summary: { areas: number; match: number; mismatch: number; notServed: number };
      areas: VerifiedArea[];
      note: string;
    };
