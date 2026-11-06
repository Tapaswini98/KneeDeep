import { Module } from '@nestjs/common';
import { PayoutsRepository } from './payouts.repository';
import { PayoutsScheduler } from './payouts.scheduler';
import { PayoutsService } from './payouts.service';
import { ReportersController } from './reporters.controller';
import { ReportersRepository } from './reporters.repository';

@Module({
  providers: [PayoutsRepository, PayoutsService, PayoutsScheduler, ReportersRepository],
  controllers: [ReportersController],
  exports: [PayoutsRepository, PayoutsService],
})
export class PayoutsModule {}
