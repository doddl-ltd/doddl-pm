-- Migration: 12-apscheduler-jobs-table
-- Description: Creates the apscheduler_jobs table used by APScheduler's
--              SQLAlchemyJobStore for persistent job storage. APScheduler
--              creates this itself on first connect, but pre-creating it lets
--              us add appropriate RLS and audit it like any other schema object.
--
-- APScheduler schema reference:
--   https://github.com/agronholm/apscheduler/blob/3.x/apscheduler/jobstores/sqlalchemy.py
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists apscheduler_jobs (
  id         text         primary key,
  next_run_time numeric(20),        -- Unix timestamp (float stored as numeric)
  job_state  bytea        not null   -- Pickled job state
);

create index if not exists apscheduler_jobs_next_run_time
  on apscheduler_jobs (next_run_time);

-- RLS: only the connector service role (bypasses RLS) may write.
-- Authenticated users can read job schedule for monitoring.
alter table apscheduler_jobs enable row level security;

create policy "authenticated read apscheduler_jobs"
  on apscheduler_jobs for select
  using (auth.role() = 'authenticated');

-- ── Register ──────────────────────────────────────────────────────────────────

insert into schema_migrations (id, description)
values (
  '12-apscheduler-jobs-table',
  'APScheduler SQLAlchemy job store table for persistent connector scheduling'
)
on conflict (id) do nothing;
