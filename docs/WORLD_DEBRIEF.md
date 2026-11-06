# World ID integration debrief

## What KneeDeep uses World ID for

One verified human, one voice. A street report or a vote is accepted only from someone who
has proved, with World ID 4.0 **Proof of Human**, that they are a unique person. Bots and
people with many accounts cannot fake a flood or outvote the truth.

## Why Proof of Human is the minimum sufficient credential

KneeDeep needs to know exactly one thing about a reporter: *is this a different person from
the other reporters?* Corroboration ("3 independent humans") only means something if the
three are really three people.

- **Proof of Human answers that and nothing more.** It reveals no name, age, nationality or
  document, which matches our privacy rule of storing nothing we do not need.
- **Passport, document and identity-check credentials** prove more (nationality, age,
  identity attributes) than the decision needs, add friction, and shrink the pool of people
  who can report. A street report does not depend on who you are, only that you are one person.
- **Selfie Check** would widen access but carries a weaker uniqueness guarantee than an
  Orb-verified Proof of Human, and uniqueness is the property the confidence score relies on.

## How it works

1. The browser asks our API for an IDKit context (`GET /v1/identity/context`). The API signs
   the RP request with the RP signing key (5-minute expiry). The key never reaches the browser.
2. IDKit runs `proofOfHuman({ signal: "kneedeep:reporter-session" })` with `allow_legacy_proofs: false`.
3. The IDKit result goes to `POST /v1/identity/session` untouched. Before calling World, the
   server rejects:
   - legacy 3.0 proofs (their nullifiers differ from 4.0 ones, so accepting both would let
     one person count twice),
   - proofs for another action or environment,
   - proofs without the Proof of Human credential,
   - proofs not bound to our signal (`signal_hash ≠ hashSignal(signal)`).
4. The server calls `POST https://developer.world.org/api/v4/verify/{rp_id}`, requires the
   `proof_of_human` result to have passed, and normalises its nullifier.
5. The nullifier becomes a pseudonym, `sha256(salt ":" nullifier)`, and is then discarded.
   The reporter gets a signed session (12 h) carrying only that pseudonym.
6. Reports and votes need the session. Per-human limits (one report per ~150 m cell per
   30 min, one vote per report, no voting on your own report) key on the pseudonym.

**Unsuccessful paths (all tested):** no session → 401; forged, legacy, wrong-action,
wrong-environment or wrong-signal proof → 401; a dev-mode session after switching to World
mode → 401; repeat report from the same human in the same cell → 429. In every case nothing
is written to Arkiv or Postgres.

## Why a session rather than a proof per report

The same human always produces the same nullifier for the same action, and World leaves
uniqueness enforcement to the app. Asking for a fresh proof for every report would mean a
QR scan for each report, which is too much friction for someone standing in water. The IDKit
error list also includes `nullifier_replayed`, and the docs did not make clear whether World
App would refuse a second proof for the same action. Verifying once and issuing a short
session avoids both problems. Every report still traces back to one verified human.

## Integration notes (fill in during the event)

| | |
|---|---|
| Time to first successful verification | _TODO_ |
| Environment used for the demo | _production (World App) / staging (simulator)_ |

### Friction

- IDKit 4's type declarations resolve as ESM only, so a NestJS (CommonJS) backend cannot
  statically import `@worldcoin/idkit-core/signing` or `/hashing` under `node16` module
  resolution, even though CommonJS builds ship. We work around it with type-only imports in
  `resolution-mode: "import"` plus `require` (`api/src/identity/idkit.ts`).
- The v4 verify docs do not say whether the endpoint checks `signal_hash` against anything,
  so we check it ourselves.
- The semantics of `nullifier_replayed` and `max_verifications_reached` (who enforces them,
  and when) are not documented.
- The v4 verify endpoint accepts legacy 3.0 proofs too, and can report overall success when
  any one credential passes. Apps must check the credential themselves.

### Missing docs

- A worked backend example of signal binding (what `signal_hash` must equal, and who checks it).
- Whether the same human may verify the same action repeatedly, and how that shows up in World App.

### Top improvement

Have the verify endpoint take the expected signal (or signal hash) and credential as
parameters and reject mismatches itself, so every integrator does not have to rebuild these
checks.
