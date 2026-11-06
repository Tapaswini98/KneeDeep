import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

const log = new Logger('HTTP');
const QUIET = /^\/(health|assets\/|favicon)/;

/**
 * Gives every request an id (kept from the caller if it sent a sane one), echoes it in the
 * response, and logs one line per request when it finishes. Error bodies carry the same id,
 * so a user's screenshot can be matched to a log line.
 */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header(REQUEST_ID_HEADER);
  const id = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  (req as Request & { id: string }).id = id;
  res.setHeader(REQUEST_ID_HEADER, id);

  const started = process.hrtime.bigint();
  res.on('finish', () => {
    if (QUIET.test(req.path) && res.statusCode < 400) return;
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const line = `${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${ms.toFixed(0)}ms id=${id}`;
    if (res.statusCode >= 500) log.error(line);
    else if (res.statusCode >= 400) log.warn(line);
    else log.log(line);
  });
  next();
}

export function requestIdOf(req: Request): string | undefined {
  return (req as Request & { id?: string }).id;
}
