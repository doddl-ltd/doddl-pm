-- Migration: 10-breach-alert-trigger
-- Description: 72-hour ICO notification alert system.
--   On breach_log INSERT:
--     1. Immediately queues a critical PM task: "DATA BREACH INCIDENT CREATED — ..."
--     2. Queues a reminder at +48 hours.
--   A pg_cron job every 5 minutes processes the queue via pg_net (HTTP POST to the
--   agent API). No credentials stored in the migration — the API URL and service key
--   are set separately as Postgres database settings (see scripts/configure-breach-alerts.js).
--
-- Pre-requisites:
--   • Migration 09-breach-log must be applied (breach_log table must exist).
--   • pg_net extension enabled (migration 08 enables it via migration_08).
--   • After applying this migration, run:
--       node scripts/configure-breach-alerts.js
--     to set app.pm_api_url and app.agent_service_key in the database.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Ensure extensions ──────────────────────────────────────────────────────

create extension if not exists "pg_net" with schema extensions;
create extension if not exists "pg_cron" with schema extensions;

-- ── 2. Notification queue table ───────────────────────────────────────────────

create table if not exists breach_notifications_queue (
  id              uuid        primary key default gen_random_uuid(),
  breach_log_id   uuid        not null references breach_log(id),
  breach_ref      text        not null,          -- human-readable breach_id (e.g. BREACH-2026-001)
  alert_type      text        not null check (alert_type in ('immediate', 'reminder_48h')),
  process_after   timestamptz not null,          -- when this alert becomes due
  pm_task_title   text        not null,
  pm_task_notes   text,
  status          text        not null default 'pending' check (status in ('pending','sending','sent','failed')),
  attempts        integer     not null default 0,
  last_error      text,
  sent_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists breach_notif_queue_due
  on breach_notifications_queue (process_after)
  where status = 'pending';

create index if not exists breach_notif_queue_breach_ref
  on breach_notifications_queue (breach_ref);

-- ── 3. Trigger function — enqueue two alerts on INSERT ────────────────────────

create or replace function enqueue_breach_alerts()
returns trigger language plpgsql security definer as $$
declare
  detect_ts   timestamptz := now();
  deadline_ts timestamptz := now() + interval '72 hours';
  remind_ts   timestamptz := now() + interval '48 hours';
  imm_title   text;
  rem_title   text;
begin
  imm_title := 'DATA BREACH INCIDENT CREATED — 72-hour ICO notification clock started at '
    || to_char(detect_ts at time zone 'Europe/London', 'DD Mon YYYY HH24:MI')
    || ' (London time). Assess by '
    || to_char(deadline_ts at time zone 'Europe/London', 'DD Mon YYYY HH24:MI')
    || '. Reference: ' || new.breach_id;

  rem_title := 'BREACH REMINDER: 48 hours elapsed — '
    || new.breach_id
    || '. 24 hours remain on ICO notification clock. '
    || 'Deadline: '
    || to_char(deadline_ts at time zone 'Europe/London', 'DD Mon YYYY HH24:MI')
    || ' (London time).';

  -- Immediate alert (process now)
  insert into breach_notifications_queue
    (breach_log_id, breach_ref, alert_type, process_after, pm_task_title, pm_task_notes)
  values (
    new.id,
    new.breach_id,
    'immediate',
    now(),
    imm_title,
    'Logged by: ' || new.logged_by
      || '. Severity: ' || new.severity_level
      || '. Categories: ' || array_to_string(new.data_categories_affected, ', ')
      || '. Estimated individuals: ' || new.estimated_individuals_affected::text
  );

  -- 48-hour reminder
  insert into breach_notifications_queue
    (breach_log_id, breach_ref, alert_type, process_after, pm_task_title, pm_task_notes)
  values (
    new.id,
    new.breach_id,
    'reminder_48h',
    remind_ts,
    rem_title,
    'Original breach: ' || new.breach_id
      || '. ICO deadline: ' || to_char(deadline_ts at time zone 'Europe/London', 'DD Mon YYYY HH24:MI')
  );

  return new;
end;
$$;

drop trigger if exists breach_log_enqueue_alerts on breach_log;
create trigger breach_log_enqueue_alerts
  after insert on breach_log
  for each row execute function enqueue_breach_alerts();

-- ── 4. Queue processor — called by pg_cron every 5 minutes ───────────────────
-- Reads app.pm_api_url and app.agent_service_key from database settings.
-- These settings are set by scripts/configure-breach-alerts.js — never in SQL.

create or replace function process_breach_notifications()
returns integer language plpgsql security definer as $$
declare
  api_url     text;
  svc_key     text;
  rec         breach_notifications_queue%rowtype;
  body_json   text;
  request_id  bigint;
  processed   integer := 0;
begin
  -- Read config from database settings (set by configure-breach-alerts.js)
  api_url := current_setting('app.pm_api_url', true);
  svc_key := current_setting('app.agent_service_key', true);

  if api_url is null or api_url = '' then
    raise notice 'process_breach_notifications: app.pm_api_url not configured — skipping';
    return 0;
  end if;
  if svc_key is null or svc_key = '' then
    raise notice 'process_breach_notifications: app.agent_service_key not configured — skipping';
    return 0;
  end if;

  -- Process all pending alerts that are now due (up to 10 per run to avoid blocking)
  for rec in
    select * from breach_notifications_queue
    where  status       = 'pending'
      and  process_after <= now()
    order by process_after
    limit  10
    for update skip locked
  loop
    -- Mark as sending (prevents duplicate sends from concurrent runs)
    update breach_notifications_queue
    set    status = 'sending', attempts = attempts + 1
    where  id = rec.id;

    body_json := json_build_object(
      'title',       rec.pm_task_title,
      'description', rec.pm_task_notes,
      'priority',    'critical',
      'status',      'not_started',
      'task_type',   'incident',
      'project_id',  '10000000-0000-0000-0000-000000000002',
      'group_id',    '20000000-0000-0000-0000-000000000008'
    )::text;

    -- Async HTTP POST via pg_net (non-blocking)
    select net.http_post(
      url     := api_url || '/api/agent/tasks',
      body    := body_json::jsonb,
      headers := json_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || svc_key,
        'X-Agent-Id',    'breach-alert-system'
      )::jsonb
    ) into request_id;

    -- Mark as sent (pg_net is fire-and-forget; errors are captured separately)
    update breach_notifications_queue
    set    status  = 'sent',
           sent_at = now()
    where  id = rec.id;

    processed := processed + 1;
  end loop;

  return processed;
end;
$$;

-- ── 5. Schedule the processor every 5 minutes ────────────────────────────────

select cron.schedule(
  'process-breach-notifications',
  '*/5 * * * *',
  'select process_breach_notifications()'
) where not exists (
  select 1 from cron.job where jobname = 'process-breach-notifications'
);

-- ── 6. RLS on queue table ─────────────────────────────────────────────────────

alter table breach_notifications_queue enable row level security;

create policy "authenticated read breach_notifications_queue"
  on breach_notifications_queue for select
  using (auth.role() = 'authenticated');

-- No direct writes via RLS — queue is populated by the trigger only

-- ── 7. Register migration ─────────────────────────────────────────────────────

insert into schema_migrations (id, description)
values (
  '10-breach-alert-trigger',
  '72-hour ICO breach alert system: queue table, INSERT trigger, pg_cron processor, pg_net HTTP POST to agent API'
)
on conflict (id) do nothing;
