import { useCallback, useEffect, useState } from 'react';
import { VerifyHuman } from '../components/VerifyHuman';
import { api, ApiError, LiveReport } from '../lib/api';
import { loadSession, ReporterSession, saveSession } from '../lib/identity';
import { Level, LEVELS } from '../lib/levels';

type Position = { lat: number; lng: number; accuracy: number };
type Status = { kind: 'ok' | 'error'; text: string } | null;

const levelInfo = (id: string) => LEVELS.find((l) => l.id === id);

/**
 * Mobile reporter page: verify once with World ID, then report what the street looks
 * like and confirm or dispute what others nearby reported.
 */
export function ReportPage() {
  const [session, setSession] = useState<ReporterSession | null>(loadSession);
  const [level, setLevel] = useState<Level | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [locating, setLocating] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [submitting, setSubmitting] = useState(false);
  const [nearby, setNearby] = useState<LiveReport[]>([]);
  const [voting, setVoting] = useState<string | null>(null);

  const onVerified = (s: ReporterSession) => {
    saveSession(s);
    setSession(s);
    setStatus({ kind: 'ok', text: s.method === 'world' ? 'Verified as a unique human.' : 'Dev identity (SIMULATED data).' });
  };

  const signOut = () => {
    saveSession(null);
    setSession(null);
  };

  /** A 401 means the session is gone or expired: ask the person to verify again. */
  const handleError = (err: unknown) => {
    if (err instanceof ApiError && err.status === 401) signOut();
    setStatus({ kind: 'error', text: err instanceof ApiError ? err.message : 'Could not reach the API.' });
  };

  const loadNearby = useCallback(async (p: Position) => {
    try {
      const res = await api<{ reports: LiveReport[] }>(`/v1/reports?lat=${p.lat}&lng=${p.lng}&radius=1000`);
      setNearby(res.reports);
    } catch {
      setNearby([]);
    }
  }, []);

  useEffect(() => {
    if (position) void loadNearby(position);
  }, [position, loadNearby]);

  const locate = () => {
    if (!navigator.geolocation) {
      setStatus({ kind: 'error', text: 'This browser cannot share location.' });
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPosition({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });
        setLocating(false);
      },
      (err) => {
        setStatus({ kind: 'error', text: `Location unavailable: ${err.message}` });
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  };

  const submit = async () => {
    if (!level || !position || !session) return;
    setSubmitting(true);
    setStatus(null);
    try {
      const r = await api<{ expiresAt: string; source: string }>('/v1/reports', {
        method: 'POST',
        token: session.token,
        body: JSON.stringify({ level, lat: position.lat, lng: position.lng }),
      });
      const until = new Date(r.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setStatus({ kind: 'ok', text: `Report saved on Arkiv. It stays live until ${until}, then disappears.` });
      setLevel(null);
      await loadNearby(position);
    } catch (err) {
      handleError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const vote = async (report: LiveReport, v: 'confirm' | 'dispute') => {
    if (!position || !session) return;
    setVoting(report.key);
    setStatus(null);
    try {
      await api(`/v1/reports/${report.key}/votes`, {
        method: 'POST',
        token: session.token,
        body: JSON.stringify({ vote: v, lat: position.lat, lng: position.lng }),
      });
      setStatus({ kind: 'ok', text: v === 'confirm' ? 'Thanks: confirmed.' : 'Thanks: disputed.' });
      await loadNearby(position);
    } catch (err) {
      handleError(err);
    } finally {
      setVoting(null);
    }
  };

  return (
    <div className="report-page">
      <h2>What does the street look like right now?</h2>

      {!session ? (
        <VerifyHuman onVerified={onVerified} />
      ) : (
        <p className="muted session">
          {session.method === 'world' ? 'Verified human' : 'Dev identity (simulated)'} · reporter {session.reporter}…{' '}
          <button className="link" onClick={signOut}>
            sign out
          </button>
        </p>
      )}

      <div className="levels">
        {LEVELS.map((l) => (
          <button
            key={l.id}
            className={`level ${level === l.id ? 'selected' : ''}`}
            style={{ borderColor: l.color }}
            onClick={() => setLevel(l.id)}
          >
            <span className="swatch" style={{ background: l.color }} />
            <span>
              <strong>{l.label}</strong>
              <small>{l.hint}</small>
            </span>
          </button>
        ))}
      </div>

      <button className="secondary" onClick={locate} disabled={locating}>
        {locating ? 'Locating…' : position ? 'Update location' : 'Share my location'}
      </button>
      {position && (
        <p className="muted">
          Location captured (±{Math.round(position.accuracy)} m). Only a ~150 m area is stored, never your exact position.
        </p>
      )}

      <button className="primary" onClick={submit} disabled={!session || !level || !position || submitting}>
        {submitting ? 'Saving to Arkiv…' : 'Submit report'}
      </button>

      {status && <p className={`notice ${status.kind}`}>{status.text}</p>}

      {position && (
        <section className="nearby">
          <h3>Live reports within 1 km</h3>
          {nearby.length === 0 && <p className="muted">None right now.</p>}
          {nearby.map((r) => (
            <div key={r.key} className="nearby-item">
              <span className="swatch" style={{ background: levelInfo(r.level)?.color }} />
              <div className="nearby-text">
                <strong>{levelInfo(r.level)?.label ?? r.level}</strong>
                <small>
                  {Math.round(r.ageMin)} min ago · +{r.confirmations} / −{r.disputes}
                  {r.source === 'simulated' && ' · SIMULATED'}
                </small>
              </div>
              <div className="nearby-actions">
                <button disabled={!session || voting === r.key} onClick={() => vote(r, 'confirm')}>
                  Confirm
                </button>
                <button disabled={!session || voting === r.key} onClick={() => vote(r, 'dispute')}>
                  Dispute
                </button>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
