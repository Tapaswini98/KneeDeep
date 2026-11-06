import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assessCheckpoint, assessRoute, decide } from './decide';
import type { Area, ConditionsAnswer, Level } from './kneedeep';
import type { Route } from './routes';

const area = (level: Level | null, confidence = 0.8, label: Area['confidenceLabel'] = 'high'): Area => ({
  cell: 'te7uc8t',
  center: { lat: 19, lng: 72.8 },
  distanceM: 50,
  level,
  confidence,
  confidenceLabel: label,
  explanation: '',
  inputs: { supportingHumans: 2, newestAgeMin: 5, disputes: 0 },
  source: 'live',
});

const answer = (areas: Area[], dataStatus: ConditionsAnswer['dataStatus'] = 'live'): ConditionsAnswer => ({
  queryId: 'q',
  generatedAt: '',
  dataStatus: areas.length ? dataStatus : 'empty',
  notices: [],
  areas,
});

const route = (id: string, distanceKm: number, names: string[]): Route => ({
  id,
  name: id,
  distanceKm,
  waypoints: names.map((name) => ({ name, lat: 19, lng: 72.8 })),
});

function assess(r: Route, levels: (Area[] | Level | null)[]) {
  return assessRoute(
    r,
    r.waypoints.map((w, i) => {
      const l = levels[i];
      // null = no reports at this checkpoint.
      return assessCheckpoint(
        w,
        answer(Array.isArray(l) ? l : l === null || l === undefined ? [] : [area(l)]),
      );
    }),
  );
}

describe('assessCheckpoint', () => {
  it('treats knee-deep or worse as impassable, ankle as slow, dry as clear', () => {
    const w = { name: 'x', lat: 19, lng: 72.8 };
    assert.equal(assessCheckpoint(w, answer([area('knee')])).verdict, 'impassable');
    assert.equal(assessCheckpoint(w, answer([area('closed')])).verdict, 'impassable');
    assert.equal(assessCheckpoint(w, answer([area('ankle')])).verdict, 'slow');
    assert.equal(assessCheckpoint(w, answer([area('dry')])).verdict, 'clear');
  });

  it('treats no data and contested areas as unknown, never as clear', () => {
    const w = { name: 'x', lat: 19, lng: 72.8 };
    assert.equal(assessCheckpoint(w, answer([])).verdict, 'unknown');
    assert.equal(assessCheckpoint(w, answer([area('dry'), area(null, 0)])).verdict, 'unknown');
  });

  it('lets the worst nearby area decide, even at low confidence', () => {
    const w = { name: 'x', lat: 19, lng: 72.8 };
    const c = assessCheckpoint(w, answer([area('dry', 0.9), area('waist', 0.3, 'low')]));
    assert.equal(c.verdict, 'impassable');
    assert.match(c.reason, /waist-deep, confidence 0.30 low/);
  });
});

describe('decide', () => {
  const sv = route('S.V. Road', 8.1, ['Khar', 'Milan', 'Andheri']);
  const weh = route('Western Express Highway', 9.4, ['Kalanagar', 'Vile Parle', 'Andheri E']);

  it('takes the longer dry route over a shorter flooded one (the demo scenario)', () => {
    const d = decide([assess(sv, ['ankle', 'waist', 'knee']), assess(weh, ['dry', 'dry', 'dry'])]);
    assert.equal(d.choice?.route.name, 'Western Express Highway');
    assert.match(d.explanation, /1\.3 km longer/);
    assert.match(d.explanation, /Avoided S\.V\. Road: slow at Khar .*impassable at Milan/);
  });

  it('prefers the shorter route when both are equally clear', () => {
    const d = decide([assess(weh, ['dry', 'dry', 'dry']), assess(sv, ['dry', 'dry', 'dry'])]);
    assert.equal(d.choice?.route.name, 'S.V. Road');
  });

  it('prefers a slow route over one with no data', () => {
    const d = decide([assess(sv, ['ankle', 'dry', 'dry']), assess(weh, ['dry', null, 'dry'])]);
    assert.equal(d.choice?.route.name, 'S.V. Road');
  });

  it('holds the delivery when every route is impassable', () => {
    const d = decide([assess(sv, ['dry', 'closed', 'dry']), assess(weh, ['knee', 'dry', 'dry'])]);
    assert.equal(d.choice, null);
    assert.match(d.explanation, /^Hold the delivery/);
  });

  it('flags decisions that rest on simulated data', () => {
    const r = assessRoute(sv, [assessCheckpoint(sv.waypoints[0], answer([area('dry')], 'simulated'))]);
    assert.equal(decide([r]).usesSimulatedData, true);
  });
});
