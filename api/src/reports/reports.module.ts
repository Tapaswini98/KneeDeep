import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsRepository } from './reports.repository';
import { ReportsService } from './reports.service';

@Module({
  providers: [ReportsService, ReportsRepository],
  controllers: [ReportsController],
})
export class ReportsModule {}
