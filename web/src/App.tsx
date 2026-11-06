import { useEffect, useState } from 'react';
import { AccountMenu } from './components/AccountMenu';
import { TestLocationPicker } from './components/TestLocationPicker';
import { VerifyGate } from './components/VerifyGate';
import { api, type Health } from './lib/api';
import { navigate } from './lib/router';
import { setTestLocationAllowed } from './lib/testLocation';
import { HomePage } from './pages/HomePage';
import { MapPage } from './pages/MapPage';
import { MePage } from './pages/MePage';
import { ReportPage } from './pages/ReportPage';

const ROUTES = { '/': 'Home', '/map': 'Live map', '/report': 'Report', '/me': 'My activity' } as const;
type Route = keyof typeof ROUTES;

function currentRoute(): Route {
  const path = window.location.pathname;
  return path in ROUTES ? (path as Route) : '/';
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
      .then((h) => {
        setHealth(h);
        // Test locations exist for testing only; unknown tier counts as production.
        setTestLocationAllowed(Boolean(h.env) && h.env !== 'production');
      })
      .catch(() => setHealth(null));
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => navigate('/')}>
          <svg className="logo" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
            <rect width="32" height="32" rx="9" fill="currentColor" opacity="0.14" />
            <path d="M16 5c4 5.2 7 9.3 7 13a7 7 0 1 1-14 0c0-3.7 3-7.8 7-13Z" fill="#5cc2ff" />
            <path
              d="M9.3 19.5c2.2 1.3 4.4 1.3 6.7 0s4.5-1.3 6.7 0"
              stroke="#fff"
              strokeWidth="1.8"
              fill="none"
            />
          </svg>
          <span>
            <strong>KneeDeep</strong>
            <span className="tagline">Street-level truth for AI agents</span>
          </span>
        </button>
        <nav>
          {(Object.keys(ROUTES) as Route[]).map((r) => (
            <button key={r} className={r === route ? 'active' : ''} onClick={() => navigate(r)}>
              {ROUTES[r]}
            </button>
          ))}
        </nav>
        <div className="topbar-right">
          <TestLocationPicker />
          {health?.env && health.env !== 'production' && (
            <span className="env-badge" title="Deployment tier">
              {health.env}
              {health.worldEnvironment === 'staging' ? ' · World ID simulator' : ''}
            </span>
          )}
          <span className={`status ${health?.ok ? 'up' : 'down'}`} title={JSON.stringify(health)}>
            <i />
            {health ? (health.ok ? 'API up' : 'API degraded') : 'API down'}
          </span>
          <AccountMenu />
        </div>
      </header>
      <main>
        {route === '/map' ? (
          <MapPage />
        ) : route === '/report' ? (
          <ReportPage />
        ) : route === '/me' ? (
          <MePage />
        ) : (
          <HomePage />
        )}
      </main>
      {/* Auto-prompt in the app, not on the landing page; Sign in opens it anywhere. */}
      <VerifyGate auto={route !== '/'} />
    </div>
  );
}
