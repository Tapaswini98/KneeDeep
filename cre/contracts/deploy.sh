#!/usr/bin/env sh
# Deploy KneeDeepAttestations to Sepolia.
#   ./deploy.sh              forwarder = CRE's simulation MockKeystoneForwarder (cre workflow simulate --broadcast)
#   ./deploy.sh production   forwarder = CRE's KeystoneForwarder (a deployed workflow)
# Needs CRE_ETH_PRIVATE_KEY (a testnet key with a little Sepolia ETH) in cre/.env.
# Forwarders per chain: `cre workflow supported-chains`.
set -eu
cd "$(dirname "$0")"
[ -f ../.env ] && . ../.env
: "${CRE_ETH_PRIVATE_KEY:?set CRE_ETH_PRIVATE_KEY in cre/.env}"

MOCK_FORWARDER=0x15fC6ae953E024d975e77382eEeC56A9101f9F88
FORWARDER=0xF8344CFd5c43616a4366C34E3EEE75af79a74482
[ "${1:-}" = "production" ] || FORWARDER=$MOCK_FORWARDER
RPC=${SEPOLIA_RPC_URL:-https://ethereum-sepolia-rpc.publicnode.com}

echo "Deploying KneeDeepAttestations to Sepolia (forwarder $FORWARDER)..."
forge create src/KneeDeepAttestations.sol:KneeDeepAttestations \
  --rpc-url "$RPC" --private-key "$CRE_ETH_PRIVATE_KEY" --broadcast \
  --constructor-args "$FORWARDER"
echo
echo "Next: put the 'Deployed to' address in"
echo "  cre/kneedeep-verify/config.staging.json   attestationsAddress"
echo "  .env (and Render)                          CRE_ATTESTATIONS_ADDRESS"
