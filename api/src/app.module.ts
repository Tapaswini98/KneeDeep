import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ArkivModule } from './arkiv/arkiv.module';
import { ConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { HealthController } from './health/health.controller';
import { HederaModule } from './hedera/hedera.module';

@Module({
  imports: [ScheduleModule.forRoot(), ConfigModule, DbModule, ArkivModule, HederaModule],
  controllers: [HealthController],
})
export class AppModule {}
