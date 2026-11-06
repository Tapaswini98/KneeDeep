/**
 * Post SIMULATED reports and votes through the real API (needs REPORTER_VERIFIER=dev).
 * Everything this writes is labelled source=simulated on Arkiv and in every answer.
 *
 *   npm run simulate                 the "Andheri subway" scenario
 *   npm run simulate -- --run=abc    use a different run id (fresh dev humans, avoids rate limits)
 */
import { loadEnv } from '../src/config/env';

loadEnv();
const API = process.env.KNEEDEEP_API_URL?.trim() || 'http://localhost:3000';
const RUN = process.argv.find((a) => a.startsWith('--run='))?.slice(6) ?? Date.now().toString(36);

const ANDHERI_SUBWAY = { lat: 19.1197, lng: 72.8464 };
const MILAN_SUBWAY = { lat: 19.0833, lng: 72.8427 };
const jitter = (p: { lat: number; lng: number }, i: number) => ({ lat: p.lat + 0.0002 * (i % 3), lng: p.lng + 0.0001 * (i % 2) });

async function post(path: string, body: unknown) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${JSON.stringify(json.message ?? json)}`);
  return json;
}

const human = (name: string) => ({ devId: `sim-${RUN}-${name}` });

async function main() {
  console.log(`Simulating against ${API} (run ${RUN}). All data is labelled SIMULATED.\n`);

  const keys: string[] = [];
  for (const [i, name] of ['asha', 'ravi', 'meera'].entries()) {
    const r = await post('/v1/reports', { level: 'knee', ...jitter(ANDHERI_SUBWAY, i), proof: human(name) });
    keys.push(String(r.key));
    console.log(`${name.padEnd(6)} reports knee  at Andheri subway  ${r.cell}  ${r.explorer}`);
  }

  const v = await post(`/v1/reports/${keys[0]}/votes`, { vote: 'confirm', ...ANDHERI_SUBWAY, proof: human('kabir') });
  console.log(`kabir  confirms asha's report               ${v.explorer}`);

  const m = await post('/v1/reports', { level: 'ankle', ...MILAN_SUBWAY, proof: human('farah') });
  console.log(`farah  reports ankle at Milan subway    ${m.cell}  ${m.explorer}`);

  console.log('\nDone. Try: npm run agent');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
