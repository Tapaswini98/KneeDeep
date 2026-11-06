import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ArkivModule } from './arkiv/arkiv.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { ConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { HealthController } from './health/health.controller';
import { HederaModule } from './hedera/hedera.module';
import { IdentityModule } from './identity/identity.module';
import { PaymentsModule } from './payments/payments.module';
import { PayoutsModule } from './payouts/payouts.module';
import { ReportsModule } from './reports/reports.module';
import { VerificationModule } from './verification/verification.module';

/** The built web app (npm run build -w web). When present, the API serves it: one origin, one deploy. */
const WEB_DIST = join(__dirname, '..', '..', 'web', 'dist');

function webApp(): DynamicModule[] {
  if (!existsSync(join(WEB_DIST, 'index.html'))) return [];
  return [
    ServeStaticModule.forRoot({
      rootPath: WEB_DIST,
      // Everything else falls back to index.html (client-side routes such as /report).
      exclude: ['/v1', '/v1/{*path}', '/health', '/health/{*path}'],
    }),
  ];
}

@Module({
  imports: [
    ScheduleModule.forRoot(),
    // Per-IP limits; write endpoints set tighter ones with @Throttle.
    ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }] }),
    ConfigModule,
    DbModule,
    ArkivModule,
    HederaModule,
    IdentityModule,
    PaymentsModule,
    PayoutsModule,
    ReportsModule,
    VerificationModule,
    ...webApp(),
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
