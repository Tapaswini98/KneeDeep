import { api, type Verification } from './api';
import { usePolling } from './usePolling';

/** The latest CRE attestation (null while loading, or when verification is not configured). */
export function useVerification() {
  const { data } = usePolling(() => api<Verification>('/v1/verification').catch(() => null), 60_000);
  return data && data.enabled ? data : null;
}
