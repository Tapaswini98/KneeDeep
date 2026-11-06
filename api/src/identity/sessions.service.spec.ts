import { UnauthorizedException } from '@nestjs/common';
import type { AppConfig } from '../config/config';
import type { DbService } from '../db/db.service';
import { DevVerifier } from './dev.verifier';
import { HumanVerifier, pseudonymFor } from './human-verifier';
import { SessionsService } from './sessions.service';

const config = { PSEUDONYM_SALT: 'salt', REPORTER_SESSION_HOURS: 12 } as AppConfig;
const db = { query: jest.fn().mockResolvedValue([]) } as unknown as DbService;
const sessions = new SessionsService(config, new DevVerifier(), db);

describe('SessionsService', () => {
  it('issues a session for a verified human, carrying only the pseudonym', async () => {
    const s = await sessions.open({ devId: 'asha-1' });
    expect(s.method).toBe('dev');
    expect(s.source).toBe('simulated');
    expect(Buffer.from(s.token.split('.')[0], 'base64url').toString()).not.toContain('asha-1');
    expect(sessions.authenticate(`Bearer ${s.token}`)).toEqual({
      pseudonym: pseudonymFor('salt', 'dev:asha-1'),
      method: 'dev',
    });
  });

  it('gives the same human the same pseudonym every time', async () => {
    const a = sessions.authenticate(`Bearer ${(await sessions.open({ devId: 'ravi' })).token}`);
    const b = sessions.authenticate(`Bearer ${(await sessions.open({ devId: 'ravi' })).token}`);
    expect(a.pseudonym).toBe(b.pseudonym);
  });

  it('rejects a missing, forged or tampered session', async () => {
    const { token } = await sessions.open({ devId: 'meera' });
    const [payload, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'someone', m: 'dev', exp: 9e9 })).toString('base64url');
    expect(() => sessions.authenticate(undefined)).toThrow(UnauthorizedException);
    expect(() => sessions.authenticate(`Bearer ${forged}.${sig}`)).toThrow(UnauthorizedException);
    expect(() => sessions.authenticate(`Bearer ${payload}.x${sig.slice(1)}`)).toThrow(UnauthorizedException);
  });

  it('rejects an expired session', async () => {
    const shortLived = new SessionsService(
      { ...config, REPORTER_SESSION_HOURS: -1 } as AppConfig,
      new DevVerifier(),
      db,
    );
    const { token } = await shortLived.open({ devId: 'kabir' });
    expect(() => shortLived.authenticate(`Bearer ${token}`)).toThrow('expired');
  });

  it('never lets a dev session pass once World ID mode is on', async () => {
    const { token } = await sessions.open({ devId: 'farah' });
    const worldMode = new SessionsService(config, { name: 'world' } as HumanVerifier, db);
    expect(() => worldMode.authenticate(`Bearer ${token}`)).toThrow('another verifier');
  });
});
