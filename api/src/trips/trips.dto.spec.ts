import { tripSchema } from './trips.dto';

const checkpoint = (passability: string, txId: string | null = '0.0.42@1700000000.000000001') => ({
  name: 'Andheri subway',
  lat: 19.1197,
  lng: 72.8464,
  cell: 'te7uc8t',
  level: passability === 'blocked' ? 'knee' : 'dry',
  confidence: 0.8,
  passability,
  reason: 'x',
  txId,
});

const route = (id: string, verdict: string, passabilities: string[]) => ({
  id,
  name: id,
  distanceKm: 8.1,
  verdict,
  reason: `${id} ${verdict}.`,
  avgConfidence: 0.8,
  checkpoints: passabilities.map((p) => checkpoint(p)),
});

const trip = (over: Record<string, unknown> = {}) => ({
  origin: { name: 'Bandra', lat: 19.05, lng: 72.84 },
  destination: { name: 'Andheri', lat: 19.12, lng: 72.85 },
  vehicle: 'two_wheeler',
  outcome: 'dispatched',
  chosenRoute: 'weh',
  reasons: ['weh chosen.', 'sv rejected.'],
  routes: [route('sv', 'rejected', ['safe', 'blocked']), route('weh', 'chosen', ['safe', 'safe'])],
  totalCostTinybars: '40000000',
  network: 'hedera:testnet',
  dataStatus: 'simulated',
  ...over,
});

describe('tripSchema', () => {
  it('accepts a dispatched trip', () => {
    expect(tripSchema.safeParse(trip()).success).toBe(true);
  });

  it('accepts a held trip with every route rejected', () => {
    const held = trip({
      outcome: 'held',
      chosenRoute: null,
      routes: [route('sv', 'rejected', ['blocked']), route('weh', 'rejected', ['safe', 'blocked'])],
    });
    expect(tripSchema.safeParse(held).success).toBe(true);
  });

  it('rejects a chosen route that has a blocked checkpoint', () => {
    const bad = trip({ routes: [route('weh', 'chosen', ['safe', 'blocked'])] });
    expect(tripSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a held trip that names a route, or a dispatched one that names the wrong one', () => {
    expect(tripSchema.safeParse(trip({ outcome: 'held' })).success).toBe(false);
    expect(tripSchema.safeParse(trip({ chosenRoute: 'sv' })).success).toBe(false);
  });

  it('rejects malformed transaction ids and cells', () => {
    const r = route('weh', 'chosen', ['safe']);
    r.checkpoints[0].txId = 'not-a-tx';
    expect(tripSchema.safeParse(trip({ routes: [r], reasons: ['x'] })).success).toBe(false);
    const c = route('weh', 'chosen', ['safe']);
    c.checkpoints[0].cell = 'te7uc8tTOOLONG';
    expect(tripSchema.safeParse(trip({ routes: [c], reasons: ['x'] })).success).toBe(false);
  });
});
