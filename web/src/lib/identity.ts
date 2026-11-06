import type { RpContext } from '@worldcoin/idkit';
import { api } from './api';

export type IdentityContext =
  | { mode: 'dev' }
  | {
      mode: 'world';
      app_id: `app_${string}`;
      action: string;
      environment: 'production' | 'staging';
      signal: string;
      allow_legacy_proofs: boolean;
      rp_context: RpContext;
    };

export interface ReporterSession {
  token: string;
  reporter: string;
  method: 'world' | 'dev';
  source: 'live' | 'simulated';
  expiresAt: string;
}

const KEY = 'kneedeep.session';

/** Per-browser convenience only; the server is the authority on whether a session is valid. */
export function loadSession(): ReporterSession | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as ReporterSession | null;
    return s && new Date(s.expiresAt) > new Date() ? s : null;
  } catch {
    return null;
  }
}

export function saveSession(s: ReporterSession | null): void {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    // Private mode or blocked storage: the session simply lasts for this page view.
  }
}

/** Fresh every time: the RP signature inside expires after 5 minutes. */
export function fetchIdentityContext(): Promise<IdentityContext> {
  return api<IdentityContext>('/v1/identity/context');
}

export function openSession(proof: unknown): Promise<ReporterSession> {
  return api<ReporterSession>('/v1/identity/session', { method: 'POST', body: JSON.stringify({ proof }) });
}
