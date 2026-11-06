import { z } from 'zod';
import { loadEnv } from './env';

export const APP_CONFIG = Symbol('APP_CONFIG');

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

/**
 * Everything the API reads from the environment, validated once at boot.
 * Integration secrets are optional so the API still boots during setup;
 * each integration refuses to work (loudly) when its own settings are missing.
 */
const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().default('postgres://kneedeep:kneedeep@localhost:5434/kneedeep'),
  PSEUDONYM_SALT: optional,

  ARKIV_ACCESS_KEY: z.string().default(''),
  ARKIV_PRIVATE_KEY: optional,
  REPORT_TTL_SECONDS: z.coerce.number().int().positive().default(3 * 60 * 60),
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
  REPORTER_SESSION_HOURS: z.coerce.number().positive().default(12),
});

export type AppConfig = z.infer<typeof schema>;

export function readConfig(): AppConfig {
  loadEnv();
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return parsed.data;
}
