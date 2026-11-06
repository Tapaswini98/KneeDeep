import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { Level, LEVELS } from '../lib/levels';

type Position = { lat: number; lng: number; accuracy: number };

/**
 * Mobile reporter page. Pick a level, share location, submit.
 * S4 adds World ID: the proof is attached to the submit and verified on the server.
 */
export function ReportPage() {
  const [level, setLevel] = useState<Level | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [locating, setLocating] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
    if (!level || !position) return;
    setSubmitting(true);
    setStatus(null);
    try {
      await api('/v1/reports', {
        method: 'POST',
        body: JSON.stringify({ level, lat: position.lat, lng: position.lng }),
      });
      setStatus({ kind: 'ok', text: 'Report submitted. It stays live for 3 hours.' });
    } catch (err) {
      setStatus({ kind: 'error', text: err instanceof ApiError ? err.message : 'Could not reach the API.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="report-page">
      <h2>What does the street look like right now?</h2>

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
          Location captured (±{Math.round(position.accuracy)} m). Only a ~150 m area is stored, never your exact
          position.
        </p>
      )}

      <button className="primary" onClick={submit} disabled={!level || !position || submitting}>
        {submitting ? 'Submitting…' : 'Submit report'}
      </button>

      {status && <p className={`notice ${status.kind}`}>{status.text}</p>}
    </div>
  );
}
