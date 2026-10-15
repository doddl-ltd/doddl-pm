-- Migration: 14-amazon-asin-daily
-- Description: Day-grain ASIN sales/traffic tables + fetch-status tracking
--              for the Amazon SP-API Sales & Traffic Report connector
--              (rev 3, corrected rev 4, columns extended rev 5, same day).
--
-- One row per (marketplace, ASIN, day) in amazon_asin_daily. Day-level grain
-- is CONFIRMED mandatory (live run 2026-08-17, not just believed — see the
-- comment block above _fetch_sales_traffic_day in
-- connectors/scheduler/jobs/amazon_sp_api.py for the exact evidence: a real
-- 3-day UK request came back with 33 salesAndTrafficByAsin entries, 33
-- distinct ASINs, zero entries carrying any date field — one blended total
-- per ASIN, not one entry per ASIN per day). GET_SALES_AND_TRAFFIC_REPORT's
-- ASIN breakdown is aggregated across whatever dataStartTime/dataEndTime
-- range is requested, so only dataStartTime == dataEndTime gives one real
-- day's figures per ASIN. See reports/amazon-reports-api.md.
--
-- asinGranularity is CHILD, not SKU — no sku column here on purpose (still
-- true after the rev 5 column additions below). An always-null column
-- invites someone to populate it later and reintroduce a primary-key
-- collision on (marketplace_id, asin, report_date).
--
-- Columns extended 2026-08-17 (rev 5), before this migration was ever
-- applied, specifically to avoid re-pulling history at 1/60s later: the field
-- names were confirmed against a real response the same day (see the comment
-- block referenced above), which showed roughly twice as many available
-- fields as were originally captured. Added: total_order_items,
-- units_shipped, orders_shipped, shipped_product_sales, units_refunded,
-- refund_rate, browser_page_views, mobile_app_page_views, and a full set of
-- B2B counterparts. Deliberately NOT added: the "...Percentage"
-- share-of-marketplace-total fields (browserSessionPercentage,
-- pageViewsPercentage, etc., and their B2B counterparts) — derivable from the
-- absolute figures already stored here, per Jon 2026-08-17.
--
-- amazon_asin_daily_status tracks which (marketplace, day) pairs have been
-- successfully pulled ('ok'), returned nothing usable ('gap'), or failed to
-- parse against our field-name assumptions ('parse_failed') — with a reason
-- and an attempts counter, so run_sales_traffic_backfill can resume after
-- being killed and restarted without re-fetching completed days, gaps are
-- visible rather than indistinguishable from a genuine zero-sales day, and a
-- permanently-broken day stops being retried forever instead of hammering
-- Amazon at 1/60s indefinitely.
--
-- APPLIED to production (ikcjciscttsvpxoijnqe) as of 2026-08-17, with
-- unit_session_pct/unit_session_pct_b2b/refund_rate/buy_box_pct/buy_box_pct_b2b
-- at their ORIGINAL narrower precision (numeric(6,3) / numeric(5,2)).
--
-- Widened to numeric(10,3) on all five the same day, confirmed necessary by a
-- live crash, not a guess: a real run_sales_traffic_backfill run hit a 400 from
-- PostgREST on 2026-06-18 (UK) — ASIN B0779CZ9FD's unitSessionPercentageB2B
-- came back as exactly 1000, one digit past what numeric(6,3) can hold
-- (max 999.999). B2B ratios are especially exposed to this: sessions_b2b is
-- often tiny (1-2), so a handful of B2B units against 1 B2B session blows past
-- 100% by a large multiple, not just slightly over — the numeric(6,3) rev-4
-- fix anticipated ">100%" but not ">1000%". numeric(10,3) chosen for real
-- headroom rather than re-fitting this one observed value; Postgres numeric
-- storage is variable-length so a wider declared precision costs nothing.
--
-- The CREATE TABLE below reflects the final (10,3) target directly — a fresh
-- database applying this file gets the correct schema in one step. The
-- already-existing production table needs the separate ALTER TABLE that was
-- actually run to bring it in line (not embedded here, since this file's own
-- create table already has the fix baked in and CREATE TABLE IF NOT EXISTS
-- would otherwise silently no-op on the live table without ever widening it):
--
--   alter table amazon_asin_daily
--     alter column unit_session_pct     type numeric(10,3),
--     alter column unit_session_pct_b2b type numeric(10,3),
--     alter column refund_rate          type numeric(10,3),
--     alter column buy_box_pct          type numeric(10,3),
--     alter column buy_box_pct_b2b      type numeric(10,3);
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists amazon_asin_daily (
  marketplace_id           text          not null,
  asin                      text          not null,
  report_date               date          not null,

  units_ordered             integer,
  ordered_revenue           numeric(14,2),
  currency                  text,
  total_order_items         integer,
  units_shipped             integer,
  orders_shipped            integer,
  shipped_product_sales     numeric(14,2),
  units_refunded            integer,
  refund_rate               numeric(10,3),   -- share of units refunded; widened 2026-08-17, see header comment

  sessions                  integer,
  page_views                integer,
  browser_sessions          integer,
  mobile_app_sessions       integer,
  browser_page_views        integer,
  mobile_app_page_views     integer,
  buy_box_pct               numeric(10,3),
  unit_session_pct          numeric(10,3),   -- confirmed live 2026-08-17: B2B counterpart hit exactly 1000, see header comment

  -- B2B counterparts — same metrics, Amazon Business orders only
  units_ordered_b2b         integer,
  ordered_revenue_b2b       numeric(14,2),
  total_order_items_b2b     integer,
  sessions_b2b               integer,
  browser_sessions_b2b      integer,
  mobile_app_sessions_b2b   integer,
  page_views_b2b            integer,
  buy_box_pct_b2b           numeric(10,3),
  unit_session_pct_b2b      numeric(10,3),   -- the column that actually overflowed live — see header comment

  fetched_at                timestamptz   not null default now(),
  primary key (marketplace_id, asin, report_date)
);

