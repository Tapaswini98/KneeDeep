/**
 * Coverage: how much you can trust what KneeDeep knows about a cell, never what it says.
 * Passability says what the street looks like; coverage says how good the evidence is. Coverage is
 * free (GET /v1/coverage); the conditions themselves are paid. So nothing here reveals a level.
 *
 * Per cell with live reports, first match wins:
 *   stale         newest evidence older than STALE_AFTER_MIN (still within expiry)
 *   conflicting   contested, disputed, or contradicting reports
 *   corroborated  2+ independent humans (a confirmation counts), newest within FRESH_MIN
 *   unverified    anything else: one human, or corroborated but aging
 * Cells without live reports have no coverage at all: "no data", which is unknown, not dry.
 */
import type { CellAnswer } from './fusion';
import { formatAge, STALE_AFTER_MIN } from './passability';

export type CoverageState = 'corroborated' | 'unverified' | 'conflicting' | 'stale';

/** Corroborated evidence counts as current for this long. */
export const FRESH_MIN = 60;

type Evidence = Pick<CellAnswer, 'level' | 'inputs'>;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function coverageState(a: Evidence): { state: CoverageState; reason: string } {
  const { supportingHumans, distinctHumans, disputes, contradictingReports, reports } = a.inputs;
  const age = a.inputs.newestEvidenceAgeMin;
  const ago = `newest ${formatAge(age)} ago`;

  if (age > STALE_AFTER_MIN) {
    return { state: 'stale', reason: `${plural(reports, 'report')}, ${ago}: too old to rely on.` };
  }
  if (a.level === null || disputes > 0 || contradictingReports > 0) {
    const what = [
      contradictingReports > 0 && `${plural(contradictingReports, 'contradicting report')}`,
      disputes > 0 && `${plural(disputes, 'dispute')}`,
    ].filter(Boolean);
    return {
      state: 'conflicting',
      reason: `${plural(distinctHumans, 'human')} disagree${what.length ? ` (${what.join(', ')})` : ''}; ${ago}.`,
    };
  }
  if (supportingHumans >= 2 && age <= FRESH_MIN) {
    return { state: 'corroborated', reason: `${supportingHumans} independent humans agree; ${ago}.` };
  }
  return {
    state: 'unverified',
    reason:
      supportingHumans <= 1
        ? `One human, not yet confirmed; ${ago}.`
        : `${supportingHumans} humans agree, but the newest evidence is ${formatAge(age)} old; needs a fresh confirmation.`,
  };
}
