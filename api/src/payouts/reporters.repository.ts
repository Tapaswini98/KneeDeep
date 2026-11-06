import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';

export interface MyReportRow {
  key: string;
  level: string;
  cell: string;
  source: 'live' | 'simulated';
  reportedAt: string;
  expiresAt: string | null;
  live: boolean;
  arkivTx: string | null;
  confirmations: number;
  disputes: number;
  /** Paid agent answers that used this report. */
  paidAnswers: number;
  /** ...of which it earned in (live and corroborated by another verified human at the time). */
  earningAnswers: number;
  earnedTinybars: string;
}

export interface MyVoteRow {
  key: string;
  vote: 'confirm' | 'dispute';
  votedAt: string;
  reportKey: string;
  reportLevel: string | null;
  reportCell: string | null;
  reportSource: 'live' | 'simulated' | null;
  reportLive: boolean | null;
  /** The report you voted on earned its author something in at least one paid answer. */
  reportEarned: boolean;
}

export interface ActivitySummary {
  reports: number;
  liveReports: number;
  confirmationsReceived: number;
  disputesReceived: number;
  votes: number;
  paidAnswers: number;
  earnedTinybars: string;
}

/**
 * A reporter's own history, from what KneeDeep indexed when it wrote to Arkiv. Expired reports are
 * gone from Arkiv by design; their index rows remain so earnings stay explainable.
 */
@Injectable()
export class ReportersRepository {
  constructor(private readonly db: DbService) {}

  async reports(pseudonym: string, limit = 50): Promise<MyReportRow[]> {
    return this.db.query<MyReportRow>(
      `SELECT ri.entity_key AS key, ri.level, ri.cell, ri.source,
              ri.reported_at AS "reportedAt", ri.expires_at AS "expiresAt",
              COALESCE(ri.expires_at > now(), false) AS live, ri.arkiv_tx AS "arkivTx",
              COALESCE(v.confirmations, 0)::int AS confirmations,
              COALESCE(v.disputes, 0)::int AS disputes,
              COALESCE(u.paid_answers, 0)::int AS "paidAnswers",
              COALESCE(u.earning_answers, 0)::int AS "earningAnswers",
              COALESCE(m.earned, 0)::text AS "earnedTinybars"
       FROM report_index ri
       LEFT JOIN LATERAL (
         SELECT COUNT(*) FILTER (WHERE vote = 'confirm') AS confirmations,
                COUNT(*) FILTER (WHERE vote = 'dispute') AS disputes
         FROM vote_index WHERE report_key = ri.entity_key AND status = 'written'
       ) v ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(DISTINCT qr.query_id) AS paid_answers,
                COUNT(DISTINCT qr.query_id) FILTER (WHERE qr.earns) AS earning_answers
         FROM query_reports qr JOIN queries q ON q.id = qr.query_id AND q.paid_at IS NOT NULL
         WHERE qr.report_key = ri.entity_key
       ) u ON true
       -- A human is credited once per query; if several of their reports earned in it, share the credit.
       LEFT JOIN LATERAL (
         SELECT SUM(e.amount_tinybars / (
                  SELECT COUNT(*) FROM query_reports x
                  WHERE x.query_id = qr.query_id AND x.reporter = qr.reporter AND x.earns)) AS earned
         FROM query_reports qr
         JOIN earnings e ON e.query_id = qr.query_id AND e.reporter = qr.reporter
         WHERE qr.report_key = ri.entity_key AND qr.earns
       ) m ON true
       WHERE ri.reporter = $1 AND ri.status = 'written'
       ORDER BY ri.reported_at DESC LIMIT $2`,
      [pseudonym, limit],
    );
  }

  async votes(pseudonym: string, limit = 50): Promise<MyVoteRow[]> {
    return this.db.query<MyVoteRow>(
      `SELECT v.entity_key AS key, v.vote, v.created_at AS "votedAt", v.report_key AS "reportKey",
              ri.level AS "reportLevel", ri.cell AS "reportCell", ri.source AS "reportSource",
              ri.expires_at > now() AS "reportLive",
              EXISTS (SELECT 1 FROM query_reports qr JOIN earnings e
                        ON e.query_id = qr.query_id AND e.reporter = qr.reporter
                      WHERE qr.report_key = v.report_key AND qr.earns) AS "reportEarned"
       FROM vote_index v LEFT JOIN report_index ri ON ri.entity_key = v.report_key
       WHERE v.voter = $1 AND v.status = 'written'
       ORDER BY v.created_at DESC LIMIT $2`,
      [pseudonym, limit],
    );
  }

  async summary(pseudonym: string): Promise<ActivitySummary> {
    const [row] = await this.db.query<ActivitySummary>(
      `SELECT
         (SELECT COUNT(*) FROM report_index WHERE reporter = $1 AND status = 'written')::int AS reports,
         (SELECT COUNT(*) FROM report_index WHERE reporter = $1 AND status = 'written' AND expires_at > now())::int
           AS "liveReports",
         (SELECT COUNT(*) FROM vote_index v JOIN report_index ri ON ri.entity_key = v.report_key
          WHERE ri.reporter = $1 AND v.status = 'written' AND v.vote = 'confirm')::int AS "confirmationsReceived",
         (SELECT COUNT(*) FROM vote_index v JOIN report_index ri ON ri.entity_key = v.report_key
          WHERE ri.reporter = $1 AND v.status = 'written' AND v.vote = 'dispute')::int AS "disputesReceived",
         (SELECT COUNT(*) FROM vote_index WHERE voter = $1 AND status = 'written')::int AS votes,
         (SELECT COUNT(DISTINCT qr.query_id) FROM query_reports qr JOIN queries q ON q.id = qr.query_id
          WHERE qr.reporter = $1 AND q.paid_at IS NOT NULL)::int AS "paidAnswers",
         (SELECT COALESCE(SUM(amount_tinybars), 0) FROM earnings WHERE reporter = $1)::text AS "earnedTinybars"`,
      [pseudonym],
    );
    return row;
  }
}
