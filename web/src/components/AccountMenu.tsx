import { useEffect, useRef, useState } from 'react';
import { navigate } from '../lib/router';
import { useSession } from '../lib/session';

/** A colour derived from the pseudonymous reporter id, so people can tell sessions apart. */
function avatarColor(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 65% 45%)`;
}

/** Top-bar account control: "Sign in with World ID", or the signed-in reporter with a menu. */
export function AccountMenu() {
  const { session, checked, openSignIn, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!checked) return null;

  if (!session) {
    return (
      <button className="signin" onClick={openSignIn}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
          <circle cx="12" cy="12" r="3.2" fill="currentColor" />
        </svg>
        Sign in with World ID
      </button>
    );
  }

  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };
  const until = new Date(session.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const verified = session.method === 'world';

  return (
    <div className="account" ref={ref}>
      <button
        className="account-button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="avatar" style={{ background: avatarColor(session.reporter) }}>
          {session.reporter.slice(0, 2).toUpperCase()}
        </span>
        <span className="account-label">{verified ? 'Verified' : 'Dev identity'}</span>
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      </button>
      {open && (
        <div className="account-menu" role="menu">
          <div className="account-head">
            <span className="avatar big" style={{ background: avatarColor(session.reporter) }}>
              {session.reporter.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <strong>{verified ? 'Verified human' : 'Dev identity (simulated)'}</strong>
              <small>
                {verified ? 'World ID' : 'No proof'} · <code>{session.reporter}</code>
              </small>
              <small>Signed in until {until}</small>
            </div>
          </div>
          <button role="menuitem" onClick={() => go('/me')}>
            My activity and earnings
          </button>
          <button role="menuitem" onClick={() => go('/report')}>
            New report
          </button>
          <button
            role="menuitem"
            className="danger"
            onClick={() => {
              setOpen(false);
              signOut();
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
