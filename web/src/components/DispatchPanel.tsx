import { formatHbar, type Trip, type TripRoute } from '../lib/api';
import { PASSABILITY } from '../lib/passability';

const VERDICT: Record<TripRoute['verdict'], string> = {
  chosen: 'Chosen',
  rejected: 'Rejected',
  passed_over: 'Not chosen',
};

const VEHICLE: Record<string, string> = { two_wheeler: 'two-wheeler' };

export const timeAgo = (iso: string) => {
  const min = (Date.now() - new Date(iso).getTime()) / 60_000;
  if (min < 1) return 'just now';
  if (min < 60) return `${Math.round(min)} min ago`;
  return `${Math.floor(min / 60)} h ${Math.round(min % 60)} min ago`;
};

function headline(t: Trip): string {
  if (t.outcome === 'held') return 'Held: every route blocked';
  return `Dispatched via ${t.routes.find((r) => r.id === t.chosenRoute)?.name ?? t.chosenRoute}`;
}

/** The latest (or selected) agent dispatch: the decision, its reasons, and what it cost. */
export function DispatchPanel({
  trips,
  selected,
  onSelect,
  unavailable = false,
}: {
  trips: Trip[];
  selected: Trip | null;
  onSelect: (t: Trip) => void;
  /** The API could not be reached: say so rather than "no dispatches". */
  unavailable?: boolean;
}) {
  if (!selected && unavailable) {
    return (
      <section className="dispatch">
        <h3>Latest dispatch</h3>
        <p className="muted small">Dispatches are unavailable right now; retrying.</p>
      </section>
    );
  }
  if (!selected) {
    return (
      <section className="dispatch">
        <h3>Latest dispatch</h3>
        <p className="muted small">
          No dispatches yet. Run the agent with AGENT_API_TOKEN set: <code>npm run agent</code>
        </p>
      </section>
    );
  }
  const t = selected;
  const isLatest = trips[0]?.id === t.id;
  const others = trips.filter((x) => x.id !== t.id).slice(0, 4);
  const payments = t.txIds.length;

  return (
    <section className="dispatch">
      <h3>{isLatest ? 'Latest dispatch' : 'Dispatch'}</h3>
      <div className="dispatch-trip">
        {t.origin.name} → {t.destination.name} · {VEHICLE[t.vehicle] ?? t.vehicle} · {timeAgo(t.createdAt)}
      </div>
      <div className={`dispatch-outcome ${t.outcome}`} role="button" tabIndex={0} onClick={() => onSelect(t)}>
        {t.outcome === 'held' ? '✋ ' : '✓ '}
        {headline(t)}
      </div>

      <ul className="dispatch-routes">
        {t.routes.map((r) => (
          <li key={r.id} className={r.verdict}>
            <span className={`route-pill ${r.verdict}`}>{VERDICT[r.verdict]}</span>
            <span>{r.reason}</span>
          </li>
        ))}
      </ul>

      <details className="fold">
        <summary>
          Details: {formatHbar(t.totalCostTinybars)} for {payments} paid{' '}
          {payments === 1 ? 'query' : 'queries'}
        </summary>
        {t.routes.map((r) => (
          <div key={r.id} className="dispatch-detail">
            <strong className="small">
              {r.name} · {r.distanceKm} km · avg confidence {r.avgConfidence.toFixed(2)}
            </strong>
            <ul>
              {r.checkpoints.map((c) => (
                <li key={c.name} className="small">
                  <span className={`pass-pill ${c.passability}`}>{PASSABILITY[c.passability].label}</span>{' '}
                  <strong>{c.name}</strong>: {c.reason}
                  {c.hashscan && (
                    <>
                      {' '}
                      <a href={c.hashscan} target="_blank" rel="noreferrer">
                        HashScan
                      </a>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
        <p className="muted small">
          {t.paymentsRecorded}/{payments} payments match settled queries in KneeDeep's ledger · data:{' '}
          {t.dataStatus}
        </p>
      </details>
      {(t.dataStatus === 'simulated' || t.dataStatus === 'mixed') && (
        <p className="muted small">Decided on SIMULATED demo data.</p>
      )}

      {others.length > 0 && (
        <>
          <h3 className="dispatch-more">Recent dispatches</h3>
          <ul className="dispatch-list">
            {others.map((x) => (
              <li key={x.id}>
                <button className="link small" onClick={() => onSelect(x)}>
                  <span className={`dot ${x.outcome}`} />
                  {timeAgo(x.createdAt)}: {headline(x)}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
