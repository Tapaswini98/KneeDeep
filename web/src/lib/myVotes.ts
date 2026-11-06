import { useSyncExternalStore } from 'react';

/**
 * Votes this reporter cast, remembered in the browser so a report stops offering Confirm /
 * Dispute the moment a vote succeeds (and after "already voted"), without waiting for a refresh.
 * The server stays the authority: it refuses a second vote either way.
 */
/** 'voted' = the server said we already voted, without saying how. */
type Vote = 'confirm' | 'dispute' | 'voted';

const KEY = 'kneedeep.my-votes';
const listeners = new Set<() => void>();
let votes: Record<string, Record<string, Vote>> = read();

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, Record<string, Vote>>;
  } catch {
    return {};
  }
}

export function rememberVote(reporter: string, reportKey: string, vote: Vote): void {
  votes = { ...votes, [reporter]: { ...votes[reporter], [reportKey]: vote } };
  try {
    localStorage.setItem(KEY, JSON.stringify(votes));
  } catch {
    // Storage blocked: remembered until reload.
  }
  for (const l of listeners) l();
}

export function myVote(reporter: string | undefined, reportKey: string): Vote | undefined {
  return reporter ? votes[reporter]?.[reportKey] : undefined;
}

/** Re-render when a vote is remembered anywhere in the app. */
export function useMyVotes() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => votes,
  );
}
