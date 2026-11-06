/**
 * Deployment preflight: is this configuration safe and complete, are its accounts funded, and
 * (with --url) is the live deployment answering correctly?
 *
 *   npm run deploy:check -- --env deploy/.env
 *   npm run deploy:check -- --env deploy/.env --url https://kneedeep.example.com
 *   npm run deploy:check -- --url https://kneedeep.example.com --skip-config   (live checks only)
 *
 * Reads ONLY the given env file (never your local .env). Prints PASS / WARN / FAIL per check and
 * exits non-zero on any FAIL. Never prints secrets.
 */
import { Client } from 'pg';
import { arkivPublicClient } from '../src/arkiv/client';
import { viemAccounts } from '../src/arkiv/viem';
import { readConfig } from '../src/config/config';
import { parsePrivateKey } from '../src/hedera/keys';
import { fetchAccount } from '../src/hedera/mirror';
import { signRequest } from '../src/identity/idkit';

const args = process.argv.slice(2);
const flag = (name: string) =>
  args
    .find((a) => a.startsWith(`--${name}=`))
    ?.split('=')
    .slice(1)
    .join('=') ?? (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
// Not --env-file: Node (and so tsx) claims that flag for itself.
const envFile = flag('env');
const url = flag('url')?.replace(/\/$/, '');
const skipConfig = args.includes('--skip-config');

type Level = 'PASS' | 'WARN' | 'FAIL';
const results: { level: Level; name: string; detail: string }[] = [];
const COLOR: Record<Level, string> = { PASS: '\x1b[32m', WARN: '\x1b[33m', FAIL: '\x1b[31m' };

function report(level: Level, name: string, detail = '') {
  results.push({ level, name, detail });
  console.log(`  ${COLOR[level]}${level}\x1b[0m ${name}${detail ? `  \x1b[2m${detail}\x1b[0m` : ''}`);
}

async function step(name: string, fn: () => Promise<{ level?: Level; detail?: string } | string | void>) {
  try {
    const out = await fn();
    if (typeof out === 'string' || out === undefined) report('PASS', name, out ?? '');
    else report(out.level ?? 'PASS', name, out.detail ?? '');
  } catch (err) {
    report('FAIL', name, err instanceof Error ? err.message : String(err));
  }
}

const section = (title: string) => console.log(`\n\x1b[1m${title}\x1b[0m`);
const hbar = (tinybars: bigint) => `${Number(tinybars) / 1e8} HBAR`;

async function configChecks() {
  if (!envFile) throw new Error('Pass --env <path> (e.g. deploy/.env), or --skip-config with --url');
  // Config is read when readConfig() runs, from this file only.
  process.env.KNEEDEEP_ENV_FILE = envFile;

  section(`Configuration (${envFile})`);
  let config: ReturnType<typeof readConfig>;
  try {
    config = readConfig(); // strict: refuses unsafe staging/production settings
  } catch (err) {
    for (const line of String(err instanceof Error ? err.message : err).split('\n')) {
      if (line.trim()) report('FAIL', line.replace(/^\s*-\s*/, '').trim());
    }
    return;
  }

  report(
    config.APP_ENV === 'development' ? 'FAIL' : 'PASS',
    `Deployment tier: ${config.APP_ENV}`,
    config.APP_ENV === 'development'
      ? 'development accepts unverified identities; use staging or production'
      : config.APP_ENV === 'staging'
        ? 'World ID simulator, testnets'
        : 'real World App only',
  );
  report('PASS', 'Secrets present and not placeholders', 'salt, World RP key, Arkiv and Hedera keys');
  report(
    config.TRUST_PROXY > 0 ? 'PASS' : 'WARN',
    `TRUST_PROXY=${config.TRUST_PROXY}`,
    config.TRUST_PROXY > 0
      ? 'client IPs come from the proxy header (per-IP rate limits work)'
      : 'behind a proxy or load balancer, set 1, or every visitor shares one rate limit',
  );
  report(
    config.MIGRATE_ON_BOOT ? 'PASS' : 'WARN',
    `MIGRATE_ON_BOOT=${config.MIGRATE_ON_BOOT}`,
    config.MIGRATE_ON_BOOT ? 'schema updates apply on start' : 'run npm run db:migrate before each release',
  );
  report(
    config.PAYOUT_INTERVAL_MINUTES > 0 ? 'PASS' : 'WARN',
    `Reporter payouts every ${config.PAYOUT_INTERVAL_MINUTES || '(never)'} min`,
    config.PAYOUT_INTERVAL_MINUTES > 0
      ? `${config.REPORTER_SHARE_PERCENT}% of each paid query`
      : 'only on demand',
  );
  report(
    config.REPORTER_VERIFIER === 'world' ? 'PASS' : 'FAIL',
    `Reporter verification: ${config.REPORTER_VERIFIER}`,
    `World ID ${config.WORLD_ENVIRONMENT}, action "${config.WORLD_ACTION}"`,
  );
  report(
    config.CORS_ORIGINS.length === 0 ? 'PASS' : 'WARN',
    config.CORS_ORIGINS.length === 0 ? 'CORS: same origin only' : `CORS: ${config.CORS_ORIGINS.join(', ')}`,
    config.CORS_ORIGINS.length === 0
      ? 'the API serves the web app itself'
      : 'only needed if the web app is hosted elsewhere',
  );

  section('Services and funding');
  await step('World ID RP signing key works', async () => {
    signRequest({ action: config.WORLD_ACTION, signingKeyHex: config.WORLD_RP_SIGNING_KEY! });
    return `${config.WORLD_RP_ID} (${config.WORLD_ENVIRONMENT})`;
  });

  await step('Arkiv writer wallet is funded', async () => {
    const pk = config.ARKIV_PRIVATE_KEY!.startsWith('0x')
      ? config.ARKIV_PRIVATE_KEY!
      : `0x${config.ARKIV_PRIVATE_KEY}`;
    const address = viemAccounts.privateKeyToAccount(pk as `0x${string}`).address;
    const client = arkivPublicClient(config.ARKIV_ACCESS_KEY);
    const [block, balance] = await Promise.all([client.getBlockNumber(), client.getBalance({ address })]);
    const eth = Number(balance) / 1e18;
    return {
      level: balance > 0n ? 'PASS' : 'FAIL',
      detail: `${address}: ${eth.toFixed(4)} (block ${block})${balance > 0n ? '' : '; fund it at https://hub.arkiv.network/faucet'}`,
    };
  });

  await step('Hedera platform account: exists, key matches, funded', async () => {
    const acct = await fetchAccount(config.HEDERA_MIRROR_NODE_URL, config.HEDERA_ACCOUNT_ID!);
    const ours = parsePrivateKey(config.HEDERA_PRIVATE_KEY!, config.HEDERA_KEY_TYPE)
      .publicKey.toStringRaw()
      .toLowerCase();
    const onchain = acct.key?.key?.toLowerCase();
    if (onchain && !onchain.endsWith(ours)) {
      throw new Error(
        `private key does not match ${config.HEDERA_ACCOUNT_ID} (check HEDERA_KEY_TYPE=${config.HEDERA_KEY_TYPE})`,
      );
    }
    const balance = BigInt(acct.balance.balance);
    // Payouts are sent from this account and it pays their network fees.
    return {
      level: balance >= 100_000_000n ? 'PASS' : 'WARN',
      detail: `${config.HEDERA_ACCOUNT_ID} on ${config.HEDERA_NETWORK}: ${hbar(balance)}${balance >= 100_000_000n ? '' : ' (keep at least 1 HBAR for payout fees)'}`,
    };
  });

  await step('x402 facilitator supports the network', async () => {
    const res = await fetch(`${config.FACILITATOR_URL}/supported`, { signal: AbortSignal.timeout(10_000) });
    const body = (await res.json()) as { kinds?: { network: string; scheme: string }[] };
    const kinds = (body.kinds ?? []).filter((k) => k.network === config.HEDERA_NETWORK);
    if (kinds.length === 0)
      throw new Error(`${config.FACILITATOR_URL} does not list ${config.HEDERA_NETWORK}`);
    return `${config.FACILITATOR_URL}: ${kinds.map((k) => k.scheme).join(', ')}`;
  });

  await step('Postgres reachable from here', async () => {
    const db = new Client({ connectionString: config.DATABASE_URL, connectionTimeoutMillis: 5_000 });
    try {
      await db.connect();
      const { rows } = await db.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'schema_migrations'",
      );
      return rows[0].n
        ? 'connected; migrations table present'
        : 'connected; empty database (migrations will run on boot)';
    } catch (err) {
      // With the Docker deployment the database is internal to the server: not reachable from a laptop.
      return {
        level: 'WARN',
        detail: `not reachable from this machine (${(err as Error).message}); fine if it is private to the deployment`,
      };
    } finally {
      await db.end().catch(() => undefined);
    }
  });
}

async function liveChecks(base: string) {
  section(`Live deployment (${base})`);
  const get = (path: string) =>
    fetch(`${base}${path}`, { signal: AbortSignal.timeout(15_000), redirect: 'manual' });

  await step('Served over HTTPS', async () => {
    if (!base.startsWith('https://')) {
      return { level: 'FAIL', detail: 'browsers only share location (and World ID works best) on HTTPS' };
    }
    return 'yes';
  });
  await step('Liveness: /health/live', async () => {
    const res = await get('/health/live');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return `HTTP ${res.status}`;
  });
  await step('Readiness: /health (Postgres, Arkiv, Hedera)', async () => {
    const res = await get('/health');
    const body = (await res.json()) as {
      ok: boolean;
      env?: string;
      worldEnvironment?: string;
      postgres: { ok: boolean };
      arkiv: { ok: boolean; error?: string };
      hedera: { ok: boolean; error?: string };
    };
    if (!body.ok) {
      const down = (['postgres', 'arkiv', 'hedera'] as const).filter((k) => !body[k].ok);
      throw new Error(`down: ${down.join(', ')}`);
    }
    return `tier ${body.env}, World ID ${body.worldEnvironment}`;
  });
  await step('Web app served (/, /map, /report, /me)', async () => {
    for (const path of ['/', '/map', '/report', '/me']) {
      const res = await get(path);
      if (!res.ok || !res.headers.get('content-type')?.includes('text/html'))
        throw new Error(`${path}: HTTP ${res.status}`);
    }
    return 'all four routes';
  });
  await step('Paid endpoint asks for payment (402 + quote)', async () => {
    const res = await get('/v1/conditions?lat=19.1197&lng=72.8464&radius=300');
    const quote = res.headers.get('payment-required');
    if (res.status !== 402 || !quote)
      throw new Error(`expected 402 with PAYMENT-REQUIRED, got ${res.status}`);
    const accepts = (
      JSON.parse(Buffer.from(quote, 'base64').toString()) as {
        accepts: { amount: string; payTo: string; network: string }[];
      }
    ).accepts[0];
    return `${Number(accepts.amount) / 1e8} HBAR to ${accepts.payTo} on ${accepts.network}`;
  });
  await step('Security headers', async () => {
    const res = await get('/health/live');
    const want = ['strict-transport-security', 'x-content-type-options', 'x-request-id'];
    const missing = want.filter((h) => !res.headers.get(h));
    if (res.headers.get('x-powered-by')) throw new Error('x-powered-by is exposed');
    return missing.length ? { level: 'WARN', detail: `missing: ${missing.join(', ')}` } : want.join(', ');
  });
}

async function main() {
  if (!skipConfig) await configChecks();
  if (url) await liveChecks(url);
  else if (!skipConfig) console.log('\n(Add --url https://your-domain to also check the live deployment.)');

  const fails = results.filter((r) => r.level === 'FAIL').length;
  const warns = results.filter((r) => r.level === 'WARN').length;
  console.log(
    `\n\x1b[1m${results.length - fails - warns} passed, ${warns} warning(s), ${fails} failed\x1b[0m` +
      (fails ? '  \x1b[31mnot ready to deploy\x1b[0m' : '  \x1b[32mready\x1b[0m'),
  );
  if (fails) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
