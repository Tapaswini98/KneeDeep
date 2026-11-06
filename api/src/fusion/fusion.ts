/**
 * Fusion engine: turns live reports and votes into one explainable answer per cell.
 * Pure and deterministic; no I/O, no AI. Every number it outputs comes with its inputs.
 *
 * Per cell:
 *   1. Drop anything stale (older than maxAgeMin) or from the future.
 *   2. One voice per human: keep each reporter's latest report; ignore votes on your own report.
 *   3. Weight evidence by recency: w = 0.5 ^ (ageMin / halfLifeMin).
 *   4. score(level) = reports at level + confirmations of them - disputes of them.
 *      The highest score wins; ties go to the more severe level (safer for routing).
 *   5. confidence = corroboration x agreement x freshness
 *        corroboration = 1 - 0.5 ^ distinctSupportingHumans    (1 human -> 0.5, 2 -> 0.75, 3 -> 0.875)
 *        agreement     = support / (support + against)          (contradictions and disputes lower it)
 *        freshness     = 0.5 + 0.5 * w(newest supporting evidence)
 *      A single human can never reach "high".
 */
// Dependency-free on purpose: this file also runs inside the CRE workflow (cre/kneedeep-verify).
import { type Level, LEVELS, type Source, type Vote } from '../arkiv/vocabulary';

export interface ReportInput {
  key: string;
  cell: string;
  level: Level;
  /** Unix seconds. */
  reportedAt: number;
  reporter: string;
  source: Source;
}

export interface VoteInput {
  /** Entity key of the report voted on. */
  report: string;
  vote: Vote;
  voter: string;
  /** Unix seconds. */
  votedAt: number;
  source: Source;
}

export interface FusionOptions {
  /** Unix seconds. */
  now: number;
  halfLifeMin?: number;
  maxAgeMin?: number;
}

export type ConfidenceLabel = 'high' | 'medium' | 'low';
export type DataSource = Source | 'mixed';

export interface UsedReport {
  key: string;
  reporter: string;
  level: Level;
  ageMin: number;
  source: Source;
  confirmations: number;
  disputes: number;
  /** At least one other human agrees with this report's level (reports or confirmations of any source). */
  corroborated: boolean;
  /**
   * Payout eligibility: a live report corroborated by at least one other LIVE human. Simulated data
   * never earns, and never makes a live report earn.
   */
  earns: boolean;
}

export interface CellAnswer {
  cell: string;
  /** Null when the evidence is contested (disputes outweigh every level). */
  level: Level | null;
  confidence: number;
  confidenceLabel: ConfidenceLabel;
  explanation: string;
  inputs: {
    distinctHumans: number;
    supportingHumans: number;
    reports: number;
    contradictingReports: number;
    confirmations: number;
    disputes: number;
    newestAgeMin: number;
    oldestAgeMin: number;
    /** Newest evidence of any kind: a report or a confirmation (a fresh confirmation re-observes the street). */
    newestEvidenceAgeMin: number;
  };
  source: DataSource;
  reports: UsedReport[];
}

export const DEFAULT_HALF_LIFE_MIN = 45;
export const DEFAULT_MAX_AGE_MIN = 180;
const FUTURE_TOLERANCE_S = 60;

const SEVERITY: Record<Level, number> = Object.fromEntries(LEVELS.map((l, i) => [l, i])) as Record<
  Level,
  number
>;

const PHRASE: Record<Level, string> = {
  dry: 'a dry road',
  ankle: 'ankle-deep water',
  knee: 'knee-deep water',
  waist: 'waist-deep water',
  closed: 'the road closed',
};

const round = (x: number, dp = 2) => Math.round(x * 10 ** dp) / 10 ** dp;
const ageMin = (now: number, t: number) => Math.max(0, (now - t) / 60);

export function recencyWeight(ageMinutes: number, halfLifeMin = DEFAULT_HALF_LIFE_MIN): number {
  return Math.pow(0.5, Math.max(0, ageMinutes) / halfLifeMin);
}

export function confidenceLabel(confidence: number, supportingHumans: number): ConfidenceLabel {
  if (confidence >= 0.7 && supportingHumans >= 2) return 'high';
  if (confidence >= 0.4) return 'medium';
  return 'low';
}

