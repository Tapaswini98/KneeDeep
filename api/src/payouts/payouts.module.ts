import { Module } from '@nestjs/common';
import { PayoutsRepository } from './payouts.repository';
import { PayoutsScheduler } from './payouts.scheduler';
import { PayoutsService } from './payouts.service';
import { ReportersController } from './reporters.controller';

@Module({
  providers: [PayoutsRepository, PayoutsService, PayoutsScheduler],
  controllers: [ReportersController],
  exports: [PayoutsRepository, PayoutsService],
})
export class PayoutsModule {}
