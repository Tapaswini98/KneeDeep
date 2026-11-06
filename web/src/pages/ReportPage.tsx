import { useCallback, useEffect, useState } from 'react';
import { Earnings } from '../components/Earnings';
import { VerifyHuman } from '../components/VerifyHuman';
import { castVote, currentPosition, errorText, submitReport, voteBlocker } from '../lib/actions';
import { api, type LiveReport, type LiveReports } from '../lib/api';
import { DEMO_SPOTS, type Level, LEVELS } from '../lib/levels';
import { useSession } from '../lib/session';

type Position = { lat: number; lng: number; accuracy: number; label?: string };
type Status = { kind: 'ok' | 'error'; text: string; link?: string } | null;

const levelInfo = (id: string) => LEVELS.find((l) => l.id === id);

/**
 * Mobile reporter page: verify once with World ID, then report what the street looks
 * like and confirm or dispute what others nearby reported.
 */
export function ReportPage() {
  const { session, setSession, signOut } = useSession();
  const [level, setLevel] = useState<Level | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [locating, setLocating] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [submitting, setSubmitting] = useState(false);
  const [nearby, setNearby] = useState<LiveReport[]>([]);

  const fail = (err: unknown): Status => ({ kind: 'error', text: errorText(err) });

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

  const locate = async () => {
    setLocating(true);
    try {
      setPosition(await currentPosition());
    } catch (err) {
      setStatus({ kind: 'error', text: errorText(err) });
    } finally {
      setLocating(false);
    }
  };

  const submit = async () => {
    if (!level || !position || !session) return;
    setSubmitting(true);
    setStatus(null);
    try {
      const r = await submitReport(session, { level, lat: position.lat, lng: position.lng });
      const until = new Date(r.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setStatus({
        kind: 'ok',
        text: `Report saved on Arkiv. It stays live until ${until}, then disappears.`,
        link: r.explorer,
      });
      setLevel(null);
      await loadNearby(position);
    } catch (err) {
      setStatus(fail(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="report-page">
      <h2>What does the street look like right now?</h2>

      {!session ? (
        <VerifyHuman onVerified={setSession} />
      ) : (
        <p className="muted session">
          {session.method === 'world' ? 'Verified human' : 'Dev identity (simulated)'} · reporter{' '}
          <code>{session.reporter}</code>{' '}
          <button className="link" onClick={() => signOut()}>
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
        {locating ? 'Locating…' : position && !position.label ? 'Update location' : 'Share my location'}
      </button>
      {session?.method === 'dev' && (
        <div className="demo-spots">
          <span className="muted small">Dev mode: report from a demo spot</span>
          {DEMO_SPOTS.map((s) => (
            <button
              key={s.name}
              className={`chip ${position?.label === s.name ? 'selected' : ''}`}
              onClick={() => setPosition({ lat: s.lat, lng: s.lng, accuracy: 0, label: s.name })}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      {position && (
        <p className="muted">
          {position.label
            ? `Location: ${position.label} (demo spot).`
            : `Location captured (±${Math.round(position.accuracy)} m).`}{' '}
          Only a ~150 m area is stored, never your exact position.
        </p>
      )}

      <button className="primary" onClick={submit} disabled={!session || !level || !position || submitting}>
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
        </p>
      )}

      {session && (
        <section className="nearby">
          <h3>Your earnings</h3>
          <Earnings session={session} />
        </section>
      )}

      {position && (
        <section className="nearby">
          <h3>Live reports within 1 km</h3>
          {nearby.length === 0 && <p className="muted">None right now.</p>}
          {nearby.map((r) => (
            <NearbyItem key={r.key} report={r} position={position} onVoted={() => loadNearby(position)} />
          ))}
        </section>
      )}
    </div>
  );
}

function NearbyItem({
  report: r,
  position,
  onVoted,
}: {
  report: LiveReport;
  position: Position;
  onVoted: () => void;
}) {
  const { session } = useSession();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Status>(null);
  const blocked = voteBlocker(session, r);

  const vote = async (v: 'confirm' | 'dispute') => {
    if (!session) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await castVote(session, r.key, v, { lat: position.lat, lng: position.lng });
      setMsg({ kind: 'ok', text: v === 'confirm' ? 'Confirmed.' : 'Disputed.', link: res.explorer });
      onVoted();
    } catch (err) {
      setMsg({ kind: 'error', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="nearby-item">
      <span className="swatch" style={{ background: levelInfo(r.level)?.color }} />
      <div className="nearby-text">
        <strong>{levelInfo(r.level)?.label ?? r.level}</strong>
        <small>
          {Math.round(r.ageMin)} min ago · +{r.confirmations} / −{r.disputes} · expires in{' '}
          {Math.round(r.expiresInMin)} min
          {r.source === 'simulated' && ' · SIMULATED'}
        </small>
        {msg && (
          <small className={msg.kind === 'error' ? 'err' : 'ok'}>
            {msg.text}{' '}
            {msg.link && (
              <a href={msg.link} target="_blank" rel="noreferrer">
                Arkiv
              </a>
            )}
          </small>
        )}
      </div>
      <div className="nearby-actions">
        {blocked ? (
          <span className="muted small">{blocked}</span>
        ) : busy ? (
          <span className="muted small">Saving…</span>
        ) : (
          <>
            <button onClick={() => vote('confirm')}>Confirm</button>
            <button onClick={() => vote('dispute')}>Dispute</button>
          </>
        )}
      </div>
    </div>
  );
}
