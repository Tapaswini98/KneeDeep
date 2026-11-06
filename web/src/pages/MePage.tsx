import { Earnings } from '../components/Earnings';
import { SignInCard } from '../components/SignInCard';
import { ReviewList } from '../components/ReviewList';
import { VOTE_RADIUS_M } from '../components/VoteItem';
import { voteBlocker } from '../lib/actions';
import { api, formatHbar, type LiveReports, type MyActivity, type MyReport, type MyVote } from '../lib/api';
import { LEVELS, MUMBAI_CENTER } from '../lib/levels';
import { distanceMeters, placeName, timeAgo, timeLeft } from '../lib/places';
import { navigate } from '../lib/router';
import { useSession } from '../lib/session';
import { useMyVotes } from '../lib/myVotes';
import { usePolling } from '../lib/usePolling';
import { usePosition } from '../lib/usePosition';

const levelInfo = (id: string | null) => LEVELS.find((l) => l.id === id);

/**
 * A reporter's own dashboard: what they reported, what they voted on, what others nearby
 * reported that they can still confirm or dispute, and what it all earned.
 */
export function MePage() {
  const { session, signOut } = useSession();

  if (!session) {
    return (
      <div className="page">
        <header className="page-head">
          <h1>My activity</h1>
          <p className="muted">Your reports, your votes, and what agents paid you for them.</p>
        </header>
        <section className="card">
          <SignInCard why="Sign in to see your reports, your votes and your earnings." />
        </section>
      </div>
    );
  }
  return <Dashboard key={session.token} onSignOut={signOut} />;
}

function Dashboard({ onSignOut }: { onSignOut: () => void }) {
  const { session } = useSession();
  const token = session!.token;
  const activity = usePolling(() => api<MyActivity>('/v1/reporters/me/activity', { token }), 15_000);
  const live = usePolling(
    () => api<LiveReports>(`/v1/reports?lat=${MUMBAI_CENTER[0]}&lng=${MUMBAI_CENTER[1]}&radius=20000`),
    15_000,
  );
  const { position, locate, locating, error: locError, isTest } = usePosition();
  useMyVotes();

  const refresh = () => {
    void activity.refresh();
    void live.refresh();
  };

  const s = activity.data?.summary;
  const others = (live.data?.reports ?? []).filter((r) => r.reporter !== session!.reporter);
  const nearby = position
    ? (live.data?.reports ?? [])
        .map((r) => ({ r, d: distanceMeters(position, r.center) }))
        .filter((x) => x.d <= VOTE_RADIUS_M)
        .sort(
          (a, b) => Number(!!voteBlocker(session, a.r)) - Number(!!voteBlocker(session, b.r)) || a.d - b.d,
        )
        .map((x) => x.r)
    : [];
  const toVote = nearby.filter((r) => !voteBlocker(session, r)).length;

  return (
    <div className="page">
      <header className="page-head">
        <h1>My activity</h1>
        <p className="muted">Your reports, your votes, and what agents paid you for them.</p>
      </header>
      <div className="identity-bar">
        <span className={`pill ${session!.method === 'world' ? 'verified' : 'sim'}`}>
          {session!.method === 'world' ? 'Verified human' : 'Dev identity · simulated'}
        </span>
        <code>{session!.reporter}</code>
        <span className="spacer" />
        <button className="link" onClick={() => navigate('/report')}>
          New report
        </button>
        <button className="link" onClick={onSignOut}>
          Sign out
        </button>
      </div>

      <div className="tiles">
        <div className="tile">
          <span>Reports</span>
          <strong>{s ? s.reports : '–'}</strong>
          <small>{s?.liveReports ?? 0} live now</small>
        </div>
        <div className="tile">
          <span>Votes on your reports</span>
          <strong>
            <em className="pos">+{s?.confirmationsReceived ?? 0}</em>{' '}
            <em className="neg">−{s?.disputesReceived ?? 0}</em>
          </strong>
          <small>confirmed / disputed</small>
        </div>
        <div className="tile">
          <span>Votes you cast</span>
          <strong>{s ? s.votes : '–'}</strong>
          <small>confirm or dispute</small>
        </div>
        <div className="tile accent">
          <span>Earned</span>
          <strong>{s ? formatHbar(s.earnedTinybars) : '–'}</strong>
          <small>your reports were used in {s?.paidAnswers ?? 0} paid agent answers</small>
        </div>
      </div>
      {activity.error && <p className="notice error small">{activity.error}</p>}

      <section className="card">
        <h3>Earnings and payouts</h3>
        <Earnings session={session!} />
      </section>

      <section className="card">
        <h3>Reports to confirm or dispute</h3>
        <p className="muted small">
          You can vote on reports by other people within 1 km of where you are. {others.length} live{' '}
          {others.length === 1 ? 'report' : 'reports'} by others right now
          {isTest ? '' : '; testing from elsewhere? Pick a test location in the top bar'}.
        </p>
        <div className="row">
          {!isTest && (
            <button className="secondary" onClick={locate} disabled={locating}>
              {locating ? 'Locating…' : position ? 'Update my location' : 'Use my location'}
            </button>
          )}
        </div>
        {locError && <p className="notice error small">{locError}</p>}
        {position && (
          <>
            <p className="small">
              <strong>Near {position.label ?? placeName(position)}</strong>
              {isTest && <span className="tag">test location</span>} · {nearby.length}{' '}
              {nearby.length === 1 ? 'report' : 'reports'} within 1 km, <strong>{toVote}</strong> you can
              still vote on.
            </p>
            {nearby.length === 0 ? (
              <p className="empty">Nothing reported within 1 km of here.</p>
            ) : (
              <ReviewList reports={nearby} position={position} onVoted={refresh} />
            )}
          </>
        )}
      </section>

      <section className="card">
        <h3>Your reports</h3>
        {activity.data && activity.data.reports.length === 0 && (
          <p className="empty">
            No reports yet.{' '}
            <button className="link" onClick={() => navigate('/report')}>
              Report what the street looks like
            </button>
          </p>
        )}
        {activity.data?.reports.map((r) => (
          <ReportRow key={r.key} r={r} />
        ))}
      </section>

      <section className="card">
        <h3>Your votes</h3>
        <p className="muted small">
          Votes don't earn by themselves: they decide which reports agents can trust. A report you confirm can
          earn its author when an agent pays for it.
        </p>
        {activity.data && activity.data.votes.length === 0 && <p className="empty">No votes yet.</p>}
        {activity.data?.votes.map((v) => (
          <VoteRow key={v.key} v={v} />
        ))}
      </section>
    </div>
  );
}

