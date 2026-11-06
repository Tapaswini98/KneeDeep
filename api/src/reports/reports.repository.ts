import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { Level, Source, Vote } from '../arkiv/schemas';

export type Reservation = { ok: true; id: string } | { ok: false; nextAllowedAt: Date };

@Injectable()
export class ReportsRepository {
  constructor(private readonly db: DbService) {}

  async upsertReporter(pseudonym: string): Promise<void> {
    await this.db.query('INSERT INTO reporters (pseudonym) VALUES ($1) ON CONFLICT DO NOTHING', [pseudonym]);
  }

  /**
   * Reserve the right to write one report: at most one per human per cell per window.
   * An advisory lock on (reporter, cell) makes the check-then-insert atomic.
   */
  async reserveReport(r: {
    reporter: string;
    cell: string;
    level: Level;
    source: Source;
    reportedAt: Date;
    windowMinutes: number;
  }): Promise<Reservation> {
    return this.db.tx(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`report:${r.reporter}:${r.cell}`]);
      const recent = await c.query<{ reported_at: Date }>(
        `SELECT reported_at FROM report_index
         WHERE reporter = $1 AND cell = $2 AND status <> 'failed'
           AND reported_at > $3::timestamptz - make_interval(mins => $4)
         ORDER BY reported_at DESC LIMIT 1`,
        [r.reporter, r.cell, r.reportedAt, r.windowMinutes],
      );
      if (recent.rows[0]) {
        const next = new Date(recent.rows[0].reported_at.getTime() + r.windowMinutes * 60_000);
        return { ok: false, nextAllowedAt: next };
      }
      const ins = await c.query<{ id: string }>(
        `INSERT INTO report_index (reporter, cell, level, source, reported_at, status)
         VALUES ($1, $2, $3, $4, $5, 'pending') RETURNING id`,
        [r.reporter, r.cell, r.level, r.source, r.reportedAt],
      );
      return { ok: true, id: ins.rows[0].id };
    });
  }

  async completeReport(id: string, entityKey: string, txHash: string, expiresAt: Date): Promise<void> {
    await this.db.query(
      `UPDATE report_index SET entity_key = $2, arkiv_tx = $3, expires_at = $4, status = 'written' WHERE id = $1`,
      [id, entityKey, txHash, expiresAt],
    );
  }

  async failReport(id: string): Promise<void> {
    await this.db.query(`UPDATE report_index SET status = 'failed' WHERE id = $1`, [id]);
  }

  /** One vote per human per report. Returns null if this human already voted on it. */
  async reserveVote(v: { reportKey: string; voter: string; vote: Vote }): Promise<string | null> {
    const rows = await this.db.query<{ id: string }>(
      `INSERT INTO vote_index (report_key, voter, vote, status) VALUES ($1, $2, $3, 'pending')
       ON CONFLICT (report_key, voter) WHERE status <> 'failed' DO NOTHING RETURNING id`,
      [v.reportKey, v.voter, v.vote],
    );
    return rows[0]?.id ?? null;
  }

  async completeVote(id: string, entityKey: string): Promise<void> {
    await this.db.query(`UPDATE vote_index SET entity_key = $2, status = 'written' WHERE id = $1`, [
      id,
      entityKey,
    ]);
  }

  async failVote(id: string): Promise<void> {
    await this.db.query(`UPDATE vote_index SET status = 'failed' WHERE id = $1`, [id]);
  }

  /** Arkiv transaction hashes for reports we wrote (seeded or older entities may have none). */
  async arkivTxFor(keys: string[]): Promise<Map<string, string>> {
    if (keys.length === 0) return new Map();
    const rows = await this.db.query<{ entity_key: string; arkiv_tx: string }>(
      'SELECT entity_key, arkiv_tx FROM report_index WHERE entity_key = ANY($1) AND arkiv_tx IS NOT NULL',
      [keys],
    );
    return new Map(rows.map((r) => [r.entity_key, r.arkiv_tx]));
  }

  /**
   * Votes we wrote on these reports. Arkiv's query index can trail a fresh write by a block or two;
   * merging these in means a voter sees their own vote the moment it is accepted.
   */
  async votesOn(reportKeys: string[]): Promise<{ report: string; voter: string; vote: Vote }[]> {
    if (reportKeys.length === 0) return [];
    return this.db.query<{ report: string; voter: string; vote: Vote }>(
      `SELECT report_key AS report, voter, vote FROM vote_index
       WHERE report_key = ANY($1) AND status = 'written'`,
      [reportKeys],
    );
  }
}
