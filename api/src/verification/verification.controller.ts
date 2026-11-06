import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { VerificationService } from './verification.service';

/** GET /v1/verification (free): the latest independent CRE attestation, checked against KneeDeep. */
@Controller('v1/verification')
export class VerificationController {
  constructor(private readonly verification: VerificationService) {}

  @Get()
  async latest() {
    try {
      return await this.verification.latest();
    } catch (err) {
      throw new ServiceUnavailableException(
        `Could not read the attestation contract: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
