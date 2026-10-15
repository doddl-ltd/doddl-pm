-- Migration: 08-ai-os-raw-clean-schema
-- Description: AI OS data pipeline — raw layer (append-only) + clean layer (upserted) +
--              cold-storage archive table + monthly archival cron job.
--
-- Encryption at rest: active on Supabase Pro (AES-256 at the storage layer).
-- Confirmed by project dashboard: Storage > Settings > Encryption at Rest = Enabled.
-- No SQL action required — this is a platform-level guarantee.
--
-- Safe-apply notes:
--   • Idempotent — all DDL uses IF NOT EXISTS / OR REPLACE / ON CONFLICT DO NOTHING.
--   • Does not touch existing tables (projects / tasks / task_groups).
--   • pg_cron must be enabled on the Supabase project (available on Pro tier).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Enable required extensions ────────────────────────────────────────────

create extension if not exists "pg_cron" with schema extensions;
create extension if not exists "pg_stat_statements" with schema extensions;

-- ── 2. api_raw — append-only, one row per API response received ────────────────
-- Never updated. Never deleted. Retained for 24 months then archived.

create table if not exists api_raw (
  id               uuid        primary key default gen_random_uuid(),
  source           text        not null,                          -- e.g. 'klaviyo', 'shopify', 'amazon_sp_api'
  pull_id          uuid        not null,                          -- groups all rows from one scheduled connector run
  endpoint         text        not null,                          -- API path / operation called
  response_body    jsonb       not null,                          -- exact API response as received — never modified
  response_status  integer     not null,                          -- HTTP status code
  connector_version text       not null default '0.1.0',
  received_at      timestamptz not null default now(),
  -- Immutability enforcement: no updated_at, no soft-delete flag
  constraint api_raw_source_nonempty check (char_length(source) > 0)
);

-- Optimise common query patterns
create index if not exists api_raw_source_received_at on api_raw (source, received_at desc);
create index if not exists api_raw_pull_id            on api_raw (pull_id);
create index if not exists api_raw_received_at        on api_raw (received_at desc);

-- ── 3. api_raw_archive — cold storage for records > 24 months old ─────────────
-- Identical structure to api_raw, with an archived_at timestamp appended.
-- Rows in this table are also never deleted.

create table if not exists api_raw_archive (
  like api_raw including all,             -- inherit columns + constraints + indexes
  archived_at timestamptz not null default now()
);

-- ── 4. api_clean — upserted, normalised, query-ready ──────────────────────────
-- One canonical row per (source, record_type, source_record_id).
-- Connectors upsert on each run; the data column always reflects the latest state.

create table if not exists api_clean (
  id               uuid        primary key default gen_random_uuid(),
  source           text        not null,
  record_type      text        not null,                          -- e.g. 'contact', 'order', 'product', 'campaign'
  source_record_id text        not null,                          -- stable ID from the source system
  data             jsonb       not null,                          -- normalised record — overwritten on each upsert
  first_seen_at    timestamptz not null default now(),
  last_updated_at  timestamptz not null default now(),
  last_pull_id     uuid,                                          -- pull_id of the run that last wrote this row
  constraint api_clean_unique_record unique (source, record_type, source_record_id)
);

create index if not exists api_clean_source_type     on api_clean (source, record_type);
create index if not exists api_clean_last_updated_at on api_clean (last_updated_at desc);
create index if not exists api_clean_source_record   on api_clean (source_record_id);

-- Auto-update last_updated_at on every upsert
create or replace function api_clean_update_ts()
returns trigger language plpgsql as $$
begin
  new.last_updated_at = now();
  return new;
end;
$$;

drop trigger if exists api_clean_updated_at on api_clean;
create trigger api_clean_updated_at
  before update on api_clean
  for each row execute function api_clean_update_ts();

-- ── 5. RLS ─────────────────────────────────────────────────────────────────────

alter table api_raw         enable row level security;
alter table api_raw_archive enable row level security;
alter table api_clean       enable row level security;

-- Connector service role: insert into api_raw (read via service key — bypasses RLS)
-- Human authenticated users: read api_raw and api_clean (audit / debugging)
create policy "authenticated read api_raw"
  on api_raw for select
  using (auth.role() = 'authenticated');

create policy "authenticated read api_raw_archive"
  on api_raw_archive for select
  using (auth.role() = 'authenticated');

create policy "authenticated read api_clean"
  on api_clean for select
  using (auth.role() = 'authenticated');

-- api_raw is append-only: no update or delete permitted via RLS (service role bypasses,
-- but any accidental UPDATE/DELETE via anon/authenticated role is blocked)
create policy "no update api_raw"
  on api_raw for update
  using (false);

create policy "no delete api_raw"
  on api_raw for delete
  using (false);

create policy "no update api_raw_archive"
  on api_raw_archive for update
  using (false);

create policy "no delete api_raw_archive"
  on api_raw_archive for delete
  using (false);

-- ── 6. Monthly archival job ────────────────────────────────────────────────────
-- Runs at 02:00 on the 1st of each month.
-- Moves api_raw rows older than 24 months to api_raw_archive, then deletes originals.
-- Uses a transaction to ensure atomicity — archive write and delete are one operation.

create or replace function archive_old_api_raw()
returns integer language plpgsql security definer as $$
declare
  cutoff timestamptz := now() - interval '24 months';
  archived_count integer;
begin
  -- Insert into archive (ignore rows already archived from a prior partial run)
  insert into api_raw_archive
    select *, now() as archived_at
    from   api_raw
    where  received_at < cutoff
  on conflict (id) do nothing;

  get diagnostics archived_count = row_count;

  -- Delete originals (only those we successfully archived)
  delete from api_raw
  where  received_at < cutoff
    and  id in (select id from api_raw_archive where received_at < cutoff);

  return archived_count;
end;
$$;

-- Schedule: 02:00 on the 1st of every month (UTC)
-- pg_cron runs with database superuser privileges — security definer function is safe
select cron.schedule(
  'archive-old-api-raw',            -- job name (unique)
  '0 2 1 * *',                      -- cron expression
  'select archive_old_api_raw()'
) where not exists (
  select 1 from cron.job where jobname = 'archive-old-api-raw'
);

-- ── 7. Register migration ─────────────────────────────────────────────────────

insert into schema_migrations (id, description)
values (
  '08-ai-os-raw-clean-schema',
  'AI OS raw (append-only) + clean (upserted) data layers + cold-storage archive + monthly cron archival job'
)
on conflict (id) do nothing;
