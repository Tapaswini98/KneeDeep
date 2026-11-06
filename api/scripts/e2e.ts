/**
 * End-to-end check of the running stack (by default the Docker app on :8080), against the
 * real services: World ID's verify API, Arkiv, Hedera testnet and the x402 facilitator.
 *
 *   npm run demo            start everything, seed the demo, run these checks
 *   npm run demo:check      checks only (stack already running)
 *     --no-seed             don't write the demo scenario first
 *     --quick               skip the 2-3 minute expiry check
 *     --base=http://host    another deployment (default http://localhost:8080)
 *
 * Spends 0.2 testnet HBAR from the agent account (two paid queries).
 */
import { ExpirationTime, NoEntityFoundError } from '@arkiv-network/sdk';
import { asc } from '@arkiv-network/sdk/query';
import { u64 } from '@arkiv-network/sdk/schema';
import { Client } from 'pg';
import { KneeDeepClient } from '../../agent/src/kneedeep';
import { planTrip } from '../../agent/src/planner';
import { ROUTES } from '../../agent/src/routes';
import { arkivPublicClient, arkivWalletClient } from '../src/arkiv/client';
import { Reports } from '../src/arkiv/schemas';
import { readConfig } from '../src/config/config';
import { toCell } from '../src/geo/geo';
import { WORLD_SIGNAL } from '../src/identity/human-verifier';
import { hashSignal } from '../src/identity/idkit';
import { REPORTS, seedMonsoonEvening, simPseudonym } from './lib/demo-scenario';

const args = process.argv.slice(2);
const BASE = (args.find((a) => a.startsWith('--base='))?.slice(7) ?? 'http://localhost:8080').replace(
  /\/$/,
  '',
);
const SEED = !args.includes('--no-seed');
const QUICK = args.includes('--quick');

const config = readConfig();
const env = (name: string) => process.env[name]?.trim() || undefined;
const ANDHERI = REPORTS.find((r) => r.spot === 'Andheri subway')!;
const KALANAGAR = REPORTS.find((r) => r.spot === 'Kalanagar junction')!;
const COLABA = { lat: 18.9067, lng: 72.8147 };

// ---------------------------------------------------------------------------------------------
// Tiny test runner
// ---------------------------------------------------------------------------------------------
type Outcome = { name: string; ok: boolean; detail: string; ms: number };
const results: Outcome[] = [];

async function check(name: string, fn: () => Promise<string>): Promise<void> {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail, ms: Date.now() - started });
    console.log(`  \x1b[32m✓\x1b[0m ${name}${detail ? `  \x1b[2m${detail}\x1b[0m` : ''}`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    results.push({ name, ok: false, detail, ms: Date.now() - started });
    console.log(`  \x1b[31m✗ ${name}\x1b[0m  ${detail}`);
  }
}

function section(title: string) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function http(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, { ...init, signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // HTML or empty
  }
  return { status: res.status, headers: res.headers, body: body as Record<string, unknown> };
}

const post = (path: string, body: unknown, token?: string) =>
  http(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

async function countRows(table: 'report_index' | 'vote_index'): Promise<number> {
  const db = new Client({ connectionString: config.DATABASE_URL });
  await db.connect();
  try {
    return Number((await db.query(`SELECT count(*) FROM ${table}`)).rows[0].count);
  } finally {
    await db.end();
  }
}

async function sql<T>(text: string, params: unknown[] = []): Promise<T[]> {
  const db = new Client({ connectionString: config.DATABASE_URL });
  await db.connect();
  try {
    return (await db.query(text, params)).rows as T[];
  } finally {
    await db.end();
  }
}

/** Public mirror node: retry transient failures (5xx, network) with backoff; 4xx is final. */
async function mirror<T>(path: string): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    let status = 0;
    try {
      const res = await fetch(`${config.HEDERA_MIRROR_NODE_URL}/api/v1${path}`, {
        signal: AbortSignal.timeout(10_000),
      });
      status = res.status;
      if (res.ok) return (await res.json()) as T;
    } catch {
      // network error or timeout: retry
    }
    if ((status >= 400 && status < 500) || attempt === 4) {
      throw new Error(`mirror node ${status || 'unreachable'} for ${path}`);
    }
    await sleep(1_500 * attempt);
  }
}

