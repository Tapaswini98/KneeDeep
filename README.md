# KneeDeep

**Street-level truth for AI agents: verified, perishable, paid.**

Weather APIs tell an agent it rained. KneeDeep tells it the Andheri subway is knee-deep *right now*,
from three verified humans 20 minutes ago, and pays those humans for it.

KneeDeep is a paid, real-time API of street-level conditions (waterlogging, blocked roads) reported by
verified humans. Reports expire because street truth expires. Delivery, logistics and dispatch agents
pay per query via x402 on Hedera, and the reporters whose corroborated reports were used get paid.

Built at ETHGlobal Mumbai 2026 for **Hedera** (AI Agents That Pay: x402), **Arkiv** and **World**.

> Demo data is simulated and labelled `source: simulated`. The API never presents it as live.

## How it works

1. **Report.** A reporter verifies with World ID, picks a level (dry / ankle / knee / waist / road closed)
   and shares a location. The API stores the report on Arkiv with a 3-hour expiry, located only by its ~150 m cell.
2. **Confirm or dispute.** Nearby verified humans vote on live reports. Each vote is its own expiring Arkiv entity.
3. **Query and pay.** An agent calls `GET /v1/conditions?lat&lng&radius`, gets `402`, pays via x402 on
   Hedera, and receives a level per area with a confidence score and the reasons behind it.
4. **Earn.** Reporters whose corroborated reports were used in paid answers are paid in one batched Hedera transfer.

## API

| Endpoint | Cost | What |
|----------|------|------|
| `GET /v1` | free | Catalog: what is for sale and the price |
| `GET /v1/conditions?lat&lng&radius` | **x402**, 0.1 HBAR | Fused level per ~150 m cell, confidence, and the inputs behind it |
| `GET /v1/reports?lat&lng&radius` | free | Raw live reports (the same data anyone can read on Arkiv) |
| `GET /v1/identity/context` | free | Signed IDKit request context (the RP signing key stays on the server) |
| `POST /v1/identity/session` | free | Exchange a World ID Proof of Human for a reporter session: `{ proof }` |
| `POST /v1/reports` | free | Submit a report: `{ level, lat, lng }` with `Authorization: Bearer <session>` |
| `POST /v1/reports/:key/votes` | free | Confirm or dispute: `{ vote, lat, lng }` with a session; you must be within 1 km |
| `GET /health` | free | Postgres, Arkiv and Hedera status |

Example paid answer (simulated data):

```json
{
  "dataStatus": "simulated",
  "notices": ["Includes SIMULATED demo data, not real observations."],
  "areas": [{
    "cell": "te7uc8t", "distanceM": 54,
    "level": "knee", "confidence": 0.78, "confidenceLabel": "high",
    "explanation": "4 independent humans report knee-deep water; newest just now, oldest 1 min ago; 2 confirmations, 1 dispute.",
    "inputs": { "supportingHumans": 4, "reports": 3, "contradictingReports": 0, "confirmations": 2, "disputes": 1, "newestAgeMin": 0.9, "oldestAgeMin": 1.3 }
  }]
}
```

How confidence is computed: [docs/design.md](docs/design.md).

## Payment flow (x402 on Hedera)

```
agent                         KneeDeep API                       facilitator (Blocky402)      Hedera
  | GET /v1  (free catalog)       |                                    |                        |
  |------------------------------>|                                    |                        |
  | GET /v1/conditions            |                                    |                        |
  |------------------------------>| 402 + PAYMENT-REQUIRED             |                        |
  |<------------------------------| (0.1 HBAR to platform account)     |                        |
  | sign HBAR transfer (own key)  |                                    |                        |
  | GET + PAYMENT-SIGNATURE ----->| verify ------------------------->  |                        |
  |                               | build answer, record query         |                        |
  |                               | settle ------------------------->  | submit, pay fee ---->  |
  | 200 + answer + PAYMENT-RESPONSE (tx id)  <-- mark query paid       |                        |
```

- The agent pays from its own Hedera account. No human approves a payment; a per-query cap
  (`AGENT_MAX_TINYBARS_PER_QUERY`) bounds what it will sign.
- If the API answers 4xx/5xx, settlement is cancelled: invalid queries are never charged.
- Every paid query is stored with its settled Hedera transaction id (`queries.payment_tx_id`).

## Repository layout

| Folder | What |
|--------|------|
| [`api/`](api) | NestJS API: reports, votes, fusion engine, x402-protected conditions, payouts |
| [`web/`](web) | Vite + React: mobile reporter page and live map (Leaflet + OpenStreetMap) |
| [`agent/`](agent) | Deterministic dispatch agent: compares two routes, pays for conditions, picks the safer one |
| [`arkiv/`](arkiv) | Arkiv submission notes: schema, friction log |
| [`docs/`](docs) | Design notes, AI usage |

## Setup

Requirements: Node 22.12+, Docker (for Postgres), a Hedera testnet account
([portal.hedera.com](https://portal.hedera.com)), an Arkiv access key
([hub.arkiv.network](https://hub.arkiv.network/access-keys)).

```bash
npm install
cp .env.example .env
npm run db:up && npm run db:migrate

npm run arkiv:wallet       # prints ARKIV_PRIVATE_KEY + address; fund it at hub.arkiv.network/faucet
npm run arkiv:smoke        # checkpoint: writes one expiring report to Arkiv and reads it back
npm run hedera:balance     # checkpoint: balance prints, key matches, facilitator lists hedera:testnet
```

Run:

```bash
npm run dev                # API on :3000 and web on :5173
npm run agent              # dispatch agent
npm test                   # unit tests
```

`GET http://localhost:3000/health` reports Postgres, Arkiv and Hedera status.

## Privacy

- Locations are coarsened to geohash cells (~150 m). Raw GPS is never stored.
- Public reporter IDs are `sha256(salt ‖ nullifier)`. The World ID nullifier is never stored or published.

## AI usage

See [docs/AI_USAGE.md](docs/AI_USAGE.md).
