import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { requestIdOf } from './request-context.middleware';

/**
 * One error shape for every failure: { statusCode, error, message, requestId }.
 * Expected errors (HttpException) keep their message. Anything else is logged with its stack
 * and returned as a generic 500, so internals (SQL, RPC payloads, keys) never reach clients.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger('Error');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const requestId = requestIdOf(req);
    if (res.headersSent) return;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const payload =
        typeof body === 'string' ? { statusCode: status, message: body } : (body as Record<string, unknown>);
      res.status(status).json({ statusCode: status, ...payload, requestId });
      return;
    }

    const err = exception instanceof Error ? exception : new Error(String(exception));
    this.log.error(`${req.method} ${req.originalUrl} id=${requestId}: ${err.message}`, err.stack);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: 'Something went wrong. Quote the requestId if you report this.',
      requestId,
    });
  }
}
