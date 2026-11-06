import { timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { APP_CONFIG, AppConfig } from '../config/config';
import { hashscanTxUrl } from '../hedera/keys';
import { tripSchema } from './trips.dto';
import { TripRow, TripsRepository } from './trips.repository';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Dispatch decisions made by agents with KneeDeep's answers.
 *   POST /v1/trips       the agent records a decision (Bearer AGENT_API_TOKEN: no fake trips)
 *   GET  /v1/trips       free: the latest decisions, for the map
 *   GET  /v1/trips/:id   free: one decision
 */
@Controller('v1/trips')
export class TripsController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly trips: TripsRepository,
  ) {}

  @Post()
  @HttpCode(201)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async record(@Headers('authorization') auth: string | undefined, @Body() body: unknown) {
    const expected = this.config.AGENT_API_TOKEN;
    if (!expected)
      throw new ServiceUnavailableException('Trip recording is not configured (AGENT_API_TOKEN)');
    const token = auth?.match(/^Bearer\s+(.+)$/i)?.[1] ?? '';
    const ok = token.length === expected.length && timingSafeEqual(Buffer.from(token), Buffer.from(expected));
    if (!ok) throw new UnauthorizedException('Invalid agent token');

    const parsed = tripSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
    }
    return { id: await this.trips.create(parsed.data) };
  }

  @Get()
  async list(@Query('limit') limitRaw?: string) {
    const limit = Math.min(Math.max(Number(limitRaw) || 10, 1), 50);
    const trips = await this.trips.recent(limit);
    return { generatedAt: new Date().toISOString(), trips: trips.map(present) };
  }

  @Get(':id')
  async one(@Param('id') id: string) {
    const trip = UUID.test(id) ? await this.trips.byId(id) : null;
    if (!trip) throw new NotFoundException('No such trip');
    return present(trip);
  }
}

/** Adds a HashScan link to every paid checkpoint. */
function present(t: TripRow) {
  const link = (txId: string | null) => (txId && t.network ? hashscanTxUrl(t.network, txId) : null);
  return {
    ...t,
    routes: t.routes.map((r) => ({
      ...r,
      checkpoints: r.checkpoints.map((c) => ({ ...c, hashscan: link(c.txId) })),
    })),
  };
}
