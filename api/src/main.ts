import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { jsonBody } from './common/json-body.middleware';
import { REQUEST_ID_HEADER, requestContext } from './common/request-context.middleware';
import { APP_CONFIG, type AppConfig, isDeployed, readConfig } from './config/config';
import { runMigrations } from './db/migrations';
import { QUERY_ID_HEADER } from './payments/paywall';
import { PaymentsService } from './payments/payments.service';

const DEV_ORIGINS = [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/];

async function bootstrap() {
  // Validate configuration before Nest starts, so a bad or unsafe config fails with a plain list of
  // problems instead of a dependency-injection stack trace.
  readConfig();
  // bodyParser off: jsonBody() below parses with a size limit and proper 413/400 errors.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });
  const config = app.get<AppConfig>(APP_CONFIG);
  const log = new Logger('Bootstrap');

  if (config.MIGRATE_ON_BOOT) {
    const applied = await runMigrations(config.DATABASE_URL);
    log.log(applied.length ? `Applied migrations: ${applied.join(', ')}` : 'Database is up to date');
  }

  app.set('trust proxy', config.TRUST_PROXY);
  app.disable('x-powered-by');
  // Security headers. CSP is off for now: the bundled web app loads OpenStreetMap tiles and the
  // World ID widget talks to World's bridge; a tested CSP for both is a follow-up.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(requestContext);
  // IDKit proofs are a few KB; nothing legitimate is larger.
  app.use(jsonBody('64kb'));
  app.enableCors({
    origin: config.CORS_ORIGINS.length ? config.CORS_ORIGINS : isDeployed(config) ? false : DEV_ORIGINS,
    exposedHeaders: ['PAYMENT-REQUIRED', 'PAYMENT-RESPONSE', QUERY_ID_HEADER, REQUEST_ID_HEADER],
  });
  app.enableShutdownHooks();
  // x402 runs as plain Express middleware ahead of Nest's router: it matches the
  // paid route itself (GET /v1/conditions) and passes everything else through.
  app.use(app.get(PaymentsService).middleware());

  await app.listen(config.PORT);
  log.log(`KneeDeep API on http://localhost:${config.PORT} (${config.APP_ENV}; health: /health)`);
}

bootstrap().catch((err) => {
  // Config problems are the common case here; print them plainly and exit non-zero.
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
