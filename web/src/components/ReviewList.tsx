import { useState } from 'react';
import { voteBlocker } from '../lib/actions';
import type { LiveReport } from '../lib/api';
import { useMyVotes } from '../lib/myVotes';
import { distanceMeters } from '../lib/places';
import { useSession } from '../lib/session';
import { VOTE_RADIUS_M, VoteItem } from './VoteItem';

const FIRST = 5;

/**
 * Live reports around a position. Only reports this person can still vote on are listed
 * (nearest first); their own, already voted and too-far ones are folded away. A report voted on
 * here stays in place, showing the vote, until the list is next opened.
 */
export function ReviewList({
  reports,
  position,
  onVoted,
}: {
  reports: LiveReport[];
  position: { lat: number; lng: number };
  onVoted: () => void;
}) {
  const { session } = useSession();
  useMyVotes();
  const [showAll, setShowAll] = useState(false);
  const [justVoted, setJustVoted] = useState<Set<string>>(new Set());

  const withDistance = reports
    .map((r) => ({ r, d: distanceMeters(position, r.center) }))
    .sort((a, b) => a.d - b.d);
  const canVote = (x: { r: LiveReport; d: number }) =>
    !voteBlocker(session, x.r) && (session?.method !== 'world' || x.d <= VOTE_RADIUS_M);
  const open = withDistance.filter((x) => justVoted.has(x.r.key) || canVote(x)).map((x) => x.r);
  const rest = withDistance.filter((x) => !justVoted.has(x.r.key) && !canVote(x)).map((x) => x.r);
  const shown = showAll ? open : open.slice(0, FIRST);
  const remaining = open.filter((r) => !voteBlocker(session, r)).length;

  const voted = (key: string) => {
    setJustVoted((s) => new Set(s).add(key));
    onVoted();
  };

  return (
    <div className="review-list">
      {open.length === 0 ? (
        <p className="empty">You have voted on everything near here. Thank you!</p>
      ) : (
        <>
          {justVoted.size > 0 && (
            <p className="small muted">
              {remaining === 0 ? 'All done here.' : `${remaining} left to review.`}
            </p>
          )}
          {shown.map((r) => (
            <VoteItem key={r.key} report={r} position={position} onVoted={voted} />
          ))}
        </>
      )}
      {open.length > FIRST && (
        <button className="link small" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Show fewer' : `Show all ${open.length}`}
        </button>
      )}
      {rest.length > 0 && (
        <details className="fold">
          <summary>{rest.length} more you can't vote on (yours, already voted, or too far)</summary>
          {rest.map((r) => (
            <VoteItem key={r.key} report={r} position={position} onVoted={voted} />
          ))}
        </details>
      )}
    </div>
  );
}