create index if not exists amazon_asin_daily_report_date
  on amazon_asin_daily (report_date);

create table if not exists amazon_asin_daily_status (
  marketplace_id text        not null,
  report_date    date        not null,
  status         text        not null,
  reason         text,       -- 'gap': 'http_400' | 'rate_limited_exhausted' | 'pre_retention' (reinstated as a
                              -- skip reason 2026-08-25 — _SALES_TRAFFIC_RETENTION_DAYS is now CONFIRMED
                              -- (exact 730/731-day boundary, 151 cases, zero exceptions across 3
                              -- marketplaces), so a date past it is skipped before calling Amazon;
                              -- count_toward_attempts=False, not a failure. See run comment above
                              -- _fetch_sales_traffic_day)
                              -- 'parse_failed': 'missing_salesAndTrafficByAsin_key' |
                              --   'salesAndTrafficByAsin_not_list' | 'zero_rows_extracted_all_missing_child_asin' |
                              --   'upsert_failed' (added 2026-08-19 — the write to amazon_asin_daily itself
                              --   failed, e.g. a numeric overflow; see _fetch_sales_traffic_day)
  attempts       integer     not null default 0,   -- resume stops retrying once this hits _MAX_ATTEMPTS (3).
                              -- Fixed 2026-08-19: reason='rate_limited_exhausted' does NOT increment this
                              -- (a 429 is transient, measured 33-42% on createReport — see
                              -- reports/amazon-reports-api.md — so it must stay retryable indefinitely,
                              -- not accumulate toward permanent abandonment). Only reason='http_400' and
                              -- all 'parse_failed' reasons count toward the cap.
  updated_at     timestamptz not null default now(),
  primary key (marketplace_id, report_date),
  constraint amazon_asin_daily_status_status_check check (status in ('ok', 'gap', 'parse_failed'))
);

-- RLS: only the connector service role (bypasses RLS) may write.
-- Authenticated users can read for monitoring/dashboards.
alter table amazon_asin_daily enable row level security;
alter table amazon_asin_daily_status enable row level security;

create policy "authenticated read amazon_asin_daily"
  on amazon_asin_daily for select
  using (auth.role() = 'authenticated');

create policy "authenticated read amazon_asin_daily_status"
  on amazon_asin_daily_status for select
  using (auth.role() = 'authenticated');

-- ── Register ──────────────────────────────────────────────────────────────────

insert into schema_migrations (id, description)
values (
  '14-amazon-asin-daily',
  'Day-grain ASIN sales/traffic tables (full field set incl. B2B) + fetch-status tracking for the Amazon SP-API Sales & Traffic Report connector'
)
on conflict (id) do nothing;
