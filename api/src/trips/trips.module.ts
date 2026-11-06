import { Module } from '@nestjs/common';
import { TripsController } from './trips.controller';
import { TripsRepository } from './trips.repository';

@Module({
  providers: [TripsRepository],
  controllers: [TripsController],
})
export class TripsModule {}
