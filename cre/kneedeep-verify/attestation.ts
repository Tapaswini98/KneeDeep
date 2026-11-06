/**
 * ABI encoding of a verdict for KneeDeepAttestations.onReport. Must match the Solidity struct
 * `Attestation` in cre/contracts/src/KneeDeepAttestations.sol (abi.decode(report, (Attestation))).
 */
import { encodeAbiParameters, type Hex } from 'viem';
import type { Verdict } from './evidence';

export const ATTESTATION_ABI = [
  {
    type: 'tuple',
    components: [
      { name: 'asOf', type: 'uint64' },
      { name: 'arkivBlock', type: 'uint64' },
      { name: 'evidenceHash', type: 'bytes32' },
      { name: 'reports', type: 'uint32' },
      { name: 'votes', type: 'uint32' },
      {
        name: 'areas',
        type: 'tuple[]',
        components: [
          { name: 'cell', type: 'string' },
          { name: 'level', type: 'uint8' },
          { name: 'confidenceBps', type: 'uint16' },
          { name: 'supporters', type: 'uint16' },
          { name: 'reports', type: 'uint16' },
        ],
      },
    ],
  },
] as const;

export function encodeAttestation(v: Verdict): Hex {
  return encodeAbiParameters(ATTESTATION_ABI, [
    {
      asOf: BigInt(v.asOf),
      arkivBlock: BigInt(v.arkivBlock),
      evidenceHash: v.evidenceHash,
      reports: v.reports,
      votes: v.votes,
      areas: v.areas.map((a) => ({
        cell: a.cell,
        level: a.level,
        confidenceBps: a.confidenceBps,
        supporters: Math.min(a.supporters, 65_535),
        reports: Math.min(a.reports, 65_535),
      })),
    },
  ]);
}
