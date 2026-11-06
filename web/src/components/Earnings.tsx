import { type FormEvent, useState } from 'react';
import { errorText } from '../lib/actions';
import { api, formatHbar, type ReporterEarnings } from '../lib/api';
import type { ReporterSession } from '../lib/identity';
import { usePolling } from '../lib/usePolling';

/**
 * What this reporter has earned and where it is paid. Earnings come from paid agent queries
 * that used their live, corroborated reports; payouts are batched Hedera transfers.
 */
export function Earnings({ session }: { session: ReporterSession }) {
  const me = usePolling(() => api<ReporterEarnings>('/v1/reporters/me', { token: session.token }), 15_000);
  const [account, setAccount] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (session.method !== 'world') {
    return <p className="muted small">Dev identity: simulated reports never earn.</p>;
  }
  const e = me.data;
  if (!e) return me.error ? <p className="notice error small">{me.error}</p> : null;

  const save = async (ev: FormEvent) => {
    ev.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api<ReporterEarnings>('/v1/reporters/me/payout-account', {
        method: 'PUT',
        token: session.token,
        body: JSON.stringify({ accountId: account.trim() || null }),
      });
      setEditing(false);
      await me.refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const showForm = editing || !e.payoutAccount;

  return (
    <div className="earnings">
      <div className="stats">
        <div>
          <strong>{formatHbar(e.owedTinybars)}</strong>
          <span>owed</span>
        </div>
        <div>
          <strong>{formatHbar(e.inFlightTinybars)}</strong>
          <span>being paid</span>
        </div>
        <div>
          <strong>{formatHbar(e.paidTinybars)}</strong>
          <span>paid</span>
        </div>
      </div>
      <p className="muted small">
        {e.queriesCredited} paid agent {e.queriesCredited === 1 ? 'query' : 'queries'} used your reports.{' '}
        {e.rule}
      </p>

      {showForm ? (
        <form className="payout-form" onSubmit={save}>
          <label className="small" htmlFor="payout-account">
            Hedera account for payouts (testnet)
          </label>
          <div className="payout-row">
            <input
              id="payout-account"
              placeholder="0.0.1234567"
              value={account}
              onChange={(ev) => setAccount(ev.target.value)}
              inputMode="decimal"
              autoComplete="off"
            />
            <button type="submit" disabled={saving || !account.trim()}>
              {saving ? 'Checking…' : 'Save'}
            </button>
            {e.payoutAccount && (
              <button type="button" className="link" onClick={() => setEditing(false)}>
                cancel
              </button>
            )}
          </div>
          <span className="muted small">
            Payouts are public on Hedera: use an account you are happy to link to your reports.
          </span>
        </form>
      ) : (
        <p className="small">
          Paid to{' '}
          <a href={e.payoutAccountUrl ?? '#'} target="_blank" rel="noreferrer">
            {e.payoutAccount}
          </a>{' '}
          <button
            className="link"
            onClick={() => {
              setAccount(e.payoutAccount ?? '');
              setEditing(true);
            }}
          >
            change
          </button>
        </p>
      )}
      {error && <p className="notice error small">{error}</p>}

      {e.payouts.length > 0 && (
        <ul className="payout-list">
          {e.payouts.map((p) => (
            <li key={p.id} className="small">
              {formatHbar(p.amountTinybars)}
              {p.settledAt && ` · ${new Date(p.settledAt).toLocaleString()}`}
              {p.hashscan && (
                <>
                  {' · '}
                  <a href={p.hashscan} target="_blank" rel="noreferrer">
                    HashScan
                  </a>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
