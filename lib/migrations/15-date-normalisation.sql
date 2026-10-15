-- Migration: 15-date-normalisation
-- Description: Canonical Europe/London date normalisation for api_clean (Tier A
--              sources), an explicit source-local flag for the sources that
--              cannot be honestly converted (Tier B), a shared date dimension,
--              and an FX rate table for cross-marketplace totals.
--
-- Full profiling behind this migration: reports/date-normalisation-profile-and-plan-2026-08-24.md
-- Decisions recorded there (Jon, 2026-08-24):
--   - Shopify business date = created_at, not processed_at (processed_at drifts
--     by months/years on historically-imported orders; created_at is what every
--     report means by "order date"). processed_at kept as a plain second
--     column (secondary_ts) for anyone who needs payment timing.
--   - date_dim is a plain Jan-Dec calendar year — no fiscal columns.
--   - fx_rates is date-range rows (valid_from/valid_to), not one row per day.
--   - amazon_asin_daily.report_date is UNTOUCHED — it already has its own
--     clearly-named, marketplace-local column and doesn't live in api_clean.
--     Nothing in this migration renames or reinterprets it.
--   - GA4 property timezone CONFIRMED 2026-08-24 (Jon, from GA4 Admin >
--     Property Settings): property 383475128, "(GMT+01:00) United Kingdom
--     Time" — i.e. Europe/London. GA4's `date` dimension is therefore already
--     a genuine UK calendar date, not a foreign-timezone bucket to flag —
--     date_is_uk_local = true for google_analytics below. No conversion is
--     needed or possible (GA4 gives no underlying timestamp, only the daily
--     bucket) — this is a parse, not a timezone conversion, which is why
--     business_ts stays null for GA4 even though date_is_uk_local is true.
--
-- Tiering (see the report for the full per-source evidence):
--   Tier A — real UTC/offset timestamps, safely converted to Europe/London:
--     amazon_sp/order, shopify/order+product, meta_ads/campaign+adset,
--     klaviyo/campaign+flow.
--   Tier A-by-confirmation — no underlying timestamp exists, only a
--     pre-bucketed calendar-day string, but the bucket itself is confirmed
--     already Europe/London so it's taken as-is, not converted:
--     google_analytics/traffic+page (see above).
--   Tier B — a pre-bucketed calendar-day string in a SOURCE-local timezone
--     that is NOT ours, not ours to convert: google_search_console (confirmed
--     Pacific Time via Google's own docs, permanently unfixable — this is now
--     the only source in this tier), meta_ads/adset_insight (ad account
--     timezone not yet confirmed; also currently 30-day aggregate windows,
--     not daily grain — see below).
--   Unmapped (amazon_sp/order_item [zero rows today], amazon_sp/listing
--     [point-in-time state, no business date], and any future
--     source/record_type not listed in date_source_config): business_ts and
--     business_date stay null, business_date_grain = 'none'. Deliberately not
--     an error — a forgotten mapping should not break a connector's upsert.
--
-- The date_is_uk_local flag is DATA (date_source_config), not baked into the
-- trigger function — this is exactly why the GA4 confirmation above needed
-- nothing but a changed seed value in section 2, no trigger logic change, no
-- new migration. Same mechanism stands ready for Meta's ad account timezone
-- once Jon confirms it.
--
-- Safe-apply notes:
--   - Idempotent — ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, ON CONFLICT
--     DO NOTHING throughout.
--   - backup_before_migration('15-date-normalisation') is invoked by
--     scripts/safe-apply-migration.js itself before this file runs (Hard Rule
--     11) — not repeated here, matching migrations 08/14's convention. This
--     migration doesn't touch projects/tasks anyway.
--   - Does not touch amazon_asin_daily, projects, tasks, or task_groups.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 0. Extensions ──────────────────────────────────────────────────────────

create extension if not exists "btree_gist" with schema extensions;

-- ── 1. api_clean — new columns ───────────────────────────────────────────────

