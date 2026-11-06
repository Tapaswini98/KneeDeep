import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import type { z, ZodTypeAny } from 'zod';
import { Throttle } from '@nestjs/throttler';
import { SessionsService } from '../identity/sessions.service';
import { entityKeySchema, liveReportsQuerySchema, submitReportSchema, submitVoteSchema } from './reports.dto';
import { ReportsService } from './reports.service';

function parse<S extends ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new BadRequestException(parsed.error.issues.map((i) => i.message));
  return parsed.data;
}

@Controller('v1/reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly sessions: SessionsService,
  ) {}

  /**
   * Submit an observation. Needs a reporter session (World ID proof of human).
   * Without one: 401, and nothing is written anywhere.
   */
  @Post()
  @HttpCode(201)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  submit(@Headers('authorization') auth: string | undefined, @Body() body: unknown) {
    const who = this.sessions.authenticate(auth);
    return this.reports.submit(parse(submitReportSchema, body), who);
  }

  /** Confirm or dispute a live report. One vote per human per report; voter must be nearby. */
  @Post(':key/votes')
  @HttpCode(201)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  vote(@Headers('authorization') auth: string | undefined, @Param('key') key: string, @Body() body: unknown) {
    const who = this.sessions.authenticate(auth);
    return this.reports.vote(parse(entityKeySchema, key), parse(submitVoteSchema, body), who);
  }

  /** Free: live reports near a point (the same data anyone can read from Arkiv directly). */
  @Get()
  @Throttle({ default: { ttl: 60_000, limit: 60 } }) // an Arkiv read each; the map polls every 10 s
  live(@Query() query: unknown) {
    const q = parse(liveReportsQuerySchema, query);
    return this.reports.live(q.lat, q.lng, q.radius);
  }
}
