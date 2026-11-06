import { useState } from 'react';
import { IDKitRequestWidget, proofOfHuman } from '@worldcoin/idkit';
import { ApiError } from '../lib/api';
import { fetchIdentityContext, IdentityContext, openSession, ReporterSession } from '../lib/identity';

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
      setError(err instanceof ApiError ? err.message : 'Could not reach the API.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="verify">
      <button className="primary" onClick={start} disabled={busy}>
        {busy ? 'Starting…' : 'Verify you are human with World ID'}
      </button>
      <p className="muted">One person, one voice. KneeDeep never sees who you are, only that you are unique.</p>
      {error && <p className="notice error">{error}</p>}

      {ctx?.mode === 'world' && (
        <IDKitRequestWidget
          open={open}
          onOpenChange={setOpen}
          app_id={ctx.app_id}
          action={ctx.action}
          rp_context={ctx.rp_context}
          environment={ctx.environment}
          allow_legacy_proofs={false}
          preset={proofOfHuman({ signal: ctx.signal })}
          handleVerify={async (result) => {
            // Throwing here shows the failure inside the widget.
            const session = await openSession(result);
            onVerified(session);
          }}
          onSuccess={() => setOpen(false)}
          onError={(code) => setError(`World ID: ${code}`)}
        />
      )}
    </div>
  );
}
