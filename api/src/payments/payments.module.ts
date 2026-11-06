import { Module } from '@nestjs/common';
import { ActivityController } from '../activity/activity.controller';
import { CatalogController } from '../catalog/catalog.controller';
import { ConditionsController } from '../conditions/conditions.controller';
import { ConditionsService } from '../conditions/conditions.service';
import { QueriesRepository } from '../queries/queries.repository';
import { PaymentsService } from './payments.service';

@Module({
  providers: [PaymentsService, QueriesRepository, ConditionsService],
  controllers: [CatalogController, ConditionsController, ActivityController],
  exports: [PaymentsService, QueriesRepository],
})
export class PaymentsModule {}
