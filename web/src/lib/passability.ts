import type { CoverageState, Passability } from './api';

/** Passability: what the street looks like for the vehicle. Text labels always accompany colour. */
export const PASSABILITY: Record<Passability, { label: string; color: string; hint: string }> = {
  safe: { label: 'Safe', color: '#1d8a4b', hint: 'Corroborated: dry or shallow' },
  risky: { label: 'Risky', color: '#d98b0b', hint: 'Water reported, not corroborated' },
  blocked: { label: 'Blocked', color: '#c23a2b', hint: 'Corroborated water this vehicle cannot cross' },
  unknown: { label: 'Unknown', color: '#6b7785', hint: 'No data, contested or stale: not dry' },
};

/** Coverage: how much you can trust what we know. */
export const COVERAGE: Record<CoverageState | 'none', { label: string; color: string; hint: string }> = {
  corroborated: { label: 'Corroborated', color: '#1d8a4b', hint: '2+ humans, fresh, not contested' },
  unverified: { label: 'Unverified', color: '#e0a100', hint: 'One human, or aging evidence' },
  conflicting: { label: 'Conflicting', color: '#7b3fb8', hint: 'Disputed or contradicting reports' },
  stale: { label: 'Stale', color: '#8a96a3', hint: 'Newest evidence over 90 min old' },
  none: { label: 'No data', color: '#8a96a3', hint: 'Unknown, not dry' },
};
