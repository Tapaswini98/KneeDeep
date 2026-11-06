import { api, ApiError, type LiveReport } from './api';
import type { ReporterSession } from './identity';
import type { Level } from './levels';
import { myVote, rememberVote } from './myVotes';
import { activeTestLocation } from './testLocation';

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

/**
 * Confirm or dispute. Remembers the vote on success, and also on "already voted" (409), so
 * the report stops offering buttons right away.
 */
export async function castVote(
  session: ReporterSession,
  reportKey: string,
  vote: 'confirm' | 'dispute',
  at: { lat: number; lng: number },
) {
  try {
    const res = await api<{ explorer: string }>(`/v1/reports/${reportKey}/votes`, {
      method: 'POST',
      token: session.token,
      body: JSON.stringify({ vote, ...at }),
    });
    rememberVote(session.reporter, reportKey, vote);
    return res;
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) rememberVote(session.reporter, reportKey, 'voted');
    throw err;
  }
}

export interface Position {
  lat: number;
  lng: number;
  accuracy: number;
  /** Set when this is a chosen test location rather than GPS. */
  label?: string;
}

/** GPS, or the chosen test location outside production. */
export function currentPosition(): Promise<Position> {
  const test = activeTestLocation();
  if (test) return Promise.resolve({ lat: test.lat, lng: test.lng, accuracy: 0, label: test.name });
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

/** This session's vote on a report, from the server's list or this browser's memory. */
export function sessionVote(
  session: ReporterSession | null,
  report: LiveReport,
): 'confirm' | 'dispute' | 'voted' | undefined {
  if (!session) return undefined;
  return (
    report.voters.find((v) => v.voter === session.reporter)?.vote ?? myVote(session.reporter, report.key)
  );
}

/** Why a report can't be voted on by this session right now, or null if it can. */
export function voteBlocker(session: ReporterSession | null, report: LiveReport): string | null {
  if (!session) return 'Verify to vote';
  if (report.reporter === session.reporter) return 'Your report';
  const mine = sessionVote(session, report);
  if (mine) return mine === 'confirm' ? 'You confirmed' : mine === 'dispute' ? 'You disputed' : 'You voted';
  if (report.expiresInMin < 1) return 'Expiring';
  return null;
}

export function errorText(err: unknown): string {
  return err instanceof ApiError || err instanceof Error ? err.message : 'Could not reach the API.';
}
