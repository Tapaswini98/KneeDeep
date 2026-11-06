import { UnauthorizedException } from '@nestjs/common';
import { WORLD_SIGNAL } from './human-verifier';
import { hashSignal } from './idkit';
import { WorldIdVerifier } from './world-id.verifier';

const options = {
  rpId: 'rp_test',
  action: 'submit-report',
  environment: 'production' as const,
  baseUrl: 'https://world.test',
};
const verifier = new WorldIdVerifier({ ...options, allowLegacy: false });
const legacyVerifier = new WorldIdVerifier({ ...options, allowLegacy: true });

const NULLIFIER_HEX = '0x' + 'ab'.repeat(32);

function proof(overrides: Record<string, unknown> = {}, response: Record<string, unknown> = {}) {
  return {
    protocol_version: '4.0',
    nonce: '0x01',
    action: 'submit-report',
    environment: 'production',
    responses: [
      {
        identifier: 'proof_of_human',
        nullifier: NULLIFIER_HEX,
        signal_hash: hashSignal(WORLD_SIGNAL),
        proof: ['0x1', '0x2', '0x3', '0x4', '0x5'],
        issuer_schema_id: 1,
        expires_at_min: 0,
        ...response,
      },
    ],
    ...overrides,
  };
}

let fetchMock: jest.Mock;
beforeEach(() => {
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
});

const worldSays = (status: number, body: unknown) =>
  fetchMock.mockResolvedValue({ ok: status < 400, status, json: async () => body });

describe('WorldIdVerifier', () => {
  it('accepts a valid Proof of Human and returns a normalised nullifier', async () => {
    worldSays(200, {
      success: true,
      results: [{ identifier: 'proof_of_human', success: true, nullifier: NULLIFIER_HEX }],
    });
    const human = await verifier.verify(proof());
    expect(human).toEqual({ method: 'world', nullifier: `world:v4:${BigInt(NULLIFIER_HEX).toString()}` });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://world.test/api/v4/verify/rp_test');
    expect(JSON.parse(init.body).environment).toBe('production');
  });

  it('maps hex and decimal forms of the same nullifier to the same human', async () => {
    worldSays(200, {
      success: true,
      results: [{ identifier: 'proof_of_human', success: true, nullifier: BigInt(NULLIFIER_HEX).toString() }],
    });
    const decimal = await verifier.verify(proof());
    worldSays(200, {
      success: true,
      results: [{ identifier: 'proof_of_human', success: true, nullifier: NULLIFIER_HEX }],
    });
    expect((await verifier.verify(proof())).nullifier).toBe(decimal.nullifier);
  });

  it.each([
    ['no proof at all', undefined],
    ['a proof for another action', proof({ action: 'claim-airdrop' })],
    ['a staging proof in production', proof({ environment: 'staging' })],
    ['a proof bound to another signal', proof({}, { signal_hash: hashSignal('someone-else') })],
    ['a proof with no signal', proof({}, { signal_hash: undefined })],
    ['a different credential', proof({}, { identifier: 'passport' })],
  ])('rejects %s without calling World', async (_name, p) => {
    await expect(verifier.verify(p)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects when World says the proof is invalid', async () => {
    worldSays(400, {
      success: false,
      code: 'all_verifications_failed',
      detail: 'All proof verifications failed.',
    });
    await expect(verifier.verify(proof())).rejects.toThrow('All proof verifications failed.');
  });

  it('rejects success when Proof of Human itself did not pass', async () => {
    worldSays(200, { success: true, results: [{ identifier: 'proof_of_human', success: false }] });
    await expect(verifier.verify(proof())).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('explains a legacy 3.0 proof when legacy proofs are off', async () => {
    await expect(verifier.verify(proof({ protocol_version: '3.0' }, { identifier: 'orb' }))).rejects.toThrow(
      'WORLD_ALLOW_LEGACY_PROOFS',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts a legacy Orb proof when allowed, under a separate v3 identity', async () => {
    worldSays(200, {
      success: true,
      results: [{ identifier: 'orb', success: true, nullifier: NULLIFIER_HEX }],
    });
    const human = await legacyVerifier.verify(proof({ protocol_version: '3.0' }, { identifier: 'orb' }));
    expect(human.nullifier).toBe(`world:v3:${BigInt(NULLIFIER_HEX).toString()}`);
  });

  it('still rejects a legacy device-only proof when legacy is allowed', async () => {
    await expect(
      legacyVerifier.verify(proof({ protocol_version: '3.0' }, { identifier: 'device' })),
    ).rejects.toThrow('got: device');
  });
});