type MirrorTx = { transaction_id: string; result: string; transfers: { account: string; amount: number }[] };

/** "0.0.1@1700000000.000000042" -> "0.0.1-1700000000-000000042" */
const dashed = (txId: string) => {
  const [acct, ts] = txId.split('@');
  return `${acct}-${ts.replace('.', '-')}`;
};

/** The mirror node lags consensus by a few seconds: poll until the transaction is indexed. */
async function waitForMirrorTx(txId: string): Promise<MirrorTx> {
  for (let i = 0; ; i++) {
    try {
      return (await mirror<{ transactions: MirrorTx[] }>(`/transactions/${dashed(txId)}`)).transactions[0];
    } catch (err) {
      if (i >= 14) throw err;
      await sleep(2_000);
    }
  }
}

const latestTransfer = async (account: string) =>
  (
    await mirror<{ transactions: MirrorTx[] }>(
      `/transactions?account.id=${account}&transactiontype=CRYPTOTRANSFER&limit=1&order=desc`,
    )
  ).transactions[0]?.transaction_id;

// ---------------------------------------------------------------------------------------------

async function waitForStack() {
  process.stdout.write(`Waiting for ${BASE} `);
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${BASE}/health/live`, { signal: AbortSignal.timeout(2_000) });
      if (res.ok) return console.log('up.');
    } catch {
      // not up yet
    }
    process.stdout.write('.');
    await sleep(1_000);
  }
  throw new Error(`${BASE} did not come up within 2 minutes (npm run docker:logs)`);
}

async function main() {
  await waitForStack();

  const agentAccount = env('AGENT_HEDERA_ACCOUNT_ID');
  const agentKey = env('AGENT_HEDERA_PRIVATE_KEY');
  const agent =
    agentAccount && agentKey
      ? new KneeDeepClient(BASE, {
          accountId: agentAccount,
          privateKey: agentKey,
          keyType: (env('AGENT_HEDERA_KEY_TYPE') ?? 'ECDSA') as 'ECDSA',
          network: config.HEDERA_NETWORK as 'hedera:testnet',
          maxTinybarsPerQuery: BigInt(env('AGENT_MAX_TINYBARS_PER_QUERY') ?? '20000000'),
        })
      : null;

  // -------------------------------------------------------------------------------------------
  section('Platform');
  let mode = 'world';
  await check('Readiness: Postgres, Arkiv and Hedera are up', async () => {
    const { status, body } = await http('/health');
    const b = body as { ok: boolean; env?: string; arkiv: { detail?: string; error?: string } };
    assert(status === 200 && b.ok, `health not ok: ${JSON.stringify(body)}`);
    return `tier ${b.env}, ${b.arkiv.detail?.split(',')[0]}`;
  });
  await check('Web app is served (map and reporter page)', async () => {
    for (const path of ['/', '/report']) {
      const { status, headers } = await http(path);
      assert(status === 200 && headers.get('content-type')?.includes('text/html'), `${path} -> ${status}`);
    }
    return '/ and /report';
  });
  await check('Catalog advertises the paid endpoint and its price', async () => {
    const { body } = await http('/v1');
    const e = (body.endpoints as { id: string; payment: { amount: string; network: string } | null }[]).find(
      (x) => x.id === 'conditions',
    );
    assert(e?.payment, 'no paid conditions endpoint');
    return `${Number(e.payment.amount) / 1e8} HBAR on ${e.payment.network}`;
  });

  // -------------------------------------------------------------------------------------------
  section('World ID: only verified humans write');
  await check('IDKit context is signed on the server', async () => {
    const { body } = await http('/v1/identity/context');
    mode = String(body.mode);
    if (mode === 'dev') return 'dev mode (no World ID): skipping';
    const rp = body.rp_context as {
      rp_id: string;
      signature: string;
      expires_at: number;
      created_at: number;
    };
    assert(rp?.signature?.startsWith('0x'), 'no RP signature');
    return `${body.environment}, action "${body.action}", ${rp.rp_id}, valid ${rp.expires_at - rp.created_at}s`;
  });
  const reportsBefore = await countRows('report_index');
  await check('A report without a session is refused (401)', async () => {
    const { status } = await post('/v1/reports', { level: 'knee', lat: ANDHERI.lat, lng: ANDHERI.lng });
    assert(status === 401, `expected 401, got ${status}`);
    return '';
  });
  if (mode === 'world') {
    await check('A bot with a dev identity is refused (401)', async () => {
      const { status, body } = await post('/v1/identity/session', { proof: { devId: 'bot-flooder' } });
      assert(status === 401, `expected 401, got ${status}: ${JSON.stringify(body)}`);
      return String(body.message);
    });
    await check("A forged proof is rejected by World's verify API", async () => {
      const forged = {
        protocol_version: '4.0',
        nonce: '0x01',
        action: config.WORLD_ACTION,
        environment: config.WORLD_ENVIRONMENT,
        responses: [
          {
            identifier: 'proof_of_human',
            issuer_schema_id: 1,
            nullifier: '0x' + '12'.repeat(31),
            expires_at_min: Math.floor(Date.now() / 1000) + 3600,
            signal_hash: hashSignal(WORLD_SIGNAL),
            proof: ['0x1', '0x2', '0x3', '0x4', '0x5'],
          },
        ],
      };
      const { status, body } = await post('/v1/identity/session', { proof: forged });
      assert(status === 401, `expected 401, got ${status}`);
      assert(
        String(body.message).includes('World ID verification failed'),
        `not rejected by World: ${body.message}`,
      );
      return String(body.message).slice(0, 90);
    });
  }
  await check('Nothing was written by any refused attempt', async () => {
    const after = await countRows('report_index');
    assert(after === reportsBefore, `report_index grew from ${reportsBefore} to ${after}`);
    return `${after} rows before and after`;
  });

  // -------------------------------------------------------------------------------------------
  section('Arkiv: public, perishable data');
  if (SEED) {
    await check('Seed a SIMULATED monsoon evening onto Arkiv', async () => {
      assert(config.ARKIV_PRIVATE_KEY, 'ARKIV_PRIVATE_KEY not set');
      const wallet = arkivWalletClient(config.ARKIV_ACCESS_KEY, config.ARKIV_PRIVATE_KEY);
      const res = await seedMonsoonEvening(wallet, config.DATABASE_URL, config.REPORT_TTL_SECONDS);
      return `${res.reports} reports, ${res.votes} votes in 2 txs`;
    });
  }
  await check('The API serves the live reports (free)', async () => {
    const { body } = await http(`/v1/reports?lat=${ANDHERI.lat}&lng=${ANDHERI.lng}&radius=300`);
    const reports = body.reports as { level: string; source: string; explorer: { entity: string } }[];
    const knee = reports.filter((r) => r.level === 'knee');
    assert(knee.length >= 3, `expected ≥3 knee reports at Andheri subway, got ${knee.length}`);
    return `${knee.length} knee-deep reports at Andheri subway, e.g. ${knee[0].explorer.entity.slice(0, 60)}…`;
  });
  await check('Anyone can read the same data straight from Arkiv (no KneeDeep API)', async () => {
    const reader = arkivPublicClient(config.ARKIV_ACCESS_KEY);
    const writer = arkivWalletClient(config.ARKIV_ACCESS_KEY, config.ARKIV_PRIVATE_KEY!).account.address;
    const res = await reader
      .select({ $key: true, level: true, reporter: true })
      .from(Reports)
      .ownedBy(writer)
      .orderBy(asc('$key'))
      .limit(100)
      .fetch();
    const ours = res.entities.filter((e) => e.reporter.value === simPseudonym(ANDHERI.who));
    assert(ours.length > 0, 'seeded reports not found on Arkiv');
    return `${res.entities.length} live entities owned by ${writer.slice(0, 10)}…`;
  });

  // -------------------------------------------------------------------------------------------
  section('Hedera x402: agents pay per query');
  await check('An unpaid query gets 402 with a payment quote', async () => {
    const { status, headers } = await http(`/v1/conditions?lat=${ANDHERI.lat}&lng=${ANDHERI.lng}&radius=300`);
    const quote = headers.get('payment-required');
    assert(status === 402 && quote, `expected 402 + PAYMENT-REQUIRED, got ${status}`);
    const accepts = (
      JSON.parse(Buffer.from(quote, 'base64').toString()) as { accepts: { amount: string; payTo: string }[] }
    ).accepts[0];
    return `${Number(accepts.amount) / 1e8} HBAR to ${accepts.payTo}`;
  });

  let paidTx: string | undefined;
  let paidQueryId: string | undefined;
  let lastPaidTx: string | undefined;
  if (!agent) {
    await check('Agent pays and gets an answer', async () => {
      throw new Error('AGENT_HEDERA_ACCOUNT_ID / AGENT_HEDERA_PRIVATE_KEY not set');
    });
  } else {
    await check('The agent discovers, pays with its own key, and gets the flooded spot', async () => {
      await agent.discover();
      const { answer, payment } = await agent.conditions(ANDHERI.lat, ANDHERI.lng, 300);
      const area = answer.areas.find((a) => a.cell === toCell(ANDHERI.lat, ANDHERI.lng));
      assert(payment, 'no settled payment in PAYMENT-RESPONSE');
      assert(area?.level === 'knee', `expected knee at Andheri subway, got ${area?.level ?? 'nothing'}`);
      assert(area.confidenceLabel === 'high', `expected high confidence, got ${area.confidenceLabel}`);
      assert(
        answer.dataStatus === 'simulated',
        `seeded data must be labelled simulated, got ${answer.dataStatus}`,
      );
      paidTx = payment.txId;
      paidQueryId = answer.queryId;
      return `knee, ${area.confidence} high: "${area.explanation}"`;
    });
    await check('Simulated reports never earn (reporter payouts)', async () => {
      assert(paidQueryId, 'no paid query to inspect');
      const simulated = [...new Set(REPORTS.map((r) => simPseudonym(r.who)))];
      let paid = false;
      for (let i = 0; i < 10 && !paid; i++) {
        [{ paid }] = await sql<{ paid: boolean }>(
          'SELECT paid_at IS NOT NULL AS paid FROM queries WHERE id = $1',
          [paidQueryId],
        );
        if (!paid) await sleep(1_000);
      }
      assert(paid, 'query not recorded as paid');
      const [row] = await sql<{ used: number; earning: number; credited: number }>(
        `SELECT (SELECT count(*) FROM query_reports WHERE query_id = $1 AND reporter = ANY($2))::int AS used,
                (SELECT count(*) FROM query_reports WHERE query_id = $1 AND reporter = ANY($2) AND earns)::int AS earning,
                (SELECT count(*) FROM earnings WHERE query_id = $1 AND reporter = ANY($2))::int AS credited`,
        [paidQueryId, simulated],
      );
      assert(row.used > 0, 'the answer used no simulated reports');
      assert(row.earning === 0 && row.credited === 0, `${row.credited} simulated reporter(s) credited`);
      return `${row.used} simulated reports used, 0 credited`;
    });
    await check('Hedera mirror node confirms the settlement', async () => {
      assert(paidTx, 'no payment to look up');
      const tx = await waitForMirrorTx(paidTx);
      const toPlatform = tx.transfers.find((t) => t.account === config.HEDERA_ACCOUNT_ID)?.amount ?? 0;
      assert(tx.result === 'SUCCESS', `result ${tx.result}`);
      return `SUCCESS, +${toPlatform / 1e8} HBAR to ${config.HEDERA_ACCOUNT_ID}, https://hashscan.io/testnet/transaction/${dashed(paidTx)}`;
    });
    await check('The clear route reads dry', async () => {
      const { answer, payment } = await agent.conditions(KALANAGAR.lat, KALANAGAR.lng, 300);
      lastPaidTx = payment?.txId;
      const area = answer.areas.find((a) => a.cell === toCell(KALANAGAR.lat, KALANAGAR.lng));
      assert(area?.level === 'dry', `expected dry at Kalanagar, got ${area?.level ?? 'nothing'}`);
      return `dry, ${area.confidence} ${area.confidenceLabel}`;
    });
    await check('The dashboard feed shows the paid query with its HashScan link', async () => {
      const { body } = await http('/v1/activity?limit=5');
      const q = (
        body.queries as { paymentTxId: string | null; paid: boolean; hashscan: string | null }[]
      ).find((x) => x.paymentTxId === paidTx);
      assert(q?.paid && q.hashscan, 'paid query not in /v1/activity');
      return q.hashscan;
    });
    await check('An invalid paid query is refused and costs nothing', async () => {
      // Let earlier payments reach the mirror node first, so they are not mistaken for this one.
      if (lastPaidTx) await waitForMirrorTx(lastPaidTx);
      const before = await latestTransfer(agentAccount!);
      const err = await agent.conditions(28.6139, 77.209, 300).then(
        () => null,
        (e: Error) => e,
      );
      assert(err?.message.includes('400'), `expected a 400, got ${err?.message ?? 'success'}`);
      await sleep(8_000); // longer than mirror node lag
      const after = await latestTransfer(agentAccount!);
      assert(after === before, `a new agent transfer appeared: ${after}`);
      return 'Delhi query: 400, no transfer from the agent';
    });
  }

  // -------------------------------------------------------------------------------------------
  if (!QUICK && agent) {
    section('The dispatch agent decides');
    await check('It pays for every checkpoint on both routes and picks the dry one', async () => {
      const plan = await planTrip(agent, ROUTES, { radiusM: 250, budgetTinybars: 100_000_000n });
      const { choice } = plan.decision;
      assert(
        choice?.route.id === 'weh',
        `expected the Western Express Highway, got ${choice?.route.id ?? 'hold'}`,
      );
      assert(plan.payments.length === 6, `expected 6 payments, got ${plan.payments.length}`);
      return `${plan.payments.length} payments; "${plan.decision.explanation}"`;
    });
  }

  // -------------------------------------------------------------------------------------------
  if (!QUICK) {
    section('Truth expires');
    await check('A report disappears from Arkiv and the API when it expires (~2-3 min)', async () => {
      const wallet = arkivWalletClient(config.ARKIV_ACCESS_KEY, config.ARKIV_PRIVATE_KEY!);
      const reader = arkivPublicClient(config.ARKIV_ACCESS_KEY);
      const { entityKey } = await wallet.createEntity(
        Reports,
        {
          level: 'ankle',
          cell: toCell(COLABA.lat, COLABA.lng),
          reportedAt: u64(Math.floor(Date.now() / 1000)),
          reporter: simPseudonym('expiry-check'),
          source: 'simulated',
        },
        { expiration: ExpirationTime.fromMinutes(2) },
      );
      const visible = async () => {
        const { body } = await http(`/v1/reports?lat=${COLABA.lat}&lng=${COLABA.lng}&radius=200`);
        return (body.reports as { key: string }[]).some((r) => r.key === entityKey);
      };
      assert(await visible(), 'new report not visible');
      const started = Date.now();
      while (Date.now() - started < 240_000) {
        await sleep(10_000);
        if (!(await visible())) {
          const gone = await reader.getEntity(entityKey).then(
            () => false,
            (e) => e instanceof NoEntityFoundError,
          );
          assert(gone, 'gone from the API but still on Arkiv');
          return `gone after ${Math.round((Date.now() - started) / 1000)}s, no cleanup job`;
        }
      }
      throw new Error('still visible after 4 minutes');
    });
  }

  // -------------------------------------------------------------------------------------------
  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n\x1b[1m${results.length - failed.length}/${results.length} checks passed\x1b[0m` +
      (failed.length ? `, \x1b[31m${failed.length} failed\x1b[0m` : ''),
  );
  console.log(`
Now try it by hand:
  Map              ${BASE}
  Reporter page    ${BASE}/report
  1. Click "Verify you are human with World ID"${config.WORLD_ENVIRONMENT === 'staging' ? ' (simulator: https://simulator.worldcoin.org, give the identity an Orb credential, paste the QR link)' : ' and scan with World App'}.
  2. Report from your location; confirm or dispute a nearby report on the map.
  3. Watch the agent's queries and HashScan links in the map's side panel.
  4. Route decision: npm run demo:agent    Reporter payouts: npm run payout
`);
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