alter table api_clean
  add column if not exists business_ts          timestamptz,
  add column if not exists business_date        date,
  add column if not exists date_is_uk_local      boolean not null default false,
  add column if not exists business_date_grain  text     not null default 'none',
  add column if not exists secondary_ts          timestamptz;

comment on column api_clean.business_ts is
  'The record''s underlying instant, cast from its source timestamp field. Null whenever the source only provides a pre-bucketed day string with no underlying timestamp to convert (google_analytics, google_search_console, meta_ads/adset_insight) or no date concept applies — see date_is_uk_local for whether that day string is UK-local anyway.';
comment on column api_clean.business_date is
  'Derived business day. Europe/London calendar date when date_is_uk_local is true; otherwise the source''s own bucketed date, taken as-is (see date_is_uk_local).';
comment on column api_clean.date_is_uk_local is
  'false = business_date is source-local (not our UTC to convert — e.g. GSC is Pacific Time, confirmed via Google''s docs) or the row has no date at all. Driven by date_source_config, not hardcoded here, so it can be corrected per source without a migration once a property/account timezone is confirmed. NEVER assume true without checking this column.';
comment on column api_clean.business_date_grain is
  'day = business_date is one real calendar day. range = business_date is only the start of a multi-day aggregate window (e.g. Meta adset_insight before the time_increment=1 fix) — do not join this to date_dim as if it were a single day. none = no business date applies to this record_type.';
comment on column api_clean.secondary_ts is
  'A second source timestamp some record types carry that is not the canonical business_ts. Currently only populated for shopify/order (processed_at) per Jon''s 2026-08-24 decision to keep it available without making it the canonical date.';

alter table api_clean drop constraint if exists api_clean_business_date_grain_check;
alter table api_clean add constraint api_clean_business_date_grain_check
  check (business_date_grain in ('day', 'range', 'none'));

-- Day-grain rows are the only ones meaningful to join against date_dim —
-- partial index keeps 'range'/'none' rows out of that query plan entirely.
create index if not exists api_clean_business_date
  on api_clean (source, record_type, business_date)
  where business_date_grain = 'day';

-- ── 2. date_source_config — the one thing meant to change after this migration ──
-- Maps (source, record_type) -> whether business_date is genuinely Europe/London
-- local. Read by the trigger below on every upsert, so flipping a row here
-- takes effect on the next connector run with no code or schema change.
-- Deliberately NOT the JSONB-key-to-extract mapping (that's structural and
-- lives in the trigger function's CASE, matching how this codebase already
-- prefers explicit dispatch over dynamic config for a small fixed set of
-- sources — see ACCOUNTS/ACTIVE_MARKETPLACES in amazon_sp_api.py).

create table if not exists date_source_config (
  source           text    not null,
  record_type      text    not null,
  date_is_uk_local boolean not null,
  note             text,
  primary key (source, record_type)
);

comment on table date_source_config is
  'Per (source, record_type) flag: is business_date genuinely Europe/London local? Edit date_is_uk_local directly (e.g. after confirming a GA4 property or Meta ad account timezone) — the api_clean trigger reads this on every upsert, no migration needed for a change here.';

