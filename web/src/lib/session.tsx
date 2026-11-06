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
  /** Sign out. With a reason (server rejected the session) the sign-in prompt reopens. */
  signOut: (reason?: string) => void;
  /**
   * The sign-in prompt: 'auto' shows once on entering the app, 'open' was asked for (Sign in button
   * or a rejected session), 'closed' was dismissed or not wanted (e.g. after signing out).
   */
  prompt: 'auto' | 'open' | 'closed';
  openSignIn: () => void;
  closeSignIn: () => void;
}

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
    // Storage blocked: the prompt may show again next load.
  }
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
  const [prompt, setPrompt] = useState<SessionState['prompt']>(() => (readDismissed() ? 'closed' : 'auto'));

  const setSession = useCallback((s: ReporterSession) => {
    saveSession(s);
    setEndedReason(null);
    setPrompt('closed');
    set(s);
  }, []);

  const signOut = useCallback((reason?: string) => {
    saveSession(null);
    setEndedReason(reason ?? null);
    if (reason) {
      writeDismissed(false);
      setPrompt('open');
    } else {
      // The user chose to sign out: don't immediately ask them to sign in again.
      writeDismissed(true);
      setPrompt('closed');
    }
    set(null);
  }, []);

  const openSignIn = useCallback(() => setPrompt('open'), []);
  const closeSignIn = useCallback(() => {
    writeDismissed(true);
    setPrompt('closed');
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
    () => ({ session, checked, endedReason, setSession, signOut, prompt, openSignIn, closeSignIn }),
    [session, checked, endedReason, setSession, signOut, prompt, openSignIn, closeSignIn],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
