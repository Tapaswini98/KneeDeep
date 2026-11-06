import { Inject, Injectable, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { AccountId, Client, PrivateKey } from '@hiero-ledger/sdk';
import { APP_CONFIG, AppConfig } from '../config/config';
import { parsePrivateKey } from './keys';
import { fetchBalanceTinybars } from './mirror';

/**
 * The platform's Hedera account: receives x402 payments for paid queries and
 * sends batched payouts to reporters. Its key exists only in the API process.
 */
@Injectable()
export class HederaService implements OnModuleDestroy {
  readonly network: string;
  readonly accountId?: string;
  private readonly key?: PrivateKey;
  private client?: Client;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.network = config.HEDERA_NETWORK;
    this.accountId = config.HEDERA_ACCOUNT_ID;
    if (config.HEDERA_PRIVATE_KEY) this.key = parsePrivateKey(config.HEDERA_PRIVATE_KEY, config.HEDERA_KEY_TYPE);
  }

  get configured(): boolean {
    return Boolean(this.accountId && this.key);
  }

  /** SDK client with the platform account as operator, created on first use. */
  get sdk(): Client {
    if (!this.accountId || !this.key) {
      throw new ServiceUnavailableException('Hedera not configured: set HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY');
    }
    if (!this.client) {
      const base = this.network === 'hedera:mainnet' ? Client.forMainnet() : Client.forTestnet();
      this.client = base.setOperator(AccountId.fromString(this.accountId), this.key);
    }
    return this.client;
  }

  async balanceTinybars(accountId = this.accountId): Promise<bigint> {
    if (!accountId) throw new ServiceUnavailableException('Hedera not configured: set HEDERA_ACCOUNT_ID');
    return fetchBalanceTinybars(this.config.HEDERA_MIRROR_NODE_URL, accountId);
  }

  onModuleDestroy() {
    this.client?.close();
  }
}
