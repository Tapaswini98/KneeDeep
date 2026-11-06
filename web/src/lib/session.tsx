import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setUnauthorizedHandler } from './api';
import { loadSession, type ReporterSession, saveSession } from './identity';

interface SessionState {
  session: ReporterSession | null;
  /** False until a stored session has been checked with the server. */
  checked: boolean;
  /** Why the last session ended, if the server rejected it (shown in the verify prompt). */
  endedReason: string | null;
  setSession: (s: ReporterSession) => void;
  signOut: (reason?: string) => void;
}

const SessionContext = createContext<SessionState | null>(null);

/**
 * One reporter session shared by the whole app. A stored session is checked with the
 * server on load, and any 401 (expired, or issued in another verifier mode) drops it.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, set] = useState<ReporterSession | null>(loadSession);
  const [checked, setChecked] = useState(false);
  const [endedReason, setEndedReason] = useState<string | null>(null);

  const setSession = useCallback((s: ReporterSession) => {
    saveSession(s);
    setEndedReason(null);
    set(s);
  }, []);

  const signOut = useCallback((reason?: string) => {
    saveSession(null);
    setEndedReason(reason ?? null);
    set(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => signOut('Your session is no longer valid. Please verify again.'));
    return () => setUnauthorizedHandler(null);
  }, [signOut]);

  // Validate whatever was stored before trusting it.
  useEffect(() => {
    const stored = loadSession();
    if (!stored) {
      setChecked(true);
      return;
    }
    // A 401 signs out via the global handler; any other failure (API down) keeps the session.
    api('/v1/identity/me', { token: stored.token })
      .catch(() => undefined)
      .finally(() => setChecked(true));
  }, []);

  const value = useMemo(
    () => ({ session, checked, endedReason, setSession, signOut }),
    [session, checked, endedReason, setSession, signOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
