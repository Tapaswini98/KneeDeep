import { Module } from '@nestjs/common';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';

@Module({ providers: [VerificationService], controllers: [VerificationController] })
export class VerificationModule {}
