import { type AppConfig, deploymentProblems } from './config';

const safe = {
  APP_ENV: 'production',
  REPORTER_VERIFIER: 'world',
  WORLD_ENVIRONMENT: 'production',
  PSEUDONYM_SALT: 'x'.repeat(64),
  WORLD_APP_ID: 'app_1',
  WORLD_RP_ID: 'rp_1',
  WORLD_RP_SIGNING_KEY: '0x1',
  ARKIV_PRIVATE_KEY: '0x2',
  ARKIV_ACCESS_KEY: 'ark_1',
  HEDERA_ACCOUNT_ID: '0.0.1',
  HEDERA_PRIVATE_KEY: '0x3',
} as unknown as AppConfig;

const problems = (override: Partial<Record<keyof AppConfig, unknown>>) =>
  deploymentProblems({ ...safe, ...override } as AppConfig).join('\n');

describe('deploymentProblems', () => {
  it('accepts a complete production configuration', () => {
    expect(deploymentProblems(safe)).toEqual([]);
  });

  it('ignores development', () => {
    expect(problems({ APP_ENV: 'development', REPORTER_VERIFIER: 'dev', PSEUDONYM_SALT: undefined })).toBe(
      '',
    );
  });

  it('lets staging use the World ID simulator', () => {
    expect(problems({ APP_ENV: 'staging', WORLD_ENVIRONMENT: 'staging' })).toBe('');
  });

  it('keeps staging strict about everything else', () => {
    expect(
      problems({ APP_ENV: 'staging', WORLD_ENVIRONMENT: 'staging', REPORTER_VERIFIER: 'dev' }),
    ).toContain('REPORTER_VERIFIER');
  });

  it.each([
    ['dev verifier', { REPORTER_VERIFIER: 'dev' }, 'REPORTER_VERIFIER'],
    ['World staging', { WORLD_ENVIRONMENT: 'staging' }, 'WORLD_ENVIRONMENT'],
    ['placeholder salt', { PSEUDONYM_SALT: 'change-me-to-a-long-random-string' }, 'PSEUDONYM_SALT'],
    ['short salt', { PSEUDONYM_SALT: 'short' }, 'PSEUDONYM_SALT'],
    ['missing Arkiv key', { ARKIV_PRIVATE_KEY: undefined }, 'ARKIV_PRIVATE_KEY'],
    ['missing Hedera account', { HEDERA_ACCOUNT_ID: undefined }, 'HEDERA_ACCOUNT_ID'],
  ])('refuses %s in production', (_name, override, expected) => {
    expect(problems(override)).toContain(expected);
  });
});
