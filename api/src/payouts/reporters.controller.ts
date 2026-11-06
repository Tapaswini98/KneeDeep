import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  Put,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { APP_CONFIG, AppConfig } from '../config/config';
import { hashscanAccountUrl, hashscanTxUrl } from '../hedera/keys';
import { fetchAccount } from '../hedera/mirror';
import { SessionsService } from '../identity/sessions.service';
import { HEDERA_ACCOUNT_ID } from './payout-plan';
import { PayoutsRepository } from './payouts.repository';

const payoutAccountSchema = z.object({
  accountId: z
    .string()
    .trim()
    .regex(HEDERA_ACCOUNT_ID, 'accountId must be a Hedera account id like 0.0.1234567')
    .nullable(),
});

/** A reporter's own earnings and where they are paid. Session-authenticated; pseudonymous. */
@Controller('v1/reporters/me')
export class ReportersController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly sessions: SessionsService,
    private readonly payouts: PayoutsRepository,
  ) {}

  @Get()
  async me(@Headers('authorization') auth: string | undefined) {
    const who = this.sessions.authenticate(auth);
    const e = await this.payouts.reporterEarnings(who.pseudonym);
    const net = this.config.HEDERA_NETWORK;
    return {
      reporter: who.pseudonym.slice(0, 12),
      earns: who.method === 'world',
      rule:
        `${this.config.REPORTER_SHARE_PERCENT}% of every paid query is split between the verified humans whose ` +
        'reports it used, if another verified human corroborated them. Simulated data never earns.',
      payoutAccount: e.payoutAccount,
      payoutAccountUrl: e.payoutAccount ? hashscanAccountUrl(net, e.payoutAccount) : null,
      queriesCredited: e.queriesCredited,
      owedTinybars: e.owedTinybars,
      inFlightTinybars: e.inFlightTinybars,
      paidTinybars: e.paidTinybars,
      payouts: e.payouts.map((p) => ({
        ...p,
        hashscan: p.txId ? hashscanTxUrl(p.network ?? net, p.txId) : null,
      })),
    };
  }

  /**
   * Where to send this reporter's earnings. Checked against the mirror node: the account must
   * exist and accept transfers without its own signature, or it would fail every batch it is in.
   */
  @Put('payout-account')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async setPayoutAccount(@Headers('authorization') auth: string | undefined, @Body() body: unknown) {
    const who = this.sessions.authenticate(auth);
    if (who.method !== 'world') {
      throw new ForbiddenException('Simulated identities never earn; verify with World ID to get paid');
    }
    const parsed = payoutAccountSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map((i) => i.message));
    const { accountId } = parsed.data;

    if (accountId) {
      if (accountId === this.config.HEDERA_ACCOUNT_ID) {
        throw new BadRequestException('That is the KneeDeep platform account; use your own account');
      }
      const account = await fetchAccount(this.config.HEDERA_MIRROR_NODE_URL, accountId).catch(
        (err: Error) => {
          if (err.message.includes('not found')) {
            throw new BadRequestException(
              `Account ${accountId} does not exist on ${this.config.HEDERA_NETWORK}`,
            );
          }
          throw new BadGatewayException(
            `Could not check the account on the Hedera mirror node: ${err.message}`,
          );
        },
      );
      if (account.deleted) throw new BadRequestException(`Account ${accountId} is deleted`);
      if (account.receiver_sig_required) {
        throw new BadRequestException(
          `Account ${accountId} requires its own signature to receive HBAR, so batched payouts cannot reach it`,
        );
      }
    }

    await this.payouts.setPayoutAccount(who.pseudonym, accountId);
    return this.me(auth);
  }
}
