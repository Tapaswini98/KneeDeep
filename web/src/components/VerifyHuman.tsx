import { useState } from 'react';
import { IDKitRequestWidget, proofOfHuman } from '@worldcoin/idkit';
import { errorText } from '../lib/actions';
import { api } from '../lib/api';
import {
  fetchIdentityContext,
  type IdentityContext,
  openSession,
  type ReporterSession,
} from '../lib/identity';

/** World App / bridge error codes, in words a tester can act on. */
const WORLD_ERRORS: Record<string, string> = {
  user_rejected: 'You cancelled the request in World App.',
  verification_rejected: 'World App declined the verification.',
  credential_unavailable:
    'This World ID has no Proof of Human credential (needs Orb verification). In the simulator, verify the identity with the Orb first.',
  world_id_4_not_available:
    'This World App cannot produce a World ID 4.0 proof yet. Ask the operator to set WORLD_ALLOW_LEGACY_PROOFS=true.',
  max_verifications_reached: 'This World ID has already used this action the maximum number of times.',
  nullifier_replayed: 'This proof was already used. Start a new verification.',
  invalid_rp_signature: 'The server signature was rejected: check WORLD_RP_ID and WORLD_RP_SIGNING_KEY.',
  rp_signature_expired: 'The request expired (5 min). Start again.',
  unknown_rp: 'World does not know this RP: check WORLD_RP_ID and the environment (production vs staging).',
  inactive_rp: 'The World ID app is not active in this environment.',
  connection_failed: 'Could not connect to World App. Scan the QR code again.',
  timeout: 'Timed out waiting for World App.',
};

function reportWorldError(code: string, debugReport: unknown): Promise<unknown> {
  return api('/v1/identity/client-error', {
    method: 'POST',
    body: JSON.stringify({ code, debug: debugReport ?? null }),
  }).catch(() => undefined);
}

/**
 * Proof of Human, once per session. The IDKit result goes to our server untouched;
 * the server verifies it with World and returns a reporter session.
 */
export function VerifyHuman({ onVerified }: { onVerified: (s: ReporterSession) => void }) {
  const [ctx, setCtx] = useState<IdentityContext | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      // Fresh every time: the RP signature inside expires after 5 minutes.
      const c = await fetchIdentityContext();
      setCtx(c);
      if (c.mode === 'dev') {
        // Dev mode proves nothing; the server labels everything from this identity as simulated.
        const devId = `web-${crypto.randomUUID().slice(0, 8)}`;
        onVerified(await openSession({ devId }));
      } else {
        setOpen(true);
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="verify">
      <button className="primary" onClick={start} disabled={busy}>
        {busy ? 'Starting…' : 'Verify you are human with World ID'}
      </button>
      <p className="muted small">
        One person, one voice. KneeDeep never learns who you are, only that you are unique.
      </p>
      {ctx?.mode === 'world' && ctx.environment === 'staging' && (
        <p className="muted small">
          Testing mode: open the{' '}
          <a href="https://simulator.worldcoin.org" target="_blank" rel="noreferrer">
            World ID simulator
          </a>
          , give its identity an Orb credential, then paste the QR link (click the QR to copy it).
        </p>
      )}
      {error && <p className="notice error small">{error}</p>}

      {ctx?.mode === 'world' && (
        <IDKitRequestWidget
          open={open}
          onOpenChange={setOpen}
          app_id={ctx.app_id}
          action={ctx.action}
          rp_context={ctx.rp_context}
          environment={ctx.environment}
          allow_legacy_proofs={ctx.allow_legacy_proofs}
          preset={proofOfHuman({ signal: ctx.signal })}
          handleVerify={async (result) => {
            try {
              onVerified(await openSession(result));
            } catch (err) {
              // Shown under the button too, since the widget only shows a generic failure.
              setError(errorText(err));
              throw err;
            }
          }}
          onSuccess={() => setOpen(false)}
          onError={(code, debugReport) => {
            setError(
              `${WORLD_ERRORS[code] ?? 'World ID could not complete the verification.'} (code: ${code})`,
            );
            // The proof never reached our server, so report what World's SDK saw: it makes
            // simulator / World App failures visible in the server logs.
            console.warn('World ID error', code, debugReport);
            void reportWorldError(code, debugReport);
          }}
        />
      )}
    </div>
  );
}
