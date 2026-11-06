import { useCallback, useEffect, useState } from 'react';
import { SignInCard } from '../components/SignInCard';
import { ReviewList } from '../components/ReviewList';
import { errorText, type Position, submitReport } from '../lib/actions';
import { api, type LiveReport, type LiveReports } from '../lib/api';
import { type Level, LEVELS } from '../lib/levels';
import { placeName } from '../lib/places';
import { navigate } from '../lib/router';
import { useSession } from '../lib/session';
import { usePosition } from '../lib/usePosition';

type Status = { kind: 'ok' | 'error'; text: string; link?: string } | null;

/**
 * Mobile reporter page: verify once with World ID, then report what the street looks
 * like and confirm or dispute what others nearby reported.
 */
export function ReportPage() {
  const { session, signOut } = useSession();
  const { position, locate, locating, error: locError, isTest } = usePosition();
  const [level, setLevel] = useState<Level | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [submitting, setSubmitting] = useState(false);
  const [nearby, setNearby] = useState<LiveReport[]>([]);

  const loadNearby = useCallback(async (p: Position) => {
    try {
      const res = await api<LiveReports>(`/v1/reports?lat=${p.lat}&lng=${p.lng}&radius=1000`);
      setNearby(res.reports);
    } catch {
      setNearby([]);
    }
  }, []);

  useEffect(() => {
    if (position) void loadNearby(position);
  }, [position, loadNearby]);

  const submit = async () => {
    if (!level || !position || !session) return;
    setSubmitting(true);
    setStatus(null);
    try {
      const r = await submitReport(session, { level, lat: position.lat, lng: position.lng });
      const until = new Date(r.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setStatus({
        kind: 'ok',
        text: `Saved on Arkiv. It stays live until ${until}, then disappears.`,
        link: r.explorer,
      });
      setLevel(null);
      await loadNearby(position);
    } catch (err) {
      setStatus({ kind: 'error', text: errorText(err) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page narrow">
      <header className="page-head">
        <h1>Report the street</h1>
        <p className="muted">What does the road look like right now? One tap, then it expires on its own.</p>
      </header>

      {!session ? (
        <section className="card">
          <SignInCard why="Sign in once to report and vote. Only verified unique humans can, so nobody can fake a flood." />
        </section>
      ) : (
        <div className="identity-bar">
          <span className={`pill ${session.method === 'world' ? 'verified' : 'sim'}`}>
            {session.method === 'world' ? 'Verified human' : 'Dev identity · simulated'}
          </span>
          <code>{session.reporter}</code>
          <span className="spacer" />
          <button className="link" onClick={() => navigate('/me')}>
            My activity
          </button>
          <button className="link" onClick={() => signOut()}>
            Sign out
          </button>
        </div>
      )}

      <section className="card">
        <h3 className="step">
          <span>1</span> How deep is it?
        </h3>
        <div className="levels">
          {LEVELS.map((l) => (
            <button
              key={l.id}
              className={`level ${level === l.id ? 'selected' : ''}`}
              style={{ ['--level' as string]: l.color }}
              onClick={() => setLevel(l.id)}
              aria-pressed={level === l.id}
            >
              <span className="level-dot" />
              <span>
                <strong>{l.label}</strong>
                <small>{l.hint}</small>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h3 className="step">
          <span>2</span> Where are you?
        </h3>
        {position ? (
          <div className="location-line">
            <strong>{position.label ?? placeName(position)}</strong>
            <span className="muted small">
              {isTest
                ? 'Test location (top bar). Switch to "Real GPS" there to use your device.'
                : `GPS, ±${Math.round(position.accuracy)} m.`}{' '}
              Only the ~150 m area is stored.
            </span>
          </div>
        ) : (
          <p className="muted small">Share your location, or pick a test location in the top bar.</p>
        )}
        {!isTest && (
          <button className="secondary" onClick={locate} disabled={locating}>
            {locating ? 'Locating…' : position ? 'Update my location' : 'Share my location'}
          </button>
        )}
        {locError && <p className="notice error small">{locError}</p>}
      </section>

      <button
        className="primary big"
        onClick={submit}
        disabled={!session || !level || !position || submitting}
      >
        {submitting ? 'Saving to Arkiv…' : 'Submit report'}
      </button>

      {status && (
        <p className={`notice ${status.kind}`}>
          {status.text}{' '}
          {status.link && (
            <a href={status.link} target="_blank" rel="noreferrer">
              View on Arkiv
            </a>
          )}
          {status.kind === 'ok' && (
            <>
              {' · '}
              <button className="link" onClick={() => navigate('/me')}>
                My activity
              </button>
            </>
          )}
        </p>
      )}

      {position && (
        <section className="card">
          <h3>Live reports within 1 km</h3>
          <p className="muted small">Confirm what you see, dispute what is wrong. One vote per report.</p>
          {nearby.length === 0 ? (
            <p className="empty">Nothing reported here right now.</p>
          ) : (
            <ReviewList reports={nearby} position={position} onVoted={() => loadNearby(position)} />
          )}
        </section>
      )}
    </div>
  );
}
