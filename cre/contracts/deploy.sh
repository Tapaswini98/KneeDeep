#!/usr/bin/env sh
# Deploy KneeDeepAttestations to Sepolia.
#   ./deploy.sh              forwarder = CRE's simulation MockKeystoneForwarder (cre workflow simulate --broadcast)
#   ./deploy.sh production   forwarder = CRE's KeystoneForwarder (a deployed workflow)
# Needs CRE_ETH_PRIVATE_KEY (a testnet key with a little Sepolia ETH) in cre/.env, and optionally
# CRE_DEPLOYER_ADDRESS to make sure the key is the one you meant to use.
# Forwarders per chain: `cre workflow supported-chains`.
set -eu
cd "$(dirname "$0")"
[ -f ../.env ] && . ../.env
: "${CRE_ETH_PRIVATE_KEY:?set CRE_ETH_PRIVATE_KEY in cre/.env}"

MOCK_FORWARDER=0x15fC6ae953E024d975e77382eEeC56A9101f9F88
FORWARDER=0xF8344CFd5c43616a4366C34E3EEE75af79a74482
[ "${1:-}" = "production" ] || FORWARDER=$MOCK_FORWARDER
RPC=${SEPOLIA_RPC_URL:-https://ethereum-sepolia-rpc.publicnode.com}

# Accept the key with or without 0x.
case "$CRE_ETH_PRIVATE_KEY" in
  0x*) KEY=$CRE_ETH_PRIVATE_KEY ;;
  *) KEY=0x$CRE_ETH_PRIVATE_KEY ;;
esac

DEPLOYER=$(cast wallet address --private-key "$KEY")
if [ -n "${CRE_DEPLOYER_ADDRESS:-}" ]; then
  want=$(echo "$CRE_DEPLOYER_ADDRESS" | tr 'A-F' 'a-f')
  got=$(echo "$DEPLOYER" | tr 'A-F' 'a-f')
  if [ "$want" != "$got" ]; then
    echo "CRE_ETH_PRIVATE_KEY belongs to $DEPLOYER, not CRE_DEPLOYER_ADDRESS $CRE_DEPLOYER_ADDRESS" >&2
    exit 1
  fi
fi

BALANCE=$(cast balance "$DEPLOYER" --rpc-url "$RPC")
if [ "$BALANCE" = "0" ]; then
  echo "$DEPLOYER has no Sepolia ETH: fund it first (https://faucets.chain.link/sepolia)" >&2
  exit 1
fi

echo "Deploying KneeDeepAttestations to Sepolia"
echo "  deployer   $DEPLOYER ($(cast from-wei "$BALANCE") ETH)"
echo "  forwarder  $FORWARDER"
forge create src/KneeDeepAttestations.sol:KneeDeepAttestations \
  --rpc-url "$RPC" --private-key "$KEY" --broadcast \
  --constructor-args "$FORWARDER"
echo
echo "Next: put the 'Deployed to' address in"
echo "  cre/kneedeep-verify/config.staging.json   attestationsAddress"
echo "  .env (and Render)                          CRE_ATTESTATIONS_ADDRESS"