function formatAge(min: number): string {
  if (min < 1) return 'just now';
  if (min < 60) return `${Math.round(min)} min ago`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h} h ${m} min ago` : `${h} h ago`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Fuse every cell present in the inputs. Cells with no fresh reports are omitted (absence is not "dry"). */
export function fuse(reports: ReportInput[], votes: VoteInput[], opts: FusionOptions): CellAnswer[] {
  const byCell = new Map<string, ReportInput[]>();
  for (const r of reports) {
    const list = byCell.get(r.cell) ?? [];
    list.push(r);
    byCell.set(r.cell, list);
  }
  const answers: CellAnswer[] = [];
  for (const [cell, cellReports] of byCell) {
    const answer = fuseCell(cell, cellReports, votes, opts);
    if (answer) answers.push(answer);
  }
  return answers;
}

export function fuseCell(
  cell: string,
  reports: ReportInput[],
  votes: VoteInput[],
  opts: FusionOptions,
): CellAnswer | null {
  const now = opts.now;
  const halfLife = opts.halfLifeMin ?? DEFAULT_HALF_LIFE_MIN;
  const maxAge = opts.maxAgeMin ?? DEFAULT_MAX_AGE_MIN;
  const fresh = (t: number) => t <= now + FUTURE_TOLERANCE_S && ageMin(now, t) <= maxAge;
  const w = (t: number) => recencyWeight(ageMin(now, t), halfLife);

  // 1-2. Fresh reports in this cell, one (the latest) per human.
  const latest = new Map<string, ReportInput>();
  for (const r of reports) {
    if (r.cell !== cell || !fresh(r.reportedAt)) continue;
    const prev = latest.get(r.reporter);
    if (!prev || r.reportedAt > prev.reportedAt) latest.set(r.reporter, r);
  }
  const kept = [...latest.values()];
  if (kept.length === 0) return null;

  // Fresh votes on kept reports, one per (report, voter), never by the report's own author.
  const keptByKey = new Map(kept.map((r) => [r.key, r]));
  const voteMap = new Map<string, VoteInput>();
  for (const v of votes) {
    const target = keptByKey.get(v.report);
    if (!target || v.voter === target.reporter || !fresh(v.votedAt)) continue;
    const id = `${v.report}|${v.voter}`;
    const prev = voteMap.get(id);
    if (!prev || v.votedAt > prev.votedAt) voteMap.set(id, v);
  }
  const keptVotes = [...voteMap.values()];
  const votesOn = (key: string) => keptVotes.filter((v) => v.report === key);

  // 4. Score each level.
  const score = new Map<Level, number>();
  for (const r of kept) {
    let s = w(r.reportedAt);
    for (const v of votesOn(r.key)) s += v.vote === 'confirm' ? w(v.votedAt) : -w(v.votedAt);
    score.set(r.level, (score.get(r.level) ?? 0) + s);
  }
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1] || SEVERITY[b[0]] - SEVERITY[a[0]]);
  const [topLevel, topScore] = ranked[0];
  const contested = topScore <= 0;
  const level: Level | null = contested ? null : topLevel;

  // Who agrees with whom.
  const humansAt = (l: Level) => {
    const set = new Set<string>();
    for (const r of kept.filter((x) => x.level === l)) {
      set.add(r.reporter);
      for (const v of votesOn(r.key)) if (v.vote === 'confirm') set.add(v.voter);
    }
    return set;
  };
  const allHumans = new Set<string>([...kept.map((r) => r.reporter), ...keptVotes.map((v) => v.voter)]);

  let support = 0;
  let against = 0;
  let newestSupportAge = Infinity;
  const supporters = level ? humansAt(level) : new Set<string>();
  for (const r of kept) {
    const rw = w(r.reportedAt);
    if (level && r.level === level) {
      support += rw;
      newestSupportAge = Math.min(newestSupportAge, ageMin(now, r.reportedAt));
      for (const v of votesOn(r.key)) {
        if (v.vote === 'confirm') {
          support += w(v.votedAt);
          newestSupportAge = Math.min(newestSupportAge, ageMin(now, v.votedAt));
        } else {
          against += w(v.votedAt);
        }
      }
    } else {
      against += rw;
    }
  }

  // 5. Confidence.
  let confidence = 0;
  if (level) {
    const corroboration = 1 - Math.pow(0.5, supporters.size);
    const agreement = support / (support + against);
    const freshness = 0.5 + 0.5 * recencyWeight(newestSupportAge, halfLife);
    confidence = round(corroboration * agreement * freshness);
  }
  const label = level ? confidenceLabel(confidence, supporters.size) : 'low';

  // Per-report detail and payout eligibility.
  const used: UsedReport[] = kept
    .map((r) => {
      const rv = votesOn(r.key);
      const agreeing = kept.filter((o) => o.reporter !== r.reporter && o.level === r.level);
      const confirms = rv.filter((v) => v.vote === 'confirm');
      const liveBacking =
        agreeing.some((o) => o.source === 'live') || confirms.some((v) => v.source === 'live');
      return {
        key: r.key,
        reporter: r.reporter,
        level: r.level,
        ageMin: round(ageMin(now, r.reportedAt), 1),
        source: r.source,
        confirmations: confirms.length,
        disputes: rv.filter((v) => v.vote === 'dispute').length,
        corroborated: agreeing.length > 0 || confirms.length > 0,
        earns: r.source === 'live' && liveBacking,
      };
    })
    .sort((a, b) => a.ageMin - b.ageMin);

  const ages = kept.map((r) => ageMin(now, r.reportedAt));
  const confirmAges = keptVotes.filter((v) => v.vote === 'confirm').map((v) => ageMin(now, v.votedAt));
  const confirmations = confirmAges.length;
  const disputes = keptVotes.filter((v) => v.vote === 'dispute').length;
  const contradicting = level ? kept.filter((r) => r.level !== level) : [];

  const sources = new Set<Source>([...kept.map((r) => r.source), ...keptVotes.map((v) => v.source)]);
  const source: DataSource = sources.size === 1 ? [...sources][0] : 'mixed';

  return {
    cell,
    level,
    confidence,
    confidenceLabel: label,
    explanation: explain({
      level,
      supporters: supporters.size,
      ages,
      confirmations,
      disputes,
      contradicting,
      kept,
    }),
    inputs: {
      distinctHumans: allHumans.size,
      supportingHumans: supporters.size,
      reports: kept.length,
      contradictingReports: contradicting.length,
      confirmations,
      disputes,
      newestAgeMin: round(Math.min(...ages), 1),
      oldestAgeMin: round(Math.max(...ages), 1),
      newestEvidenceAgeMin: round(Math.min(...ages, ...confirmAges), 1),
    },
    source,
    reports: used,
  };
}

function explain(a: {
  level: Level | null;
  supporters: number;
  ages: number[];
  confirmations: number;
  disputes: number;
  contradicting: ReportInput[];
  kept: ReportInput[];
}): string {
  const newest = Math.min(...a.ages);
  const oldest = Math.max(...a.ages);
  const when =
    a.ages.length === 1 ? formatAge(newest) : `newest ${formatAge(newest)}, oldest ${formatAge(oldest)}`;
  const votes: string[] = [];
  if (a.confirmations) votes.push(plural(a.confirmations, 'confirmation'));
  if (a.disputes) votes.push(plural(a.disputes, 'dispute'));

  if (!a.level) {
    const levels = [...new Set(a.kept.map((r) => r.level))].join(', ');
    return `Contested: ${plural(a.kept.length, 'report')} (${levels}) outweighed by disputes; ${when}. Treat as unknown.`;
  }

  const who = a.supporters === 1 ? '1 human reports' : `${a.supporters} independent humans report`;
  const parts = [`${who} ${PHRASE[a.level]}`, when];
  if (votes.length) parts.push(votes.join(', '));
  if (a.contradicting.length) {
    const other = [...new Set(a.contradicting.map((r) => r.level))].join(', ');
    parts.push(`${plural(a.contradicting.length, 'contradicting report')} (${other})`);
  }
  if (a.supporters === 1) parts.push('not yet corroborated');
  return parts.join('; ') + '.';
}
