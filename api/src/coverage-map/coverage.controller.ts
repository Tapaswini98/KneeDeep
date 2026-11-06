import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ArkivStore } from '../arkiv/arkiv.store';
import { APP_CONFIG, AppConfig } from '../config/config';
import { coverageState } from '../fusion/coverage';
import { fuse } from '../fusion/fusion';
import { type BBox, cellBounds, clipToMumbai, prefixesForBbox } from '../geo/geo';

/** Larger viewports are refused: zoom in. All of Mumbai (0.65 x 0.4 degrees) fits. */
const MAX_SPAN_DEG = 1;
const MAX_CELLS = 400;
/** Several viewers polling the same view share one Arkiv read. */
const CACHE_MS = 10_000;

function parseBbox(raw: string | undefined): BBox {
  const parts = (raw ?? '').split(',').map((s) => Number(s.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new BadRequestException('bbox must be minLat,minLng,maxLat,maxLng');
  }
  const [minLat, minLng, maxLat, maxLng] = parts;
  if (minLat >= maxLat || minLng >= maxLng || minLat < -90 || maxLat > 90 || minLng < -180 || maxLng > 180) {
    throw new BadRequestException('bbox must be minLat,minLng,maxLat,maxLng with min < max');
  }
  if (maxLat - minLat > MAX_SPAN_DEG || maxLng - minLng > MAX_SPAN_DEG) {
    throw new BadRequestException(`bbox spans more than ${MAX_SPAN_DEG} degree; zoom in`);
  }
  return [minLat, minLng, maxLat, maxLng];
}

/**
 * GET /v1/coverage?bbox=minLat,minLng,maxLat,maxLng  (free)
 *
 * Where KneeDeep has evidence and how much it can be trusted (corroborated, unverified,
 * conflicting, stale), per ~150 m cell. Never the water level or passability: what the evidence
 * says is the paid product (GET /v1/conditions). A cell that is not listed has no data, which
 * means unknown, not dry.
 */
@Controller('v1/coverage')
export class CoverageController {
  private readonly cache = new Map<string, { at: number; body: Promise<unknown> }>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly store: ArkivStore,
  ) {}

  // Every new view is an Arkiv read: a map polling every 15 s while panning needs far less than this.
  @Get()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  coverage(@Query('bbox') raw?: string) {
    const requested = parseBbox(raw);
    const bbox = clipToMumbai(requested);
    if (!bbox) {
      return { generatedAt: new Date().toISOString(), bbox: requested, truncated: false, cells: [] };
    }
    // Round to ~100 m so tiny pans reuse the cached read.
    const key = bbox.map((n) => n.toFixed(3)).join(',');
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.body;
    const body = this.compute(bbox);
    this.cache.set(key, { at: Date.now(), body });
    body.catch(() => this.cache.delete(key));
    if (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value!);
    return body;
  }

  private async compute(bbox: BBox) {
    const [minLat, minLng, maxLat, maxLng] = bbox;
    const { reports, votes } = await this.store.findInArea(prefixesForBbox(bbox));
    // Any cell that overlaps the view, so squares at the edges are drawn too.
    const inView = (cell: string) => {
      const [south, west, north, east] = cellBounds(cell);
      return south <= maxLat && north >= minLat && west <= maxLng && east >= minLng;
    };
    const cells = fuse(
      reports.filter((r) => inView(r.cell)),
      votes,
      { now: Date.now() / 1000, maxAgeMin: Math.round(this.config.REPORT_TTL_SECONDS / 60) },
    )
      .map((a) => ({
        cell: a.cell,
        bounds: cellBounds(a.cell),
        ...coverageState(a),
        humans: a.inputs.distinctHumans,
        evidenceAgeMin: a.inputs.newestEvidenceAgeMin,
        source: a.source,
      }))
      // Freshest first, so a capped answer keeps what matters now.
      .sort((x, y) => x.evidenceAgeMin - y.evidenceAgeMin || (x.cell < y.cell ? -1 : 1));

    return {
      generatedAt: new Date().toISOString(),
      bbox,
      truncated: cells.length > MAX_CELLS,
      cells: cells.slice(0, MAX_CELLS),
    };
  }
}