function earningNote(r: MyReport): string {
  if (r.source === 'simulated') return 'Simulated: never earns';
  if (r.earningAnswers > 0) {
    return `Used in ${r.paidAnswers} paid ${r.paidAnswers === 1 ? 'answer' : 'answers'}, earned in ${r.earningAnswers}`;
  }
  if (r.paidAnswers > 0) {
    return `Used in ${r.paidAnswers} paid ${r.paidAnswers === 1 ? 'answer' : 'answers'}, but not corroborated then: it earns once another verified human confirms it or reports the same`;
  }
  return r.live ? 'Not used by an agent yet' : 'Never used by an agent';
}

function ReportRow({ r }: { r: MyReport }) {
  const info = levelInfo(r.level);
  const earned = BigInt(r.earnedTinybars) > 0n;
  return (
    <div className="activity-row">
      <span className="swatch" style={{ background: info?.color }} />
      <div className="activity-text">
        <strong>
          {info?.label ?? r.level} · {placeName(r.center)}
          {r.live ? (
            <span className="tag live">live, {r.expiresAt ? `${timeLeft(r.expiresAt)} left` : ''}</span>
          ) : (
            <span className="tag">expired</span>
          )}
          {r.source === 'simulated' && <span className="tag sim">simulated</span>}
        </strong>
        <small>
          {timeAgo(r.reportedAt)} · +{r.confirmations} confirmed / −{r.disputes} disputed
        </small>
        <small>{earningNote(r)}</small>
        <small>
          {r.live && (
            <a href={r.explorer.entity} target="_blank" rel="noreferrer">
              Arkiv entity
            </a>
          )}
          {r.live && r.explorer.tx && ' · '}
          {r.explorer.tx && (
            <a href={r.explorer.tx} target="_blank" rel="noreferrer">
              write tx
            </a>
          )}
        </small>
      </div>
      <div className={`amount ${earned ? 'earned' : ''}`}>{formatHbar(r.earnedTinybars)}</div>
    </div>
  );
}

function VoteRow({ v }: { v: MyVote }) {
  const info = levelInfo(v.report?.level ?? null);
  return (
    <div className="activity-row">
      <span className={`badge ${v.vote === 'confirm' ? 'paid' : 'failed'}`}>
        {v.vote === 'confirm' ? 'Confirmed' : 'Disputed'}
      </span>
      <div className="activity-text">
        <strong>
          {v.report ? `${info?.label ?? v.report.level} · ${placeName(v.report.center)}` : 'A report'}
          {v.report && !v.report.live && <span className="tag">expired</span>}
          {v.report?.source === 'simulated' && <span className="tag sim">simulated</span>}
        </strong>
        <small>
          {timeAgo(v.votedAt)}
          {v.reportEarned && ' · this report earned its author'} ·{' '}
          <a href={v.explorer.entity} target="_blank" rel="noreferrer">
            vote on Arkiv
          </a>
        </small>
      </div>
    </div>
  );
}
