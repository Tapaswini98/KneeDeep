import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ArkivModule } from './arkiv/arkiv.module';
import { ConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { HealthController } from './health/health.controller';
import { HederaModule } from './hedera/hedera.module';
import { PaymentsModule } from './payments/payments.module';

@Module({
  imports: [ScheduleModule.forRoot(), ConfigModule, DbModule, ArkivModule, HederaModule, PaymentsModule],
  controllers: [HealthController],
})
export class AppModule {}
