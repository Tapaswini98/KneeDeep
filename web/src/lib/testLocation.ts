import { useSyncExternalStore } from 'react';

/**
 * Test location: lets a tester "stand" at a known spot instead of using GPS, so voting and
 * reporting can be tried from anywhere. Only honoured outside production (App enables it from
 * /health). The server cannot verify GPS anyway: the 1 km rule keeps honest clients local, it is
 * not a proof, so this removes no protection. Production always uses real GPS.
 */
export interface TestLocation {
  name: string;
  lat: number;
  lng: number;
}

const KEY = 'kneedeep.test-location';
const listeners = new Set<() => void>();
let allowed = false;
let current: TestLocation | null = read();

function read(): TestLocation | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null') as TestLocation | null;
  } catch {
    return null;
  }
}

function emit() {
  snapshot = { allowed, location: allowed ? current : null };
  for (const l of listeners) l();
}

let snapshot = { allowed, location: null as TestLocation | null };

export function setTestLocationAllowed(value: boolean): void {
  if (allowed === value) return;
  allowed = value;
  emit();
}

export function setTestLocation(location: TestLocation | null): void {
  current = location;
  try {
    if (location) localStorage.setItem(KEY, JSON.stringify(location));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the choice lasts until reload.
  }
  emit();
}

/** The location to use instead of GPS, or null (production, or none chosen). */
export function activeTestLocation(): TestLocation | null {
  return allowed ? current : null;
}

export function useTestLocation() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snapshot,
  );
}
