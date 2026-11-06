/**
 * kneedeep-verify: "don't trust KneeDeep either".
 *
 * Every few minutes, each node of a Chainlink DON independently:
 *   1. reads KneeDeep's raw evidence (reports and votes) from Arkiv's PUBLIC JSON-RPC,
 *      bypassing KneeDeep's own server entirely;
 *   2. recomputes the answer for every area with KneeDeep's published fusion engine;
 * then the DON agrees on the result (identical-value consensus) and writes a signed attestation
 * to the KneeDeepAttestations contract on Sepolia: per area the level, confidence and
 * supporting humans, plus a hash of exactly which evidence was used.
 *
 * Anyone can then check KneeDeep's paid answers against the attestation. Consensus proves the
 * nodes agree on what the public evidence says, not that the human reports are true.
 */
import {
  bytesToHex,
  consensusIdenticalAggregation,
  type CronPayload,
  cre,
  getNetwork,
  type HTTPSendRequester,
  prepareReportRequest,
  type Runtime,
  TxStatus,
} from '@chainlink/cre-sdk';
import type { Address } from 'viem';
import { z } from 'zod';
import { encodeAttestation } from './attestation';
import {
  computeVerdict,
  levelName,
  PAGE_SIZE,
  reportsBody,
  type RpcEntity,
  type RpcQueryResult,
  toReport,
  toVote,
  type Verdict,
  votesBody,
} from './evidence';

export const configSchema = z.object({
  /** Cron schedule with seconds, e.g. every 5 minutes: "0 *\/5 * * * *". */
  schedule: z.string(),
  /** Arkiv's public JSON-RPC (Rabdi testnet). No API key: the evidence is public. */
  // A plain pattern: z.string().url() needs the URL global, which the workflow sandbox lacks.
  arkivRpcUrl: z.string().regex(/^https:\/\/[^\s]+$/),
  /** KneeDeep's Arkiv writer: only entities it owns are KneeDeep evidence. */
  kneedeepWriter: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  /** Attest at most this many areas (worst first), to bound gas. */
  maxAreas: z.number().int().positive().max(100),
  /** Safety cap on pages fetched per query (100 entities each). */
  maxPages: z.number().int().positive().max(10),
  chainSelectorName: z.string(),
  /** KneeDeepAttestations on that chain. Empty: compute and log only, no onchain write. */
  attestationsAddress: z.string().regex(/^(0x[0-9a-fA-F]{40})?$/),
  gasLimit: z.string(),
});

type Config = z.infer<typeof configSchema>;

/** All pages of one Arkiv query, through the CRE HTTP capability (runs on each node). */
function fetchAll(
  send: HTTPSendRequester,
  config: Config,
  body: (writer: string, offset: number) => string,
): { entities: RpcEntity[]; block: number } {
  const entities: RpcEntity[] = [];
  let block = 0;
  for (let page = 0; page < config.maxPages; page++) {
    const res = send
      .sendRequest({
        url: config.arkivRpcUrl,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.from(body(config.kneedeepWriter, page * PAGE_SIZE)).toString('base64'),
      })
      .result();
    if (res.statusCode !== 200) throw new Error(`Arkiv RPC answered HTTP ${res.statusCode}`);
    const rpc = JSON.parse(Buffer.from(res.body).toString('utf-8')) as {
      result?: RpcQueryResult;
      error?: { message: string };
    };
    if (!rpc.result) throw new Error(`Arkiv query failed: ${rpc.error?.message ?? 'no result'}`);
    block = Math.max(block, Number(BigInt(rpc.result.blockNumber)));
    entities.push(...rpc.result.data);
    if (rpc.result.data.length < PAGE_SIZE) break;
  }
  return { entities, block };
}

/**
 * Node mode: read the evidence and recompute. Returns canonical JSON so that honest nodes reading
 * the same evidence return byte-identical results (and consensus can require exactly that).
 */
const recompute = (send: HTTPSendRequester, config: Config, asOf: number): string => {
  const r = fetchAll(send, config, reportsBody);
  const v = fetchAll(send, config, votesBody);
  const reports = r.entities.map(toReport).filter((x) => x !== null);
  const votes = v.entities.map(toVote).filter((x) => x !== null);
  // The block is excluded from consensus: nodes may read one block apart with identical evidence.
  const verdict = computeVerdict(reports, votes, { asOf, arkivBlock: 0, maxAreas: config.maxAreas });
  return JSON.stringify({ verdict, block: Math.min(r.block, v.block) });
};

function attest(runtime: Runtime<Config>, verdict: Verdict): string {
  const { chainSelectorName, attestationsAddress, gasLimit } = runtime.config;
  const network = getNetwork({ chainFamily: 'evm', chainSelectorName, isTestnet: true });
  if (!network) throw new Error(`Unknown chain ${chainSelectorName}`);

  const report = runtime.report(prepareReportRequest(encodeAttestation(verdict))).result();
  const evm = new cre.capabilities.EVMClient(network.chainSelector.selector);
  const res = evm
    .writeReport(runtime, {
      receiver: attestationsAddress as Address,
      report,
      gasConfig: { gasLimit },
    })
    .result();
  if (res.txStatus !== TxStatus.SUCCESS) {
    throw new Error(`Attestation write failed: ${res.errorMessage || res.txStatus}`);
  }
  const tx = bytesToHex(res.txHash ?? new Uint8Array(32));
  runtime.log(`Attested on ${chainSelectorName}: tx ${tx}`);
  return tx;
}

export const onCron = (runtime: Runtime<Config>, payload: CronPayload): string => {
  // The scheduled time, identical on every node, is the "now" the answer is computed for.
  const asOf = Number(payload.scheduledExecutionTime?.seconds ?? 0n);
  if (!asOf) throw new Error('Cron payload has no scheduled execution time');

  runtime.log(`Recomputing KneeDeep areas as of ${new Date(asOf * 1000).toISOString()} from Arkiv`);
  const http = new cre.capabilities.HTTPClient();
  const agreed = http
    .sendRequest(
      runtime,
      recompute,
      consensusIdenticalAggregation<string>(),
    )(runtime.config, asOf)
    .result();
  const { verdict: v, block } = JSON.parse(agreed) as { verdict: Verdict; block: number };
  const verdict: Verdict = { ...v, arkivBlock: block };

  runtime.log(
    `Consensus: ${verdict.reports} reports, ${verdict.votes} votes, ${verdict.areas.length} areas, ` +
      `Arkiv block ${verdict.arkivBlock}, evidence ${verdict.evidenceHash}`,
  );
  for (const a of verdict.areas) {
    runtime.log(
      `  ${a.cell}  ${levelName(a.level).padEnd(9)} confidence ${(a.confidenceBps / 10_000).toFixed(2)}  ` +
        `${a.supporters} supporting human(s), ${a.reports} report(s)`,
    );
  }

  if (!runtime.config.attestationsAddress) {
    runtime.log('No attestationsAddress configured: verdict computed and logged, not written onchain');
    return verdict.evidenceHash;
  }
  return attest(runtime, verdict);
};

export function initWorkflow(config: Config) {
  const cron = new cre.capabilities.CronCapability();
  return [cre.handler(cron.trigger({ schedule: config.schedule }), onCron)];
}
