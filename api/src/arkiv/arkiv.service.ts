import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/config';
import { arkivPublicClient, arkivWalletClient, ArkivPublicClient, ArkivWalletClient } from './client';

/**
 * Arkiv is the source of truth for live reports and votes. Reads use the public
 * client (anyone could run the same queries); writes need the backend's wallet.
 */
@Injectable()
export class ArkivService {
  readonly reader: ArkivPublicClient;
  private readonly writer?: ArkivWalletClient;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.reader = arkivPublicClient(config.ARKIV_ACCESS_KEY);
    if (config.ARKIV_PRIVATE_KEY) {
      this.writer = arkivWalletClient(config.ARKIV_ACCESS_KEY, config.ARKIV_PRIVATE_KEY);
    }
  }

  /** Address that owns every KneeDeep entity. Queries filter on it so nobody else can inject reports. */
  get writerAddress(): `0x${string}` | undefined {
    return this.writer?.account.address;
  }

  get wallet(): ArkivWalletClient {
    if (!this.writer) throw new ServiceUnavailableException('Arkiv writes disabled: ARKIV_PRIVATE_KEY is not set');
    return this.writer;
  }

  async blockNumber(): Promise<bigint> {
    return this.reader.getBlockNumber();
  }

  /** Current block and seconds per block: turns an entity's expiry block into a time. */
  async blockTiming(): Promise<{ currentBlock: bigint; blockSeconds: number }> {
    const t = await this.reader.getBlockTiming();
    return { currentBlock: t.currentBlock, blockSeconds: t.blockDuration };
  }
}
