import { CreBadge } from '../components/CreBadge';
import { type Activity, api, formatHbar, type LiveReports } from '../lib/api';
import { LEVELS, MUMBAI_CENTER } from '../lib/levels';
import { placeName, timeAgo } from '../lib/places';
import { navigate } from '../lib/router';
import { usePolling } from '../lib/usePolling';
import { useVerification } from '../lib/useVerification';

/** What each level means for a vehicle; the dispatch agent routes on the same rules. */
const ROUTING: Record<string, string> = {
  dry: 'Clear for every vehicle',
  ankle: 'Passable, slow down',
  knee: 'Scooters stall: route around',
  waist: 'Cars stall: avoid',
  closed: 'Blocked: no way through',
};

const steps = (share: number, price: string) => [
  {
    title: 'Verify once',
    body: 'World ID Proof of Human: one person, one voice. KneeDeep never learns who you are.',
    tag: 'World ID',
  },
  {
    title: 'Report in one tap',
    body: 'Pick a level where you stand. It is written to Arkiv as a public entity that expires in 3 hours.',
    tag: 'Arkiv',
  },
  {
    title: 'Agents pay per answer',
    body: `Dispatch agents pay ${price} per query over x402, no human in the loop, and get a level with an explainable confidence.`,
    tag: 'Hedera x402',
  },
  {
    title: 'Humans get paid',
    body: `${share}% of every payment goes to the verified reporters whose corroborated reports were used, in one batched transfer.`,
    tag: 'Hedera',
  },
];

const PILLARS = [
  {
    name: 'World ID',
    line: 'Uniqueness without identity: a flood cannot be faked by one person with a hundred accounts.',
  },
  {
    name: 'Arkiv',
    line: 'Reports are public and perishable: anyone can read them, and they disappear when the water does.',
  },
  {
    name: 'Hedera',
    line: 'Agents pay per query in HBAR via x402, and reporters are paid back in batched transfers.',
  },
  {
    name: 'Chainlink CRE',
    line: "Don't trust KneeDeep either: a Chainlink DON recomputes every area from the public evidence and attests it on Sepolia.",
  },
];

const levelInfo = (id: string | null) => LEVELS.find((l) => l.id === id);

