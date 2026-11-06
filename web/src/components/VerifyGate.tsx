import { useEffect, useState } from 'react';
import { useSession } from '../lib/session';
import { VerifyHuman } from './VerifyHuman';

const DISMISSED_KEY = 'kneedeep.verify-dismissed';

function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(v: boolean): void {
  try {
    if (v) sessionStorage.setItem(DISMISSED_KEY, '1');
    else sessionStorage.removeItem(DISMISSED_KEY);
  } catch {
    // Storage blocked: the prompt just shows again next load.
  }
}

/**
 * On open, ask unverified visitors to prove they are human. Reading the map stays open to
 * everyone; reporting and voting need verification. Reappears if a session is rejected.
 */
export function VerifyGate() {
  const { session, checked, endedReason, setSession } = useSession();
  const [dismissed, setDismissed] = useState(readDismissed);

  // A rejected session re-opens the prompt even if it was dismissed earlier.
  useEffect(() => {
    if (endedReason) {
      writeDismissed(false);
      setDismissed(false);
    }
  }, [endedReason]);

  if (!checked || session || dismissed) return null;

  const dismiss = () => {
    writeDismissed(true);
    setDismissed(true);
  };

  return (
    <div className="gate" role="dialog" aria-modal="true" aria-labelledby="gate-title">
      <div className="gate-card">
        <h2 id="gate-title">Are you a human on the street?</h2>
        <p className="muted">
          KneeDeep only accepts reports and votes from verified unique humans, so nobody can fake a flood.
          Verify once with World ID; KneeDeep never learns who you are.
        </p>
        {endedReason && <p className="notice error small">{endedReason}</p>}
        <VerifyHuman onVerified={setSession} />
        <button className="link" onClick={dismiss}>
          Just browse the map
        </button>
      </div>
    </div>
  );
}
