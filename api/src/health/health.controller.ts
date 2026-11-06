import { Controller, Get } from '@nestjs/common';
import { ArkivService } from '../arkiv/arkiv.service';
import { DbService } from '../db/db.service';
import { HederaService } from '../hedera/hedera.service';

type Check = { ok: true; detail?: string } | { ok: false; error: string };

async function check(fn: () => Promise<string | undefined>): Promise<Check> {
  try {
    return { ok: true, detail: await fn() };
  } catch (err) {
    // pg's connection-refused is an AggregateError with an empty message; fall back to its code.
    const e = err as Error & { code?: string };
    return { ok: false, error: e?.message || e?.code || e?.name || String(err) };
  }
}

/** One glance tells you which integration is down. Free endpoint; never behind x402. */
@Controller('health')
export class HealthController {
  constructor(
    private readonly db: DbService,
    private readonly arkiv: ArkivService,
    private readonly hedera: HederaService,
  ) {}

  @Get()
  async health() {
    const [postgres, arkiv, hedera] = await Promise.all([
      check(async () => {
        await this.db.query('SELECT 1');
        return undefined;
      }),
      check(async () => {
        const block = await this.arkiv.blockNumber();
        if (!this.arkiv.writerAddress) throw new Error(`block ${block}, but ARKIV_PRIVATE_KEY is not set (read-only)`);
        return `block ${block}, writer ${this.arkiv.writerAddress}`;
      }),
      check(async () => {
        if (!this.hedera.configured) throw new Error('HEDERA_ACCOUNT_ID / HEDERA_PRIVATE_KEY not set');
        return `${this.hedera.accountId} on ${this.hedera.network}`;
      }),
    ]);
    return { ok: postgres.ok && arkiv.ok && hedera.ok, postgres, arkiv, hedera };
  }
}
