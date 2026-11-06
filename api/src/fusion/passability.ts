/**
 * Passability: can a given vehicle get through this ~150 m area right now?
 * Derived from the fusion answer and nothing else, so the API and every agent agree. Pure.
 *
 * Rules, first match wins:
 *   1. no fresh reports                                unknown   (no data is not dry)
 *   2. contested (disputes outweigh every level)       unknown
 *   3. newest evidence older than STALE_AFTER_MIN      unknown
 *   4-5. corroborated level the vehicle cannot cross   blocked   (two-wheeler: knee or worse)
 *   6. any flood level, not corroborated               risky
 *   7. corroborated dry or shallow water               safe
 *   8. dry, not corroborated                           unknown
 *
 * "Corroborated" means medium or high confidence AND at least two independent humans. Confidence
 * alone is not enough: one fresh report reaches "medium", and `safe` must always rest on more than
 * one person's word. Absence of reports never makes an area safe.
 */
import { type Level, LEVELS } from '../arkiv/vocabulary';
import { type CellAnswer, DEFAULT_MAX_AGE_MIN } from './fusion';

export type Passability = 'safe' | 'risky' | 'blocked' | 'unknown';

export const VEHICLES = {
  // A scooter or motorbike stalls in knee-deep water.
  two_wheeler: { label: 'two-wheeler', impassableFrom: 'knee' as Level },
} as const;
export type Vehicle = keyof typeof VEHICLES;
export const DEFAULT_VEHICLE: Vehicle = 'two_wheeler';

/** Evidence older than this no longer says anything about the street now, even before it expires. */
export const STALE_AFTER_MIN = 90;

/** Worst first, for picking the evidence that decides a checkpoint and for ranking routes. */
export const PASSABILITY_RANK: Record<Passability, number> = { blocked: 3, risky: 2, unknown: 1, safe: 0 };

export interface PassabilityResult {
  passability: Passability;
  reason: string;
}

type Evidence = Pick<CellAnswer, 'level' | 'confidence' | 'confidenceLabel' | 'inputs' | 'reports'>;

const severity = (l: Level) => LEVELS.indexOf(l);

const WATER: Record<Level, string> = {
  dry: 'dry',
  ankle: 'ankle-deep water',
  knee: 'knee-deep water',
  waist: 'waist-deep water',
  closed: 'the road closed',
};

const SHORT: Record<Level, string> = {
  dry: 'dry',
  ankle: 'ankle-deep',
  knee: 'knee-deep',
  waist: 'waist-deep',
  closed: 'closed',
};

const humans = (n: number) => (n === 1 ? '1 human reports' : `${n} humans report`);

export function formatAge(min: number): string {
  if (min < 1) return 'just now';
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function isCorroborated(a: Evidence): boolean {
  return a.level !== null && a.confidenceLabel !== 'low' && a.inputs.supportingHumans >= 2;
}

function disagreement(a: Evidence): string {
  const byLevel = new Map<Level, number>();
  for (const r of a.reports) byLevel.set(r.level, (byLevel.get(r.level) ?? 0) + 1);
  const said = [...byLevel.entries()]
    .sort((x, y) => y[1] - x[1] || severity(y[0]) - severity(x[0]))
    .map(([level, n]) => `${n} ${n === 1 ? 'says' : 'say'} ${SHORT[level]}`);
  if (said.length > 1) return `Reports disagree: ${said.join(', ')}.`;
  const d = a.inputs.disputes;
  return `Disputed: ${said[0] ?? 'the reports'}, but ${d} ${d === 1 ? 'human disputes' : 'humans dispute'} it.`;
}

export function derivePassability(
  area: Evidence | null,
  vehicle: Vehicle = DEFAULT_VEHICLE,
  maxAgeMin = DEFAULT_MAX_AGE_MIN,
): PassabilityResult {
  // 1. No data.
  if (!area) {
    return {
      passability: 'unknown',
      reason: `No reports in the last ${formatAge(maxAgeMin)}. No data is not dry.`,
    };
  }
  // 2. Contested.
  if (area.level === null) return { passability: 'unknown', reason: disagreement(area) };

  // 3. Stale.
  const age = area.inputs.newestEvidenceAgeMin;
  if (age > STALE_AFTER_MIN) {
    return {
      passability: 'unknown',
      reason: `Newest report is ${formatAge(age)} old; too stale to rely on.`,
    };
  }

  const level = area.level;
  const n = area.inputs.supportingHumans;
  const strong = isCorroborated(area);
  const profile = VEHICLES[vehicle];

  // 4-5. Corroborated water this vehicle cannot cross.
  if (strong && severity(level) >= severity(profile.impassableFrom)) {
    const reason =
      level === 'waist' || level === 'closed'
        ? `${humans(n)} ${WATER[level]}.`
        : // Corroborated, so n >= 2.
          `${SHORT[level][0].toUpperCase()}${SHORT[level].slice(1)} is impassable for a ${profile.label}: ${n} humans report it.`;
    return { passability: 'blocked', reason };
  }

  // 6. Flooding, not corroborated.
  if (level !== 'dry' && !strong) {
    return {
      passability: 'risky',
      reason:
        n === 1
          ? `One unconfirmed report of ${WATER[level]}.`
          : `${humans(n)} ${WATER[level]}, but confidence is low (${area.confidence.toFixed(2)}).`,
    };
  }

  // 7. Corroborated, and shallow enough to pass.
  if (strong) {
    const care = level === 'dry' ? '' : '; passable with care';
    return {
      passability: 'safe',
      reason: `${humans(n)} ${WATER[level]}, newest ${formatAge(age)} ago${care}.`,
    };
  }

  // 8. Dry, but only one person's word (or low confidence).
  return {
    passability: 'unknown',
    reason:
      n === 1
        ? 'Only one unconfirmed dry report.'
        : `Dry reports, but confidence is low (${area.confidence.toFixed(2)}).`,
  };
}

/**
 * One verdict for a point: the worst area around it decides (blocked > risky > unknown > safe), and
 * among equally bad areas the most confident one is the evidence. No areas at all is unknown.
 */
export function assessPoint<A extends Evidence & { cell: string }>(
  areas: A[],
  vehicle: Vehicle = DEFAULT_VEHICLE,
  maxAgeMin = DEFAULT_MAX_AGE_MIN,
): PassabilityResult & { cell: string | null } {
  const judged = areas.map((a) => ({ a, p: derivePassability(a, vehicle, maxAgeMin) }));
  if (judged.length === 0) return { ...derivePassability(null, vehicle, maxAgeMin), cell: null };
  judged.sort(
    (x, y) =>
      PASSABILITY_RANK[y.p.passability] - PASSABILITY_RANK[x.p.passability] ||
      y.a.confidence - x.a.confidence,
  );
  return { ...judged[0].p, cell: judged[0].a.cell };
}
