import { useEffect, useRef, useState } from 'react';
import { api, type Coverage } from './api';

type BBox = [number, number, number, number];

const REFRESH_MS = 15_000;

/**
 * Coverage for the visible area while `enabled`. Panning and zooming fire a request per view, and
 * answers can arrive out of order, so every new request aborts the previous one: what is drawn is
 * always the answer for the current view. Refreshes every 15 s while the tab is visible.
 */
export function useCoverage(enabled: boolean, bbox: BBox | null) {
  const [data, setData] = useState<Coverage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const key = bbox?.map((n) => n.toFixed(4)).join(',') ?? null;

  useEffect(() => {
    if (!enabled || !key) {
      setData(null);
      return;
    }
    const load = async () => {
      inFlight.current?.abort();
      const ctrl = new AbortController();
      inFlight.current = ctrl;
      try {
        const res = await api<Coverage>(`/v1/coverage?bbox=${key}`, { signal: ctrl.signal });
        if (ctrl.signal.aborted) return;
        setData(res);
        setError(null);
      } catch (err) {
        if (ctrl.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    };
    void load();
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, REFRESH_MS);
    return () => {
      clearInterval(id);
      inFlight.current?.abort();
    };
  }, [enabled, key]);

  return { data, error };
}
