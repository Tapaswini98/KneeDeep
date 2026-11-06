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
