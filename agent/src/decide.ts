/**
 * Route decision for a delivery two-wheeler. Pure and deterministic: same answers, same choice,
 * and every choice comes with plain-sentence reasons.
 *
 * The agent never interprets water levels itself. KneeDeep returns a passability for each
 * checkpoint (safe | risky | blocked | unknown, computed by api/src/fusion/passability.ts), so the
 * API and the agent cannot disagree. The policy on top of it:
 *   1. Discard every route with a blocked checkpoint.
 *   2. Among the rest: fewest risky checkpoints, then fewest unknown, then higher average
 *      confidence, then shorter.
 *   3. If every route is discarded, hold the delivery.
 */
import type { Area, ConditionsAnswer, Level, Passability } from './kneedeep';
import type { Route, Waypoint } from './routes';

export interface CheckpointResult {
  waypoint: Waypoint;
  passability: Passability;
  reason: string;
  /** The area that decided the verdict (null when there was no data at all). */
  evidence: Area | null;
  dataStatus: ConditionsAnswer['dataStatus'];
}

export interface RouteAssessment {
  route: Route;
  checkpoints: CheckpointResult[];
  counts: Record<Passability, number>;
  /** Mean confidence of the deciding evidence; a checkpoint with no data counts as 0. */
  avgConfidence: number;
}

export type RouteVerdict = 'chosen' | 'rejected' | 'passed_over';

export interface RouteDecision extends RouteAssessment {
  verdict: RouteVerdict;
  reason: string;
}

export interface Decision {
  outcome: 'dispatched' | 'held';
  /** Null when every route is blocked: the delivery is held. */
  choice: RouteDecision | null;
  routes: RouteDecision[];
  /** One sentence per route (and the outcome first when held). */
  reasons: string[];
  explanation: string;
  usesSimulatedData: boolean;
}

const SHORT: Record<Level, string> = {
  dry: 'dry',
  ankle: 'ankle-deep',
  knee: 'knee-deep',
  waist: 'waist-deep',
  closed: 'closed',
};

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1).replace(/\.$/, '');

export function assessCheckpoint(waypoint: Waypoint, answer: ConditionsAnswer): CheckpointResult {
  const { assessment } = answer;
  return {
    waypoint,
    passability: assessment.passability,
    reason: assessment.reason,
    evidence: answer.areas.find((a) => a.cell === assessment.decidedBy) ?? null,
    dataStatus: answer.dataStatus,
  };
}

export function assessRoute(route: Route, checkpoints: CheckpointResult[]): RouteAssessment {
  const counts: Record<Passability, number> = { safe: 0, risky: 0, unknown: 0, blocked: 0 };
  for (const c of checkpoints) counts[c.passability]++;
  const total = checkpoints.reduce((s, c) => s + (c.evidence?.confidence ?? 0), 0);
  return {
    route,
    checkpoints,
    counts,
    avgConfidence: checkpoints.length ? total / checkpoints.length : 0,
  };
}

/**
 * "Andheri subway blocked (knee-deep, high confidence)". Risky and unknown checkpoints quote
 * KneeDeep's reason instead ("one unconfirmed report of …", "newest report is 2 h old"): there the
 * level alone would hide why the area is not trusted.
 */
function describe(c: CheckpointResult): string {
  const e = c.evidence;
  const why =
    e?.level && (c.passability === 'blocked' || c.passability === 'safe')
      ? `${SHORT[e.level]}, ${e.confidenceLabel} confidence`
      : lowerFirst(c.reason.split('. ')[0]);
  return `${c.waypoint.name} ${c.passability} (${why})`;
}

function notSafe(r: RouteAssessment, p: Passability): string[] {
  return r.checkpoints.filter((c) => c.passability === p).map(describe);
}

const better = (a: RouteAssessment, b: RouteAssessment) =>
  a.counts.risky - b.counts.risky ||
  a.counts.unknown - b.counts.unknown ||
  b.avgConfidence - a.avgConfidence ||
  a.route.distanceKm - b.route.distanceKm;

function chosenReason(r: RouteAssessment, shortest: RouteAssessment): string {
  const n = r.checkpoints.length;
  const parts = [`${r.counts.safe} of ${n} checkpoints safe`];
  const risky = notSafe(r, 'risky');
  const unknown = notSafe(r, 'unknown');
  if (risky.length) parts.push(`${risky.join(', ')}: ride with care`);
  if (unknown.length) parts.push(`${unknown.join(', ')}: proceed with caution`);
  const extra = r.route.distanceKm - shortest.route.distanceKm;
  if (extra > 0) parts.push(`${extra.toFixed(1)} km longer than ${shortest.route.name}`);
  return `${r.route.name} chosen: ${parts.join('; ')}.`;
}

function passedOverReason(r: RouteAssessment, choice: RouteAssessment): string {
  const issues = [...notSafe(r, 'risky'), ...notSafe(r, 'unknown')];
  let why: string;
  if (r.counts.risky !== choice.counts.risky || r.counts.unknown !== choice.counts.unknown) {
    why = issues.join(', ');
  } else if (r.avgConfidence !== choice.avgConfidence) {
    why = `lower average confidence (${r.avgConfidence.toFixed(2)} vs ${choice.avgConfidence.toFixed(2)})`;
  } else {
    why = `longer (${r.route.distanceKm} km vs ${choice.route.distanceKm} km)`;
  }
  return `${r.route.name} not chosen: ${why}.`;
}

export function decide(assessed: RouteAssessment[]): Decision {
  const usable = assessed.filter((r) => r.counts.blocked === 0).sort(better);
  const best = usable[0] ?? null;
  const shortest = [...assessed].sort((a, b) => a.route.distanceKm - b.route.distanceKm)[0];

  const routes: RouteDecision[] = assessed.map((r) => {
    if (r.counts.blocked > 0) {
      return {
        ...r,
        verdict: 'rejected',
        reason: `${r.route.name} rejected: ${notSafe(r, 'blocked').join(', ')}.`,
      };
    }
    if (r === best) return { ...r, verdict: 'chosen', reason: chosenReason(r, shortest) };
    return { ...r, verdict: 'passed_over', reason: passedOverReason(r, best!) };
  });
  const choice = routes.find((r) => r.verdict === 'chosen') ?? null;

  // The chosen route first, then the others in their original order.
  const reasons = [
    ...(choice ? [choice.reason] : [`Held: every route is blocked, so the delivery is not dispatched.`]),
    ...routes.filter((r) => r !== choice).map((r) => r.reason),
  ];
  const usesSimulatedData = assessed.some((r) =>
    r.checkpoints.some((c) => c.dataStatus === 'simulated' || c.dataStatus === 'mixed'),
  );
  return {
    outcome: choice ? 'dispatched' : 'held',
    choice,
    routes,
    reasons,
    explanation: reasons.join(' '),
    usesSimulatedData,
  };
}