insert into date_source_config (source, record_type, date_is_uk_local, note) values
  ('amazon_sp',             'order',           true,
    'PurchaseDate is a true UTC instant, always Z-suffixed (confirmed 97,461/97,461 rows, 2026-08-24 profiling) — converts cleanly.'),
  ('shopify',                'order',           true,
    'created_at is a true UTC instant, always Z-suffixed (confirmed 43,293/43,293 rows) — converts cleanly. See secondary_ts for processed_at.'),
  ('shopify',                'product',         true,
    'created_at is a true UTC instant, always Z-suffixed — converts cleanly.'),
  ('meta_ads',                'campaign',        true,
    'created_time carries an explicit numeric UTC offset per Graph API (e.g. -0700) on every row — converts cleanly regardless of the ad account''s configured timezone.'),
  ('meta_ads',                'adset',           true,
    'created_time carries an explicit numeric UTC offset per Graph API on every row — converts cleanly regardless of the ad account''s configured timezone.'),
  ('klaviyo',                 'campaign',        true,
    'send_time is UTC (+00:00 suffix) — converts cleanly. Null on Draft campaigns (16/280 as of 2026-08-24) — correctly so, business_date stays null for those.'),
  ('klaviyo',                 'flow',            true,
    'created is UTC (+00:00 suffix) — converts cleanly.'),
  ('google_analytics',        'traffic',         true,
    'date is an 8-digit YYYYMMDD string bucketed by the GA4 property''s configured reporting timezone. CONFIRMED 2026-08-24 (Jon, GA4 Admin > Property Settings): property 383475128 is "(GMT+01:00) United Kingdom Time" = Europe/London. Already a genuine UK calendar date — parsed as-is, not converted (there is no underlying timestamp to convert; business_ts stays null for this record_type).'),
  ('google_analytics',        'page',            true,
    'Same as google_analytics/traffic — same GA4 property, confirmed Europe/London (property 383475128, 2026-08-24).'),
  ('google_search_console',   'search_analytics', false,
    'date is bucketed in Pacific Time — confirmed via Google''s own Search Console documentation (developers.google.com/search/blog/2019/09/search-performance-fresh-data), not an assumption. GSC has no timezone parameter on this API. This is permanent, not a placeholder pending confirmation — GSC is the only source in date_source_config that will never be true. Do not confuse with google_analytics above, which looks identical in shape (an 8-digit/ISO date string, no timestamp) but is UK-local while this one is not.'),
  ('meta_ads',                'adset_insight',    false,
    'date_start/date_stop are bucketed by the ad account''s configured timezone, not confirmed as Europe/London as of 2026-08-24. Also: as of this migration every existing row is a 30-day aggregate window (date_stop - date_start = 29 days on all 653 rows) from meta_ads.py requesting no time_increment — see the time_increment=1 connector fix landing alongside this migration. Even once the account timezone is confirmed, check business_date_grain = ''day'' before trusting any individual row as a single business day.')
on conflict (source, record_type) do nothing;

-- ── 3. Trigger — compute business_ts / business_date / date_is_uk_local / business_date_grain ──

create or replace function api_clean_compute_dates()
returns trigger language plpgsql as $$
declare
  v_uk_local  boolean;
  v_ts        timestamptz;
  v_date      date;
  v_grain     text;
