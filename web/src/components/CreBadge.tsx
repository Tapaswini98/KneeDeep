import type { Verification } from '../lib/api';
import { LEVELS } from '../lib/levels';

type Enabled = Extract<Verification, { enabled: true }>;

const label = (level: string | null) => LEVELS.find((l) => l.id === level)?.label ?? 'contested';

/**
 * Whether an answer for this area agrees with the independent Chainlink CRE attestation:
 * "CRE ✓" when the DON computed the same level from public evidence, otherwise what it computed.
 */
export function CreBadge({ v, cell, level }: { v: Enabled | null; cell: string; level: string | null }) {
  const area = v?.areas.find((a) => a.cell === cell);
  if (!v || !area) return null;
  const same = area.attested.level === level;
  const when = `${Math.round(v.ageMin)} min ago`;
  return (
    <a
      className={`cre-badge ${same ? 'ok' : 'differs'}`}
      href={v.contractUrl}
      target="_blank"
      rel="noreferrer"
      title={
        same
          ? `Chainlink CRE independently recomputed ${label(level)} for this area from public Arkiv evidence (${when}).`
          : `Chainlink CRE computed ${label(area.attested.level)} for this area (${when}); this answer says ${label(level)}.`
      }
      onClick={(e) => e.stopPropagation()}
    >
      {same ? 'CRE ✓' : `CRE: ${label(area.attested.level)}`}
    </a>
  );
}
