# kneedeep-verify: don't trust KneeDeep either

A [Chainlink CRE](https://docs.chain.link/cre) workflow that **independently verifies KneeDeep's
answers** instead of relaying them.

```
cron (every 5 min)
  └─ each DON node, independently:
       HTTP → Arkiv public JSON-RPC (arkiv_query)     raw reports + votes, NOT via KneeDeep's server
       recompute every area with KneeDeep's fusion engine (api/src/fusion/fusion.ts, imported, not copied)
  └─ consensus: identical result required from honest nodes
  └─ EVM write → KneeDeepAttestations on Sepolia     level, confidence, supporting humans per area,
                                                     + keccak256 of exactly which evidence was used
KneeDeep API  GET /v1/verification   reads the attestation, recomputes its own answer for the same
                                     areas, and reports match / mismatch → "CRE ✓" badges on the map
```

**Why it matters.** Agents pay KneeDeep for answers. With this workflow anyone can check, onchain,
that those answers are what the public evidence on Arkiv actually says: a KneeDeep server that
inflated or altered answers would show up as mismatches.

**What it does not prove.** Consensus proves the nodes agree on what the evidence says, not that the
human reports are true. Truthfulness rests on World ID uniqueness, corroboration and incentives.

## Layout

| Path                                     | What                                                                             |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| `kneedeep-verify/workflow.ts`            | Cron trigger → HTTP (node mode) → identical consensus → signed report → write    |
| `kneedeep-verify/evidence.ts`            | Arkiv RPC bodies and decoding, verdict computation, evidence hash (pure)         |
| `kneedeep-verify/attestation.ts`         | ABI encoding that `KneeDeepAttestations` decodes                                 |
| `kneedeep-verify/config.staging.json`    | Schedule, Arkiv RPC, KneeDeep's writer address, contract, gas                    |
| `contracts/src/KneeDeepAttestations.sol` | `IReceiver`: forwarder-only, stale reports rejected, optional workflow-owner pin |
| `contracts/deploy.sh`                    | Deploy to Sepolia with the simulation or production forwarder                    |

No secrets: Arkiv's evidence is public, which is the point.

## Run it

```bash
npm run cre:test                 # 7 contract tests (Foundry) + 8 workflow tests (bun)
npm run cre:simulate             # recompute and log; no onchain write while attestationsAddress is empty
```

Write attestations onchain (Sepolia):

```bash
cp cre/.env.example cre/.env     # CRE_ETH_PRIVATE_KEY: a throwaway key with a little Sepolia ETH
npm run cre:deploy-contract      # forwarder = CRE's simulation MockKeystoneForwarder
# put the address in cre/kneedeep-verify/config.staging.json (attestationsAddress)
npm run cre:simulate:broadcast   # recompute, reach consensus, write the attestation to Sepolia
# then set CRE_ATTESTATIONS_ADDRESS=<address> for the API (.env / Render): the map shows "CRE ✓"
```

For a deployed workflow, redeploy with `./cre/contracts/deploy.sh production` (CRE's
KeystoneForwarder) and optionally pin the workflow owner with `setExpectedWorkflowOwner`.

## Live on Sepolia

| What                        | Where                                                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `KneeDeepAttestations`      | [0x1767F0c121c9D966eAB14050e94CD85f68D4fA8b](https://sepolia.etherscan.io/address/0x1767F0c121c9D966eAB14050e94CD85f68D4fA8b) |
| Forwarder (simulation)      | `0x15fC6ae953E024d975e77382eEeC56A9101f9F88` (CRE's MockKeystoneForwarder)                                                    |
| First attestation (9 areas) | [0x1ae6451c…](https://sepolia.etherscan.io/tx/0x1ae6451cc1ddc41024ba159ed79dc5bde30c85666290e8137c231b65ce4a8ac0)             |

## Simulation log

```
[USER LOG] Recomputing KneeDeep areas as of 2026-11-06T17:40:00.000Z from Arkiv
[USER LOG] Consensus: 42 reports, 7 votes, 9 areas, Arkiv block 300451, evidence 0x214777a7…07dc89
[USER LOG] te7u1e6  closed    confidence 0.49  2 supporting human(s), 2 report(s)
[USER LOG] te7u9d4  waist     confidence 0.61  3 supporting human(s), 2 report(s)
[USER LOG] te7uc8t  knee      confidence 0.58  4 supporting human(s), 4 report(s)
[USER LOG] te7u3xb  ankle     confidence 0.50  2 supporting human(s), 2 report(s)
[USER LOG] te7u9zg  dry       confidence 0.51  2 supporting human(s), 2 report(s)
…
```

## Design notes

- **Determinism.** Every node computes for the cron's scheduled time (not its own clock), sorts
  areas and evidence keys canonically, and returns one JSON string; consensus requires identical
  strings. Arkiv queries cannot be pinned to a block, so a report landing between two nodes' reads
  fails that round's consensus; the next round (5 min) succeeds. Nothing wrong is ever written.
- **Bounded.** At most `maxPages` × 100 entities per query and `maxAreas` (25) areas per
  attestation (worst first), within CRE's HTTP, consensus and gas limits. Measured on Sepolia: an
  attestation that only overwrites existing area slots costs ~0.38M gas for 9 areas; each area beyond
  the most ever stored creates storage once, ~0.26M gas. 25 new areas stay under the 9M `gasLimit`
  (CRE's chain-write cap is 10M).
- **Receiver safety.** Only the configured Forwarder can write; an older report never overwrites a
  newer one; the workflow owner can be pinned from the Forwarder metadata.
