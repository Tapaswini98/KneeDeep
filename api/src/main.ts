import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { APP_CONFIG, AppConfig } from './config/config';
import { QUERY_ID_HEADER } from './payments/paywall';
import { PaymentsService } from './payments/payments.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // The reporter page and the map are served by Vite in dev and may be hosted elsewhere in prod.
  app.enableCors({ exposedHeaders: ['PAYMENT-REQUIRED', 'PAYMENT-RESPONSE', QUERY_ID_HEADER] });
  app.enableShutdownHooks();
  // x402 runs as plain Express middleware ahead of Nest's router: it matches the
  // paid route itself (GET /v1/conditions) and passes everything else through.
  app.use(app.get(PaymentsService).middleware());

  const config = app.get<AppConfig>(APP_CONFIG);
  await app.listen(config.PORT);
  Logger.log(`KneeDeep API on http://localhost:${config.PORT} (health: /health)`, 'Bootstrap');
}

void bootstrap();
