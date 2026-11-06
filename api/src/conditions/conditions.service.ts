import { Inject, Injectable } from '@nestjs/common';
import { ArkivStore } from '../arkiv/arkiv.store';
import { LEVELS, Level } from '../arkiv/schemas';
import { APP_CONFIG, AppConfig } from '../config/config';
import { CellAnswer, fuse } from '../fusion/fusion';
import { cellCenter, distanceMeters, prefixesCovering } from '../geo/geo';
import { DataStatus } from '../queries/queries.repository';
import { CELL_HALF_DIAGONAL_M } from '../reports/reports.service';

export interface UsedReportRef {
  key: string;
  reporter: string;
  corroborated: boolean;
}

const severity = (l: Level | null) => (l === null ? LEVELS.length : LEVELS.indexOf(l));

@Injectable()
export class ConditionsService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly store: ArkivStore,
  ) {}

  /** Read live evidence from Arkiv, fuse it per cell, and say exactly what the answer rests on. */
  async answer(lat: number, lng: number, radiusM: number) {
    const prefixes = prefixesCovering(lat, lng, radiusM);
    const { reports, votes, block } = await this.store.findInArea(prefixes);
    const point = { lat, lng };
    const nearby = reports.filter(
      (r) => distanceMeters(point, cellCenter(r.cell)) <= radiusM + CELL_HALF_DIAGONAL_M,
    );

    const cells = fuse(nearby, votes, { now: Date.now() / 1000 })
      .map((a) => ({ a, distanceM: Math.round(distanceMeters(point, cellCenter(a.cell))) }))
      // Worst first (contested counts as worst: unknown is not safe), then most confident, then nearest.
      .sort(
        (x, y) =>
          severity(y.a.level) - severity(x.a.level) ||
          y.a.confidence - x.a.confidence ||
          x.distanceM - y.distanceM,
      );

    const sources = new Set(cells.map(({ a }) => a.source));
    const dataStatus: DataStatus =
      cells.length === 0 ? 'empty' : sources.size === 1 ? ([...sources][0] as DataStatus) : 'mixed';

    const used: UsedReportRef[] = cells.flatMap(({ a }) =>
      a.reports.map((r) => ({ key: r.key, reporter: r.reporter, corroborated: r.corroborated })),
    );

    const notices: string[] = [];
    if (dataStatus === 'empty') {
      notices.push('No fresh reports within this radius. Absence of reports is not evidence of a dry road.');
    }
    if (sources.has('simulated') || sources.has('mixed')) {
      notices.push('Includes SIMULATED demo data, not real observations.');
    }

    return {
      dataStatus,
      cells: cells.map(({ a }) => a.cell),
      used,
      body: {
        query: { lat, lng, radiusM, searchedPrefixes: prefixes },
        generatedAt: new Date().toISOString(),
        dataStatus,
        notices,
        method: {
          recencyHalfLifeMin: 45,
          maxReportAgeMin: Math.round(this.config.REPORT_TTL_SECONDS / 60),
          cellSizeM: 150,
          confidence: 'corroboration x agreement x freshness; see docs/design.md',
        },
        source: {
          arkivBlock: block.toString(),
          writer: this.store.writer,
          note: 'Every report and vote behind this answer is a public, expiring Arkiv entity.',
        },
        areas: cells.map(({ a, distanceM }) => toArea(a, distanceM)),
      },
    };
  }
}

function toArea(a: CellAnswer, distanceM: number) {
  return {
    cell: a.cell,
    center: cellCenter(a.cell),
    distanceM,
    level: a.level,
    confidence: a.confidence,
    confidenceLabel: a.confidenceLabel,
    explanation: a.explanation,
    inputs: a.inputs,
    source: a.source,
    reports: a.reports.map((r) => ({
      key: r.key,
      level: r.level,
      ageMin: r.ageMin,
      source: r.source,
      confirmations: r.confirmations,
      disputes: r.disputes,
      corroborated: r.corroborated,
    })),
  };
}
