# Deploying KneeDeep

KneeDeep ships as **one Docker image**: the API also serves the web app, so a deployment is that
image, a Postgres database, and HTTPS in front. Reports live on Arkiv, payments on Hedera and
identity on World ID; the server holds only rate limits, the payment ledger and payouts.

```
browser / agent ──HTTPS──> proxy (Caddy, Render, …) ──> app :3000 ──> Postgres (private)
                                                          ├──> Arkiv (reports, votes)
                                                          ├──> Hedera + x402 facilitator (payments, payouts)
                                                          └──> World ID verify API
```

Two ready-made paths: **[one server with Docker](#option-a-one-server-with-docker)** (any VPS, full
control) or **[Render](#option-b-render)** (managed, no server). Anything else that runs a Docker
image works too; see [other platforms](#other-platforms).

## 1. Before you start

| Need               | Why                                                                                                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **HTTPS**          | Browsers only share location on HTTPS, and reporting and voting need it. Both paths below provide it.                                                                        |
| **World ID app**   | In the [Developer Portal](https://developer.world.org): app id, RP id, RP signing key, and the action `submit-report` in the environment you deploy (staging or production). |
| **Arkiv wallet**   | `ARKIV_PRIVATE_KEY` with testnet funds ([faucet](https://hub.arkiv.network/faucet)), and an access key. It pays for every report and vote.                                   |
| **Hedera account** | The platform account receives payments and sends payouts, paying their fees: keep at least 1 HBAR in it.                                                                     |
| **Pseudonym salt** | `openssl rand -hex 32`, set **once**. Changing it later gives every reporter a new identity and orphans their earnings.                                                      |

**Pick the tier** (`APP_ENV`):

- `staging`: strict checks, **World ID simulator**, testnets. Use it for demos and judging.
- `production`: strict checks, **real World App only**. Needs `WORLD_ENVIRONMENT=production` and the
  action created in the portal's production environment.

Both refuse to start on an unsafe configuration (missing secrets, placeholder salt, dev identities)
and print exactly what is wrong.

## 2. Check the configuration first

```bash
npm run deploy:check -- --env deploy/.env
```

It reads only that file (never your local `.env`), applies the strict checks of the chosen tier, and
verifies the outside world: the World ID signing key, the Arkiv wallet balance, the Hedera account
(exists, key matches, funded), the x402 facilitator, and Postgres if reachable. Run it again with
`--url https://your-domain` after deploying (see [verify](#4-verify-the-deployment)).

## 3a. Option A: one server with Docker

Any Linux server with Docker (2 GB RAM is plenty), a domain, and ports 80 and 443 open.

```bash
# 1. DNS: an A (and AAAA) record for your domain -> the server's IP.
# 2. On the server:
git clone https://github.com/Tapaswini98/KneeDeep.git /opt/kneedeep
cd /opt/kneedeep/deploy
cp .env.example .env          # fill in DOMAIN, POSTGRES_PASSWORD (openssl rand -hex 24) and the secrets
chmod 600 .env
docker compose up -d --build  # Caddy gets the HTTPS certificate on first start
docker compose logs -f app    # "KneeDeep API on ... (staging; ...)"
```

What runs ([deploy/docker-compose.yml](../deploy/docker-compose.yml)):

- **caddy**: HTTPS with automatic Let's Encrypt certificates, compression, forwards to the app.
- **app**: the KneeDeep image. Migrations run on start (under a lock), `TRUST_PROXY=1`, log rotation.
- **postgres**: no published port; only the app can reach it. Data in a named volume.

**Updates.** From source: `git pull && docker compose up -d --build`. From a published image (see
[releases](#releases)): set `KNEEDEEP_IMAGE=ghcr.io/<owner>/kneedeep:<version>` in `.env`, then
`docker compose pull app && docker compose up -d --no-build`. Roll back by setting the previous tag.

**Backups.** Postgres holds the money records (paid queries, earnings, payouts). Reports are on
Arkiv and expire by design, so they need no backup.

```bash
./backup.sh                                        # one backup into deploy/backups/
# nightly, keeping 14 days:
# 15 3 * * * /opt/kneedeep/deploy/backup.sh >> /var/log/kneedeep-backup.log 2>&1
gunzip -c backups/<file>.sql.gz | docker compose exec -T postgres psql -U kneedeep kneedeep   # restore
```

## 3b. Option B: Render

1. Push the repository to GitHub.
2. Render dashboard → **New → Blueprint** → select the repository. [render.yaml](../render.yaml)
   creates the web service (from the Dockerfile) and a Postgres database, and generates
   `PSEUDONYM_SALT` once.
3. Enter the secrets it asks for (World ID, Arkiv, Hedera). Choose a **paid instance type** for the
   web service: free instances sleep, which pauses payouts and slows the first query after a pause.
4. Deploy. Render terminates HTTPS on `https://<service>.onrender.com` (or your custom domain) and
   checks `/health/live`.

## Other platforms

Railway, Fly.io, ECS, Cloud Run, Kubernetes: run the image with

- a Postgres 14+ `DATABASE_URL` (append `?sslmode=require` for managed databases that need TLS),
- `MIGRATE_ON_BOOT=true` (or `npm run db:migrate` before each release), `TRUST_PROXY=1` behind the
  platform's load balancer, and the secrets from [deploy/.env.example](../deploy/.env.example),
- `PORT` if the platform assigns one (the app and the Docker health check both read it),
- liveness on `/health/live`; use `/health` (Postgres, Arkiv, Hedera) for readiness or alerting, not
  for restarts: an Arkiv or Hedera outage must not restart a healthy container.

Several replicas are safe: migrations and payout batches are serialised by Postgres locks, and at
most one payout batch can be in flight. Rate limits are per replica (a shared store is future work).

## 4. Verify the deployment

```bash
npm run deploy:check -- --env deploy/.env --url https://your-domain
```

The live part checks HTTPS, liveness and readiness, that the web app's routes are served, that the
paid endpoint answers `402` with a price quote, and the security headers. Then by hand:

1. Open `https://your-domain`, **Sign in with World ID** (simulator on staging), report, and see it
   on the map with its Arkiv link.
2. Point the dispatch agent at it: `KNEEDEEP_API_URL=https://your-domain npm run agent`. It pays on
   Hedera and the query appears on the map with its HashScan link.
   `npm run demo:check`, `demo:seed` and `payout` read the database directly, so they are for the local
   Docker stack; a deployment's database stays private.

## Releases

[.github/workflows/release.yml](../.github/workflows/release.yml) runs the checks and publishes the
image to GitHub Container Registry on every push to `master` (`:master`, `:sha-<short>`) and on
version tags (`git tag v1.0.0 && git push --tags` gives `:1.0.0`, `:1.0` and `:latest`). Make the
package public in GitHub (Packages → kneedeep → settings), or `docker login ghcr.io` on the server.

## Operations

| Task                 | How                                                                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Logs                 | `docker compose logs -f app`. One line per request with a request id, which every response returns as `x-request-id`.                                                                            |
| Health               | `/health/live` (process up), `/health` (Postgres, Arkiv, Hedera). Alert on `/health` failing for more than a few minutes.                                                                        |
| Funding              | Watch the Arkiv writer balance and the Hedera platform balance; `npm run deploy:check` reports both.                                                                                             |
| Payouts              | Automatic: the app runs a batch every `PAYOUT_INTERVAL_MINUTES` (default 60) and logs each one with its HashScan link. `npm run payout` needs direct database access, so it is for local stacks. |
| Rotate a key         | Update `deploy/.env` (or the Render secret) and restart. World RP key: rotate in the portal first. Never rotate `PSEUDONYM_SALT`.                                                                |
| Switch to production | `APP_ENV=production`, `WORLD_ENVIRONMENT=production`, action created in the portal's production environment; re-run the preflight.                                                               |

## Security checklist

- [ ] Served only over HTTPS (HSTS is sent by the app).
- [ ] `deploy/.env` (or platform secrets) only on the server; `chmod 600`; never committed.
- [ ] Postgres not exposed to the internet.
- [ ] `PSEUDONYM_SALT` random, 32+ characters, backed up somewhere safe (losing it orphans every reporter).
- [ ] Hedera platform key and Arkiv key only in the server environment; the agent's key never on the server.
- [ ] Nightly database backups, and one restore tested.
- [ ] `npm run deploy:check -- --env deploy/.env --url https://your-domain` passes.

Known gaps: no Content-Security-Policy yet, and the Arkiv chain is the Rabdi testnet
(`api/src/arkiv/client.ts`).
