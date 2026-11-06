import { z } from 'zod';
import { loadEnv } from './env';

export const APP_CONFIG = Symbol('APP_CONFIG');

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const bool = (fallback: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(fallback)
    .transform((v) => v === 'true');

const PLACEHOLDER_SALT = 'change-me-to-a-long-random-string';

/**
 * Everything the API reads from the environment, validated once at boot.
 *
 * APP_ENV is the deployment tier:
 *   development  lenient: integrations may be unconfigured, dev identities allowed.
 *   staging      deployed and strict (real secrets, World ID required), but World ID runs
 *                against the simulator (WORLD_ENVIRONMENT=staging) and chains are testnets.
 *   production   strict, and real World App only.
 * Strict tiers fail at boot on an unsafe configuration (see `deploymentProblems`).
 * NODE_ENV stays the runtime switch (the Docker image always sets it to production).
 */
const objectSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // Defaults to production when NODE_ENV=production, otherwise development.
  APP_ENV: z.enum(['development', 'staging', 'production']).optional(),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().default('postgres://kneedeep:kneedeep@localhost:5434/kneedeep'),
  PSEUDONYM_SALT: optional,
  // Comma-separated browser origins allowed to call the API. Empty = same origin only (+ localhost in dev).
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  // Express "trust proxy": number of proxy hops in front of the API (needed for per-IP rate limits).
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  // Apply pending DB migrations at startup (convenient for single-container deploys).
  MIGRATE_ON_BOOT: bool('false'),

  ARKIV_ACCESS_KEY: z.string().default(''),
  ARKIV_PRIVATE_KEY: optional,
  REPORT_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(3 * 60 * 60),
  // 'world' = World ID proof required (reports are live). 'dev' = no proof, every report is labelled simulated.
  REPORTER_VERIFIER: z.enum(['world', 'dev']).default('world'),
  REPORT_RATE_LIMIT_MINUTES: z.coerce.number().int().positive().default(30),
  VOTE_MAX_DISTANCE_M: z.coerce.number().int().positive().default(1_000),

  HEDERA_NETWORK: z.enum(['hedera:testnet', 'hedera:mainnet']).default('hedera:testnet'),
  HEDERA_ACCOUNT_ID: optional,
  HEDERA_PRIVATE_KEY: optional,
  HEDERA_KEY_TYPE: z.enum(['ECDSA', 'ED25519']).default('ECDSA'),
  HEDERA_MIRROR_NODE_URL: z.string().url().default('https://testnet.mirrornode.hedera.com'),
  FACILITATOR_URL: z.string().url().default('https://api.testnet.blocky402.com'),
  CONDITIONS_PRICE_TINYBARS: z.coerce.bigint().positive().default(10_000_000n),

  WORLD_APP_ID: optional,
  WORLD_RP_ID: optional,
  WORLD_RP_SIGNING_KEY: optional,
  WORLD_ACTION: z.string().default('submit-report'),
  // 'staging' only for testing with the World ID simulator (https://simulator.worldcoin.org).
  WORLD_ENVIRONMENT: z.enum(['production', 'staging']).default('production'),
  WORLD_VERIFY_BASE_URL: z.string().url().default('https://developer.world.org'),
  // Accept World ID 3.0 Orb proofs when World App cannot produce a 4.0 one. 3.0 and 4.0 nullifiers
  // differ, so one person could hold two pseudonyms; keep false unless verification fails without it.
  WORLD_ALLOW_LEGACY_PROOFS: bool('false'),
  REPORTER_SESSION_HOURS: z.coerce.number().positive().default(12),
});

const schema = objectSchema.transform((c) => ({
  ...c,
  APP_ENV: c.APP_ENV ?? (c.NODE_ENV === 'production' ? ('production' as const) : ('development' as const)),
}));

export type AppConfig = z.infer<typeof schema>;

/** True for deployed tiers (staging, production): strict checks, no dev conveniences. */
export const isDeployed = (c: Pick<AppConfig, 'APP_ENV'>) => c.APP_ENV !== 'development';

/** Settings that are tolerable while building but must never reach a deployed environment. */
export function deploymentProblems(c: AppConfig): string[] {
  if (!isDeployed(c)) return [];
  const problems: string[] = [];
  const require = (ok: unknown, msg: string) => !ok && problems.push(msg);

  require(c.REPORTER_VERIFIER === 'world', 'REPORTER_VERIFIER must be "world" (dev mode accepts anyone)');
  if (c.APP_ENV === 'production') {
    require(c.WORLD_ENVIRONMENT ===
      'production', 'WORLD_ENVIRONMENT must be "production" (use APP_ENV=staging to test with the World ID simulator)');
  }
  require(c.PSEUDONYM_SALT &&
    c.PSEUDONYM_SALT !== PLACEHOLDER_SALT &&
    c.PSEUDONYM_SALT.length >= 32, 'PSEUDONYM_SALT must be a random secret of at least 32 characters');
  require(c.WORLD_APP_ID &&
    c.WORLD_RP_ID &&
    c.WORLD_RP_SIGNING_KEY, 'WORLD_APP_ID, WORLD_RP_ID and WORLD_RP_SIGNING_KEY are required');
  require(c.ARKIV_PRIVATE_KEY, 'ARKIV_PRIVATE_KEY is required');
  require(c.ARKIV_ACCESS_KEY, 'ARKIV_ACCESS_KEY is required (the public endpoint is heavily rate limited)');
  require(c.HEDERA_ACCOUNT_ID &&
    c.HEDERA_PRIVATE_KEY, 'HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY are required');
  return problems;
}

export function readConfig(): AppConfig {
  loadEnv();
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${issues}`);
  }
  const problems = deploymentProblems(parsed.data);
  if (problems.length > 0) {
    throw new Error(
      `Unsafe ${parsed.data.APP_ENV} configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
    );
  }
  return parsed.data;
}
