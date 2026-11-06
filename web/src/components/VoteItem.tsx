import { useState } from 'react';
import { castVote, errorText, sessionVote, voteBlocker } from '../lib/actions';
import type { LiveReport } from '../lib/api';
import { LEVELS } from '../lib/levels';
import { useMyVotes } from '../lib/myVotes';
import { distanceMeters, formatDistance, placeName } from '../lib/places';
import { useSession } from '../lib/session';

/** Votes are accepted from within this distance of the report (VOTE_MAX_DISTANCE_M on the server). */
export const VOTE_RADIUS_M = 1000;

/**
 * One live report with Confirm / Dispute. The vote is sent with where the voter stands
 * (`position`); the server only accepts it from within 1 km of the report. Once this person
 * has voted, the buttons give way to what they voted.
 */
export function VoteItem({
  report: r,
  position,
  onVoted,
}: {
  report: LiveReport;
  position: { lat: number; lng: number };
  onVoted: (key: string) => void;
}) {
  const { session } = useSession();
  useMyVotes(); // re-render as soon as a vote is remembered
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voteLink, setVoteLink] = useState<string | null>(null);
  const info = LEVELS.find((l) => l.id === r.level);
  const distance = distanceMeters(position, r.center);
  const mine = Boolean(session && r.reporter === session.reporter);
  const voted = sessionVote(session, r);
  const blocked =
    voteBlocker(session, r) ??
    (session?.method === 'world' && distance > VOTE_RADIUS_M ? 'Too far to vote' : null);

  const vote = async (v: 'confirm' | 'dispute') => {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const res = await castVote(session, r.key, v, position);
      setVoteLink(res.explorer);
      onVoted(r.key);
    } catch (err) {
      setError(errorText(err));
      onVoted(r.key);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`nearby-item ${mine ? 'mine' : ''} ${voted ? `voted ${voted}` : ''}`}>
      <span className="swatch" style={{ background: info?.color }} />
      <div className="nearby-text">
        <strong>
          {info?.label ?? r.level} · {placeName(r.center)}
          {mine && <span className="tag">yours</span>}
          {r.source === 'simulated' && <span className="tag sim">simulated</span>}
        </strong>
        <small>
          {Math.round(r.ageMin)} min ago · {formatDistance(distance)} away · +{r.confirmations} / −
          {r.disputes} · expires in {Math.round(r.expiresInMin)} min ·{' '}
          <a href={r.explorer.entity} target="_blank" rel="noreferrer">
            Arkiv
          </a>
        </small>
        {error && <small className="err">{error}</small>}
      </div>
      <div className="nearby-actions">
        {busy ? (
          <span className="muted small">Saving to Arkiv…</span>
        ) : voted ? (
          <span className={`vote-done ${voted}`}>
            {voted === 'confirm' ? '✓ You confirmed' : voted === 'dispute' ? '✕ You disputed' : '✓ You voted'}
            {voteLink && (
              <a href={voteLink} target="_blank" rel="noreferrer">
                vote on Arkiv
              </a>
            )}
          </span>
        ) : blocked ? (
          <span className="muted small">{blocked}</span>
        ) : (
          <>
            <button className="vote-confirm" onClick={() => vote('confirm')}>
              Confirm
            </button>
            <button className="vote-dispute" onClick={() => vote('dispute')}>
              Dispute
            </button>
          </>
        )}
      </div>
    </div>
  );
}
