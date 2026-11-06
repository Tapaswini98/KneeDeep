/**
 * Route decision for a delivery scooter. Pure and deterministic: same answers, same choice,
 * and every choice comes with the evidence it rests on.
 *
 * Per checkpoint (every ~150 m area KneeDeep returned around it):
 *   dry                    clear
 *   ankle                  slow (passable with care)
 *   knee / waist / closed  impassable (a scooter stalls in knee-deep water)
 *   contested, or no data  unknown (absence of reports is not evidence of a dry road)
 * A route is as bad as its worst checkpoint. Never choose an impassable route; among the rest,
 * pick the lowest risk, then the shortest. If every route is impassable, hold the delivery.
 * Safety first: a single unconfirmed report of deep water is enough to avoid a route when there
 * is an alternative, but its confidence is always shown.
 */
import type { Area, ConditionsAnswer, Level } from './kneedeep';
import type { Route, Waypoint } from './routes';

export type Verdict = 'clear' | 'slow' | 'unknown' | 'impassable';

const RANK: Record<Verdict, number> = { clear: 0, slow: 1, unknown: 2, impassable: 3 };

const LEVEL_VERDICT: Record<Level, Verdict> = {
  dry: 'clear',
  ankle: 'slow',
  knee: 'impassable',
  waist: 'impassable',
  closed: 'impassable',
};

const PHRASE: Record<Level, string> = {
  dry: 'dry',
  ankle: 'ankle-deep',
  knee: 'knee-deep',
  waist: 'waist-deep',
  closed: 'closed',
};

export interface CheckpointResult {
  waypoint: Waypoint;
  verdict: Verdict;
  /** The area that decided the verdict (null when there was no data at all). */
  evidence: Area | null;
  reason: string;
  dataStatus: ConditionsAnswer['dataStatus'];
}

export interface RouteAssessment {
  route: Route;
  checkpoints: CheckpointResult[];
  verdict: Verdict;
  /** Lower is better. Only compares routes that are not impassable. */
  risk: number;
}

export interface Decision {
  /** Null when every route is impassable: hold the delivery. */
  choice: RouteAssessment | null;
  routes: RouteAssessment[];
  explanation: string;
  usesSimulatedData: boolean;
}

const areaVerdict = (a: Area): Verdict => (a.level === null ? 'unknown' : LEVEL_VERDICT[a.level]);

function describe(a: Area): string {
  const what = a.level === null ? 'contested reports' : PHRASE[a.level];
  return `${what}, confidence ${a.confidence.toFixed(2)} ${a.confidenceLabel}`;
}

export function assessCheckpoint(waypoint: Waypoint, answer: ConditionsAnswer): CheckpointResult {
  if (answer.areas.length === 0) {
    return {
      waypoint,
      verdict: 'unknown',
      evidence: null,
      reason: 'no fresh reports (not evidence of a dry road)',
      dataStatus: answer.dataStatus,
    };
  }
  // Worst verdict wins; among equally bad areas, the most confident one is the evidence.
  const evidence = [...answer.areas].sort(
    (x, y) => RANK[areaVerdict(y)] - RANK[areaVerdict(x)] || y.confidence - x.confidence,
  )[0];
  return {
    waypoint,
    verdict: areaVerdict(evidence),
    evidence,
    reason: describe(evidence),
    dataStatus: answer.dataStatus,
  };
}

function checkpointRisk(c: CheckpointResult): number {
  switch (c.verdict) {
    case 'clear':
      return 0;
    case 'slow':
      return 1 + (c.evidence?.confidence ?? 0);
    case 'unknown':
      return 3;
    case 'impassable':
      return 100;
  }
}

export function assessRoute(route: Route, checkpoints: CheckpointResult[]): RouteAssessment {
  const verdict = checkpoints.reduce<Verdict>(
    (worst, c) => (RANK[c.verdict] > RANK[worst] ? c.verdict : worst),
    'clear',
  );
  return { route, checkpoints, verdict, risk: checkpoints.reduce((s, c) => s + checkpointRisk(c), 0) };
}

function problems(r: RouteAssessment): string {
  const bad = r.checkpoints.filter((c) => c.verdict !== 'clear');
  if (bad.length === 0) return `all ${r.checkpoints.length} checkpoints clear`;
  return bad.map((c) => `${c.verdict} at ${c.waypoint.name} (${c.reason})`).join('; ');
}

export function decide(routes: RouteAssessment[]): Decision {
  const usable = routes
    .filter((r) => r.verdict !== 'impassable')
    .sort((a, b) => a.risk - b.risk || a.route.distanceKm - b.route.distanceKm);
  const choice = usable[0] ?? null;
  const usesSimulatedData = routes.some((r) =>
    r.checkpoints.some((c) => c.dataStatus === 'simulated' || c.dataStatus === 'mixed'),
  );

  let explanation: string;
  if (!choice) {
    explanation = `Hold the delivery: every route is impassable. ${routes
      .map((r) => `${r.route.name}: ${problems(r)}`)
      .join('. ')}.`;
  } else {
    const shortest = Math.min(...routes.map((r) => r.route.distanceKm));
    const extra = choice.route.distanceKm - shortest;
    const detour = extra > 0 ? `, ${extra.toFixed(1)} km longer than the shortest` : '';
    const others = routes.filter((r) => r !== choice).map((r) => `Avoided ${r.route.name}: ${problems(r)}`);
    explanation = [
      `Take ${choice.route.name} (${choice.route.distanceKm} km${detour}): ${problems(choice)}.`,
      ...others.map((o) => `${o}.`),
    ].join(' ');
    if (choice.verdict === 'unknown') {
      explanation += ' Some checkpoints have no fresh reports: proceed with caution.';
    }
  }
  return { choice, routes, explanation, usesSimulatedData };
}
