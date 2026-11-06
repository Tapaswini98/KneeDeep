import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { APP_CONFIG, AppConfig } from './config/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // The reporter page and the map are served by Vite in dev and may be hosted elsewhere in prod.
  app.enableCors({ exposedHeaders: ['PAYMENT-REQUIRED', 'PAYMENT-RESPONSE'] });
  app.enableShutdownHooks();

  const config = app.get<AppConfig>(APP_CONFIG);
  await app.listen(config.PORT);
  Logger.log(`KneeDeep API on http://localhost:${config.PORT} (health: /health)`, 'Bootstrap');
}

void bootstrap();
