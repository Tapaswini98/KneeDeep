import { createContext, ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { loadSession, ReporterSession, saveSession } from './identity';

interface SessionState {
  session: ReporterSession | null;
  setSession: (s: ReporterSession) => void;
  signOut: () => void;
}

const SessionContext = createContext<SessionState | null>(null);

/** One reporter session shared by the map and the report page. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, set] = useState<ReporterSession | null>(loadSession);
  const setSession = useCallback((s: ReporterSession) => {
    saveSession(s);
    set(s);
  }, []);
  const signOut = useCallback(() => {
    saveSession(null);
    set(null);
  }, []);
  const value = useMemo(() => ({ session, setSession, signOut }), [session, setSession, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