begin
  select date_is_uk_local into v_uk_local
  from date_source_config
  where source = new.source and record_type = new.record_type;

  if v_uk_local is null then
    -- (source, record_type) not in date_source_config at all — unmapped.
    -- Not an error: a forgotten mapping must not break a connector's upsert.
    new.business_ts := null;
    new.business_date := null;
    new.date_is_uk_local := false;
    new.business_date_grain := 'none';
    new.secondary_ts := null;
    return new;
  end if;

  -- Tier A candidates: a real timestamp field to extract and convert.
  case
    when new.source = 'amazon_sp' and new.record_type = 'order' then
      v_ts := nullif(new.data->>'PurchaseDate', '')::timestamptz;
    when new.source = 'shopify' and new.record_type in ('order', 'product') then
      v_ts := nullif(new.data->>'created_at', '')::timestamptz;
    when new.source = 'meta_ads' and new.record_type in ('campaign', 'adset') then
      v_ts := nullif(new.data->>'created_time', '')::timestamptz;
    when new.source = 'klaviyo' and new.record_type = 'campaign' then
      v_ts := nullif(new.data->>'send_time', '')::timestamptz;   -- null on Draft campaigns, by design
    when new.source = 'klaviyo' and new.record_type = 'flow' then
      v_ts := nullif(new.data->>'created', '')::timestamptz;
    else
      v_ts := null;
  end case;

  new.secondary_ts := case
    when new.source = 'shopify' and new.record_type = 'order'
      then nullif(new.data->>'processed_at', '')::timestamptz
    else null
  end;

  if v_ts is not null then
    new.business_ts := v_ts;
    new.business_date := (v_ts at time zone 'Europe/London')::date;
    new.business_date_grain := 'day';
    new.date_is_uk_local := v_uk_local;
    return new;
  end if;

  -- Tier B candidates: no real timestamp, a source-local bucketed date string.
  new.business_ts := null;
  case
    when new.source = 'google_analytics' and new.record_type in ('traffic', 'page') then
      v_date := to_date(nullif(new.data->>'date', ''), 'YYYYMMDD');
      v_grain := case when v_date is null then 'none' else 'day' end;
    when new.source = 'google_search_console' and new.record_type = 'search_analytics' then
      v_date := nullif(new.data->>'date', '')::date;
      v_grain := case when v_date is null then 'none' else 'day' end;
    when new.source = 'meta_ads' and new.record_type = 'adset_insight' then
      v_date := nullif(new.data->>'date_start', '')::date;
      -- Self-correcting: once the connector fix lands, new rows arrive with
      -- date_start = date_stop and are automatically graded 'day' with no
      -- further migration. Existing 30-day-window rows stay 'range'.
      v_grain := case
        when v_date is null then 'none'
        when (new.data->>'date_start') = (new.data->>'date_stop') then 'day'
        else 'range'
      end;
    else
      v_date := null;
      v_grain := 'none';
  end case;

  new.business_date := v_date;
  new.business_date_grain := v_grain;
  new.date_is_uk_local := (v_grain <> 'none') and v_uk_local;
  return new;
end;
$$;

comment on function api_clean_compute_dates() is
  'BEFORE INSERT/UPDATE trigger on api_clean. Derives business_ts/business_date/business_date_grain from the JSONB data column per (source, record_type), and reads date_is_uk_local from date_source_config (deliberately data-driven, not hardcoded, so it can be corrected without a migration). See reports/date-normalisation-profile-and-plan-2026-08-24.md for the full mapping and evidence.';

drop trigger if exists api_clean_compute_dates_trg on api_clean;
create trigger api_clean_compute_dates_trg
  before insert or update on api_clean
  for each row execute function api_clean_compute_dates();

-- ── 4. One-time backfill of existing rows ────────────────────────────────────
-- Re-runnable: same trigger, same deterministic output every time. Disables
-- the existing api_clean_updated_at trigger for the duration so this doesn't
-- bump last_updated_at on 266,000+ rows that didn't actually receive new
-- source data — last_updated_at should only move when a connector run does.

create or replace function backfill_api_clean_dates()
returns int language plpgsql as $$
declare
  n int;
begin
  alter table api_clean disable trigger api_clean_updated_at;
  update api_clean set id = id;  -- no-op write; fires api_clean_compute_dates_trg only
  get diagnostics n = row_count;
  alter table api_clean enable trigger api_clean_updated_at;
  return n;
end;
$$;

comment on function backfill_api_clean_dates() is
  'One-time (but safely re-runnable) pass to populate business_ts/business_date/date_is_uk_local/business_date_grain on rows that existed before this migration. Call explicitly: SELECT backfill_api_clean_dates();';

select backfill_api_clean_dates();

-- ── 5. date_dim — shared date dimension, Europe/London, plain calendar year ──

create table if not exists date_dim (
  date_day          date primary key,
  year              int          not null,
  quarter           int          not null,
  month             int          not null,
  month_name        text         not null,
  day_of_month      int          not null,
  day_of_week       int          not null,   -- ISO: 1=Monday .. 7=Sunday
  day_name          text         not null,
  iso_week          int          not null,
  is_weekend        boolean      not null,
  is_bst            boolean      not null,   -- true if Europe/London was in BST (UTC+1) at local noon this day
  utc_offset_hours  numeric(3,1) not null    -- +1.0 (BST) or +0.0 (GMT) at local noon
);

