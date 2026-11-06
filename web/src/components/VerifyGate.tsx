import { useSession } from '../lib/session';
import { VerifyHuman } from './VerifyHuman';

/**
 * Sign in with World ID. Opens from the top bar's "Sign in", when the server rejects a session,
 * and once on entering the app (`auto`; not on the landing page). Reading stays open to everyone;
 * reporting and voting need verification. No Escape-to-close: World ID's own dialog opens on top,
 * and closing this one underneath would cancel a verification in progress.
 */
export function VerifyGate({ auto }: { auto: boolean }) {
  const { session, checked, endedReason, setSession, prompt, closeSignIn } = useSession();
  const visible = checked && !session && (prompt === 'open' || (prompt === 'auto' && auto));

  if (!visible) return null;

  return (
    <div
      className="gate"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gate-title"
      onClick={(e) => e.target === e.currentTarget && closeSignIn()}
    >
      <div className="gate-card">
        <button className="gate-close" onClick={closeSignIn} aria-label="Close">
          ×
        </button>
        <span className="gate-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="26" height="26">
            <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
            <circle cx="12" cy="12" r="3.2" fill="currentColor" />
          </svg>
        </span>
        <h2 id="gate-title">Sign in with World ID</h2>
        <p className="muted">
          KneeDeep only accepts reports and votes from verified unique humans, so nobody can fake a flood.
          Verify once; KneeDeep never learns who you are, only that you are a unique person.
        </p>
        {endedReason && <p className="notice error small">{endedReason}</p>}
        <VerifyHuman onVerified={setSession} />
        <button className="link" onClick={closeSignIn}>
          Not now, just browse
        </button>
      </div>
    </div>
  );
}
