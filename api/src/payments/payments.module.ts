import { Module } from '@nestjs/common';
import { CatalogController } from '../catalog/catalog.controller';
import { ConditionsController } from '../conditions/conditions.controller';
import { QueriesRepository } from '../queries/queries.repository';
import { PaymentsService } from './payments.service';

@Module({
  providers: [PaymentsService, QueriesRepository],
  controllers: [CatalogController, ConditionsController],
  exports: [PaymentsService, QueriesRepository],
})
export class PaymentsModule {}
