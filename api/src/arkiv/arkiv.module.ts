import { Global, Module } from '@nestjs/common';
import { ArkivService } from './arkiv.service';
import { ArkivStore } from './arkiv.store';

@Global()
@Module({ providers: [ArkivService, ArkivStore], exports: [ArkivService, ArkivStore] })
export class ArkivModule {}