/** Landing page: what KneeDeep is, the five levels, how the money flows, and what is live right now. */
export function HomePage() {
  const activity = usePolling(() => api<Activity>('/v1/activity?limit=8'), 20_000);
  const live = usePolling(
    () => api<LiveReports>(`/v1/reports?lat=${MUMBAI_CENTER[0]}&lng=${MUMBAI_CENTER[1]}&radius=20000`),
    20_000,
  );
  const a = activity.data;
  const verification = useVerification();
  const share = a?.payouts.reporterSharePercent ?? 70;
  const price = a?.price ? formatHbar(a.price.amount) : '0.1 HBAR';

  // The latest answers agents paid for: one per place, worst level first.
  const answers = (a?.queries ?? [])
    .filter((q) => q.paid && q.summary[0])
    .map((q) => ({ q, area: q.summary[0] }))
    .filter((x, i, all) => all.findIndex((y) => y.area.cell === x.area.cell) === i)
    .slice(0, 4);
  // Feature the most severe recent answer (contested counts as severe: unknown is not safe).
  const severity = (level: string | null) =>
    level === null ? LEVELS.length : LEVELS.findIndex((l) => l.id === level);
  const featured = [...answers].sort((x, y) => severity(y.area.level) - severity(x.area.level))[0];

  return (
    <div className="home">
      <section className="hero">
        <div className="hero-inner">
          <div className="hero-copy">
            <span className="eyebrow">Mumbai monsoon · live testnet demo</span>
            <h1>
              Street-level truth
              <br />
              for AI agents.
            </h1>
            <p className="lead">
              Weather APIs tell an agent it rained. KneeDeep tells it the Andheri subway is{' '}
              <mark style={{ ['--mark' as string]: levelInfo('knee')?.color }}>knee-deep right now</mark>,
              from verified humans standing there.
            </p>
            <div className="hero-actions">
              <button className="primary big" onClick={() => navigate('/map')}>
                Open the live map
              </button>
              <button className="ghost big" onClick={() => navigate('/report')}>
                Report a street
              </button>
            </div>
          </div>

          <div className="hero-visual" aria-hidden="true">
            <div className="gauge">
              {[...LEVELS].reverse().map((l) => (
                <div key={l.id} className="gauge-band" style={{ background: l.color }}>
                  <span>{l.label}</span>
                </div>
              ))}
            </div>
            <div className="answer-card">
              <span className="answer-label">{featured ? 'A recent paid answer' : 'Example answer'}</span>
              <div className="answer-head">
                <span
                  className="swatch big"
                  style={{ background: levelInfo(featured?.area.level ?? 'knee')?.color ?? '#999' }}
                />
                <div>
                  <strong>
                    {featured ? placeName({ lat: featured.q.lat, lng: featured.q.lng }) : 'Andheri subway'}
                  </strong>
                  <small>{levelInfo(featured?.area.level ?? 'knee')?.label ?? 'Contested'}</small>
                </div>
                <span className={`conf ${featured?.area.confidenceLabel ?? 'high'}`}>
                  {(featured?.area.confidence ?? 0.9).toFixed(2)} {featured?.area.confidenceLabel ?? 'high'}
                </span>
              </div>
              <p>
                {featured?.area.explanation ??
                  '4 independent humans report knee-deep water; newest 10 min ago; 1 confirmation.'}
              </p>
              <small className="muted">
                {featured
                  ? `Paid ${formatHbar(featured.q.amountTinybars)} · ${timeAgo(featured.q.createdAt)}`
                  : price}
              </small>
            </div>
          </div>
        </div>
        <svg className="wave" viewBox="0 0 1440 80" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 40c120-26 240-26 360 0s240 26 360 0 240-26 360 0 240 26 360 0v40H0Z" />
        </svg>
      </section>

      <div className="home-body">
        <div className="tiles home-stats">
          <div className="tile">
            <span>Live reports</span>
            <strong>{live.data ? live.data.reports.length : '–'}</strong>
            <small>on Arkiv, expiring</small>
          </div>
          <div className="tile">
            <span>Paid agent queries</span>
            <strong>{a ? a.totals.paidQueries : '–'}</strong>
            <small>settled on Hedera</small>
          </div>
          <div className="tile">
            <span>Agent revenue</span>
            <strong>{a ? formatHbar(a.totals.revenueTinybars) : '–'}</strong>
            <small>{price} per query</small>
          </div>
          <div className="tile accent">
            <span>Paid to humans</span>
            <strong>{a ? formatHbar(a.payouts.paidOutTinybars) : '–'}</strong>
            <small>{share}% of every paid query</small>
          </div>
        </div>

        <section className="home-section">
          <div className="section-head">
            <h2>Five levels, one tap</h2>
            <p className="muted">
              Everyone reports on the same scale, and agents route on it. Absence of reports is never read as
              dry.
            </p>
          </div>
          <div className="level-cards">
            {LEVELS.map((l) => (
              <div key={l.id} className="level-card" style={{ ['--level' as string]: l.color }}>
                <span className="level-chip" />
                <strong>{l.label}</strong>
                <small>{l.hint}</small>
                <span className="routing">{ROUTING[l.id]}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="home-section">
          <div className="section-head">
            <h2>How it works</h2>
            <p className="muted">
              From a person on the street to an agent's routing decision, and back as payment.
            </p>
          </div>
          <ol className="steps">
            {steps(share, price).map((s, i) => (
              <li key={s.title} style={{ ['--level' as string]: LEVELS[i + 1]?.color ?? LEVELS[0].color }}>
                <span className="step-num">{i + 1}</span>
                <strong>{s.title}</strong>
                <p>{s.body}</p>
                <span className="tag">{s.tag}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="home-section split">
          <div>
            <div className="section-head">
              <h2>What agents were told</h2>
              <p className="muted">
                The latest answers dispatch agents paid for, with the evidence behind them.
              </p>
            </div>
            {answers.length === 0 ? (
              <p className="empty">No paid queries yet. Run the dispatch agent: npm run demo:agent</p>
            ) : (
              <div className="answers">
                {answers.map(({ q, area }) => {
                  const info = levelInfo(area.level);
                  return (
                    <div
                      key={q.id}
                      className="answer-row"
                      style={{ ['--level' as string]: info?.color ?? '#999' }}
                    >
                      <div className="answer-row-head">
                        <strong>
                          {info?.label ?? 'Contested'} · {placeName({ lat: q.lat, lng: q.lng })}
                        </strong>
                        <CreBadge v={verification} cell={area.cell} level={area.level} />
                        <span className={`conf ${area.confidenceLabel}`}>
                          {area.confidence.toFixed(2)} {area.confidenceLabel}
                        </span>
                      </div>
                      <p>{area.explanation}</p>
                      <small className="muted">
                        {timeAgo(q.createdAt)} · paid {formatHbar(q.amountTinybars)}
                        {area.source !== 'live' && ' · includes simulated data'}
                        {q.hashscan && (
                          <>
                            {' · '}
                            <a href={q.hashscan} target="_blank" rel="noreferrer">
                              HashScan
                            </a>
                          </>
                        )}
                      </small>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div>
            <div className="section-head">
              <h2>Built on</h2>
              <p className="muted">Each piece does one job it is uniquely good at.</p>
            </div>
            <div className="pillars">
              {PILLARS.map((p) => (
                <div key={p.name} className="pillar">
                  <strong>{p.name}</strong>
                  <p>{p.line}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="cta">
          <div>
            <h2>Seen water on the road?</h2>
            <p>Verify once, report in a tap, and get paid when agents use it.</p>
          </div>
          <div className="hero-actions">
            <button className="primary big" onClick={() => navigate('/report')}>
              Report now
            </button>
            <button className="ghost big" onClick={() => navigate('/me')}>
              My activity
            </button>
          </div>
        </section>

        <footer className="home-footer muted">
          Runs on Hedera testnet and Arkiv's Rabdi testnet. Simulated data is always labelled. Locations are
          stored as ~150 m cells, and no one's identity is stored.
        </footer>
      </div>
    </div>
  );
}
