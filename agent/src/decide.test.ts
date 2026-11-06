import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assessCheckpoint, assessRoute, decide } from './decide';
import type { Area, ConditionsAnswer, Level, Passability } from './kneedeep';
import type { Route } from './routes';

/** What KneeDeep answers at one checkpoint: its assessment plus the area that decided it. */
interface Spot {
  passability: Passability;
  level?: Level | null;
  confidence?: number;
  label?: Area['confidenceLabel'];
  reason?: string;
}

const REASON: Record<Passability, string> = {
  safe: '2 humans report dry, newest 12 min ago.',
  risky: 'One unconfirmed report of knee-deep water.',
  blocked: 'Knee-deep is impassable for a two-wheeler: 3 humans report it.',
  unknown: 'No reports in the last 3 h. No data is not dry.',
};

function answer(s: Spot | null, dataStatus: ConditionsAnswer['dataStatus'] = 'live'): ConditionsAnswer {
  if (!s || (s.passability === 'unknown' && s.level === undefined)) {
    return {
      queryId: 'q',
      generatedAt: '',
      dataStatus: 'empty',
      notices: [],
      assessment: { vehicle: 'two_wheeler', passability: 'unknown', reason: REASON.unknown, decidedBy: null },
      areas: [],
    };
  }
  const reason = s.reason ?? REASON[s.passability];
  const area: Area = {
    cell: 'te7uc8t',
    center: { lat: 19, lng: 72.8 },
    distanceM: 50,
    level: s.level === undefined ? 'dry' : s.level,
    confidence: s.confidence ?? 0.8,
    confidenceLabel: s.label ?? 'high',
    explanation: '',
    passability: s.passability,
    passabilityReason: reason,
    evidenceAgeMin: 5,
    inputs: { supportingHumans: 2, newestAgeMin: 5, disputes: 0 },
    source: 'live',
  };
  return {
    queryId: 'q',
    generatedAt: '',
    dataStatus,
    notices: [],
    assessment: { vehicle: 'two_wheeler', passability: s.passability, reason, decidedBy: area.cell },
    areas: [area],
  };
}

const route = (id: string, distanceKm: number, names: string[]): Route => ({
  id,
  name: id,
  distanceKm,
  waypoints: names.map((name) => ({ name, lat: 19, lng: 72.8 })),
});

const SAFE: Spot = { passability: 'safe', level: 'dry' };
const RISKY: Spot = { passability: 'risky', level: 'knee', confidence: 0.45, label: 'medium' };
const BLOCKED: Spot = { passability: 'blocked', level: 'knee', confidence: 0.85, label: 'high' };
const NO_DATA: Spot = { passability: 'unknown' };

const assess = (r: Route, spots: (Spot | null)[]) =>
  assessRoute(
    r,
    r.waypoints.map((w, i) => assessCheckpoint(w, answer(spots[i]))),
  );

const sv = route('S.V. Road', 8.1, ['Khar subway', 'Milan subway', 'Andheri subway']);
const weh = route('Western Express Highway', 9.4, ['Kalanagar', 'Vile Parle', 'Andheri E']);

describe('assessCheckpoint', () => {
  it('takes the verdict from KneeDeep, not from its own reading of the level', () => {
    const w = { name: 'x', lat: 19, lng: 72.8 };
    // A single knee-deep report: KneeDeep says risky, so the agent must not call it blocked.
    const c = assessCheckpoint(w, answer(RISKY));
    assert.equal(c.passability, 'risky');
    assert.equal(c.evidence?.level, 'knee');
  });

  it('treats no data as unknown, never as safe', () => {
    const c = assessCheckpoint({ name: 'x', lat: 19, lng: 72.8 }, answer(null));
    assert.equal(c.passability, 'unknown');
    assert.equal(c.evidence, null);
  });
});

describe('decide', () => {
  it('takes the longer safe route over a blocked one, with reasons (the demo scenario)', () => {
    const d = decide([assess(sv, [SAFE, BLOCKED, BLOCKED]), assess(weh, [SAFE, SAFE, SAFE])]);
    assert.equal(d.outcome, 'dispatched');
    assert.equal(d.choice?.route.name, 'Western Express Highway');
    assert.equal(
      d.reasons[0],
      'Western Express Highway chosen: 3 of 3 checkpoints safe; 1.3 km longer than S.V. Road.',
    );
    assert.equal(
      d.reasons[1],
      'S.V. Road rejected: Milan subway blocked (knee-deep, high confidence), ' +
        'Andheri subway blocked (knee-deep, high confidence).',
    );
    assert.deepEqual(
      d.routes.map((r) => r.verdict),
      ['rejected', 'chosen'],
    );
  });

  it('discards a blocked route even when the other has risky and unknown checkpoints', () => {
    const d = decide([assess(sv, [SAFE, SAFE, BLOCKED]), assess(weh, [RISKY, NO_DATA, SAFE])]);
    assert.equal(d.choice?.route.name, 'Western Express Highway');
    assert.match(
      d.reasons[0],
      /Kalanagar risky \(one unconfirmed report of knee-deep water\): ride with care/,
    );
    assert.match(d.reasons[0], /Vile Parle unknown \(no reports in the last 3 h\): proceed with caution/);
  });

  it('prefers fewer risky checkpoints over fewer unknown ones', () => {
    const d = decide([assess(sv, [RISKY, SAFE, SAFE]), assess(weh, [NO_DATA, NO_DATA, SAFE])]);
    assert.equal(d.choice?.route.name, 'Western Express Highway');
    assert.match(d.reasons[1], /^S\.V\. Road not chosen: Khar subway risky/);
  });

  it('then prefers fewer unknown checkpoints', () => {
    const d = decide([assess(sv, [NO_DATA, SAFE, SAFE]), assess(weh, [SAFE, SAFE, SAFE])]);
    assert.equal(d.choice?.route.name, 'Western Express Highway');
  });

  it('then prefers higher average confidence, then the shorter route', () => {
    const weak: Spot = { ...SAFE, confidence: 0.6 };
    const d = decide([assess(sv, [weak, weak, weak]), assess(weh, [SAFE, SAFE, SAFE])]);
    assert.equal(d.choice?.route.name, 'Western Express Highway');
    assert.equal(d.reasons[1], 'S.V. Road not chosen: lower average confidence (0.60 vs 0.80).');

    const tie = decide([assess(weh, [SAFE, SAFE, SAFE]), assess(sv, [SAFE, SAFE, SAFE])]);
    assert.equal(tie.choice?.route.name, 'S.V. Road');
  });

  it('holds the delivery when every route is blocked', () => {
    const d = decide([assess(sv, [SAFE, BLOCKED, SAFE]), assess(weh, [BLOCKED, SAFE, SAFE])]);
    assert.equal(d.outcome, 'held');
    assert.equal(d.choice, null);
    assert.equal(d.reasons[0], 'Held: every route is blocked, so the delivery is not dispatched.');
    assert.equal(d.reasons.length, 3);
  });

  it('flags decisions that rest on simulated data', () => {
    const r = assessRoute(sv, [assessCheckpoint(sv.waypoints[0], answer(SAFE, 'simulated'))]);
    assert.equal(decide([r]).usesSimulatedData, true);
  });
});
