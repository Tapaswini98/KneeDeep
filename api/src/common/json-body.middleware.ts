import { json } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { requestIdOf } from './request-context.middleware';

/**
 * JSON body parsing with a hard size limit. Owned by us (Nest's built-in parser is off) so a
 * too-large or malformed body gets a proper 413/400 in our error shape; with the built-in parser
 * these errors fell through to a misleading 404.
 */
export function jsonBody(limit: string) {
  const parse = json({ limit });
  return (req: Request, res: Response, next: NextFunction) =>
    parse(req, res, (err?: unknown) => {
      if (!err) return next();
      const e = err as { status?: number; type?: string };
      const status = e.status === 413 ? 413 : 400;
      res.status(status).json({
        statusCode: status,
        error: status === 413 ? 'Payload Too Large' : 'Bad Request',
        message: status === 413 ? `Request body exceeds ${limit}` : 'Malformed JSON body',
        requestId: requestIdOf(req),
      });
    });
}
