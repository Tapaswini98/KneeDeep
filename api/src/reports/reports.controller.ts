import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import type { z, ZodTypeAny } from 'zod';
import { entityKeySchema, liveReportsQuerySchema, submitReportSchema, submitVoteSchema } from './reports.dto';
import { ReportsService } from './reports.service';

function parse<S extends ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new BadRequestException(parsed.error.issues.map((i) => i.message));
  return parsed.data;
}

@Controller('v1/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** Submit an observation. Requires proof of human; written to Arkiv with an expiry. */
  @Post()
  @HttpCode(201)
  submit(@Body() body: unknown) {
    return this.reports.submit(parse(submitReportSchema, body));
  }

  /** Confirm or dispute a live report. One vote per human per report; voter must be nearby. */
  @Post(':key/votes')
  @HttpCode(201)
  vote(@Param('key') key: string, @Body() body: unknown) {
    return this.reports.vote(parse(entityKeySchema, key), parse(submitVoteSchema, body));
  }

  /** Free: live reports near a point (the same data anyone can read from Arkiv directly). */
  @Get()
  live(@Query() query: unknown) {
    const q = parse(liveReportsQuerySchema, query);
    return this.reports.live(q.lat, q.lng, q.radius);
  }
}
