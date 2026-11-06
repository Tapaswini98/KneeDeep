import { useEffect, useState } from 'react';
import { VerifyGate } from './components/VerifyGate';
import { api, type Health } from './lib/api';
import { MapPage } from './pages/MapPage';
import { ReportPage } from './pages/ReportPage';

const ROUTES = { '/': 'Live map', '/report': 'Report' } as const;
type Route = keyof typeof ROUTES;

function currentRoute(): Route {
  return window.location.pathname === '/report' ? '/report' : '/';
}

export function App() {
  const [route, setRoute] = useState<Route>(currentRoute);
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    const onPop = () => setRoute(currentRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    api<Health>('/health')
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  const go = (to: Route) => {
    window.history.pushState(null, '', to);
    setRoute(to);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <strong>KneeDeep</strong>
          <span className="tagline">Street-level truth for AI agents</span>
        </div>
        <nav>
          {(Object.keys(ROUTES) as Route[]).map((r) => (
            <button key={r} className={r === route ? 'active' : ''} onClick={() => go(r)}>
              {ROUTES[r]}
            </button>
          ))}
        </nav>
        {health?.env && health.env !== 'production' && (
          <span className="env-badge" title="Deployment tier">
            {health.env}
            {health.worldEnvironment === 'staging' ? ' · World ID simulator' : ''}
          </span>
        )}
        <span className={`status ${health?.ok ? 'up' : 'down'}`} title={JSON.stringify(health)}>
          {health ? (health.ok ? 'API up' : 'API degraded') : 'API down'}
        </span>
      </header>
      <main>{route === '/report' ? <ReportPage /> : <MapPage />}</main>
      <VerifyGate />
    </div>
  );
}