comment on table date_dim is
  'Shared date dimension for the reporting layer, Europe/London, plain Jan-Dec calendar year (no fiscal columns — none defined anywhere in this repo as of 2026-08-24). Join api_clean.business_date = date_dim.date_day for business_date_grain = ''day'' rows only.';

insert into date_dim (
  date_day, year, quarter, month, month_name, day_of_month, day_of_week,
  day_name, iso_week, is_weekend, is_bst, utc_offset_hours
)
select
  d,
  extract(year from d)::int,
  extract(quarter from d)::int,
  extract(month from d)::int,
  trim(to_char(d, 'Month')),
  extract(day from d)::int,
  extract(isodow from d)::int,
  trim(to_char(d, 'Day')),
  extract(week from d)::int,
  extract(isodow from d) in (6, 7),
  offset_hours <> 0,
  offset_hours
from (
  select
    d,
    extract(epoch from (
      ((d::timestamp + time '12:00') at time zone 'UTC')
      - ((d::timestamp + time '12:00') at time zone 'Europe/London')
    )) / 3600.0 as offset_hours
  from generate_series('2015-01-01'::date, '2035-12-31'::date, interval '1 day') as d
) sub
on conflict (date_day) do nothing;

-- ── 6. fx_rates — dated FX rates for cross-marketplace totals ───────────────
-- Date-range rows per Jon's 2026-08-24 decision (typically monthly averages
-- for finance reporting), not one row per day. A daily rate is just a row
-- where valid_from = valid_to — no schema change needed to add one later.
-- Sourcing: Jon populates this; no source is wired up by this migration.

create table if not exists fx_rates (
  id             uuid           primary key default gen_random_uuid(),
  from_currency  text           not null,             -- marketplace currency, e.g. 'EUR', 'JPY'
  to_currency    text           not null default 'GBP',
  rate           numeric(14,6)  not null,              -- 1 from_currency = rate * to_currency
  valid_from     date           not null,
  valid_to       date,                                  -- null = still current
  source         text,                                  -- e.g. 'xe.com', 'ECB', 'manual' — not enforced, informational
  created_at     timestamptz    not null default now(),
  constraint fx_rates_currency_pair_differs check (from_currency <> to_currency),
  constraint fx_rates_valid_range check (valid_to is null or valid_to >= valid_from),
  constraint fx_rates_no_overlap exclude using gist (
    from_currency with =,
    to_currency with =,
    daterange(valid_from, coalesce(valid_to, 'infinity'::date), '[]') with &&
  )
);

comment on table fx_rates is
  'Dated FX rates for converting Amazon marketplace-currency figures to a common currency for cross-marketplace totals. Date-range rows (valid_from/valid_to) — a single-day rate is a row where they''re equal. The exclude constraint makes an overlapping rate period for the same currency pair a hard error at insert time, not a silent double-booking. Populated by Jon, not by any connector.';

create index if not exists fx_rates_lookup on fx_rates (from_currency, to_currency, valid_from);

alter table fx_rates enable row level security;
create policy "authenticated read fx_rates"
  on fx_rates for select
  using (auth.role() = 'authenticated');

-- ── 7. RLS on the two new tables ─────────────────────────────────────────────

alter table date_dim          enable row level security;
alter table date_source_config enable row level security;

create policy "authenticated read date_dim"
  on date_dim for select
  using (auth.role() = 'authenticated');
create policy "authenticated read date_source_config"
  on date_source_config for select
  using (auth.role() = 'authenticated');

-- ── 8. Register migration ─────────────────────────────────────────────────────

insert into schema_migrations (id, description)
values (
  '15-date-normalisation',
  'Europe/London date normalisation on api_clean (business_ts/business_date/date_is_uk_local/business_date_grain, trigger-maintained, data-driven via date_source_config), date_dim, fx_rates'
)
on conflict (id) do nothing;
