import { api, ApiError, type LiveReport } from './api';
import type { ReporterSession } from './identity';
import type { Level } from './levels';

export interface ReportCreated {
  key: string;
  expiresAt: string;
  source: string;
  explorer: string;
}

export function submitReport(session: ReporterSession, report: { level: Level; lat: number; lng: number }) {
  return api<ReportCreated>('/v1/reports', {
    method: 'POST',
    token: session.token,
    body: JSON.stringify(report),
  });
}

export function castVote(
  session: ReporterSession,
  reportKey: string,
  vote: 'confirm' | 'dispute',
  at: { lat: number; lng: number },
) {
  return api<{ explorer: string }>(`/v1/reports/${reportKey}/votes`, {
    method: 'POST',
    token: session.token,
    body: JSON.stringify({ vote, ...at }),
  });
}

export function currentPosition(): Promise<{ lat: number; lng: number; accuracy: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This browser cannot share location.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (err) => reject(new Error(`Location unavailable: ${err.message}`)),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  });
}

/**
 * Where the voter is. Only nearby people may vote: verified humans share their real
 * location; dev identities are simulated, so they "stand at" the report.
 */
export function voterPosition(session: ReporterSession, report: LiveReport) {
  return session.method === 'dev' ? Promise.resolve(report.center) : currentPosition();
}

/** Why a report can't be voted on by this session right now, or null if it can. */
export function voteBlocker(session: ReporterSession | null, report: LiveReport): string | null {
  if (!session) return 'Verify to vote';
  if (report.reporter === session.reporter) return 'Your report';
  if (report.voters.some((v) => v.voter === session.reporter)) return 'You voted';
  if (report.expiresInMin < 1) return 'Expiring';
  return null;
}

export function errorText(err: unknown): string {
  return err instanceof ApiError || err instanceof Error ? err.message : 'Could not reach the API.';
}
