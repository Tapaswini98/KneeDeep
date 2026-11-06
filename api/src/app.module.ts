import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ArkivModule } from './arkiv/arkiv.module';
import { ConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { HealthController } from './health/health.controller';
import { HederaModule } from './hedera/hedera.module';
import { IdentityModule } from './identity/identity.module';
import { PaymentsModule } from './payments/payments.module';
import { ReportsModule } from './reports/reports.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigModule,
    DbModule,
    ArkivModule,
    HederaModule,
    IdentityModule,
    PaymentsModule,
    ReportsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
