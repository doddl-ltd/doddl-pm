-- Migration: 11-breach-alert-use-vault
-- Description: Patch process_breach_notifications() to read credentials from
--              Supabase Vault (pgsodium-encrypted) instead of unencrypted
--              database settings. The agent_service_key and pm_api_url are
--              upserted into vault.secrets by scripts/configure-breach-alerts.js.
-- ─────────────────────────────────────────────────────────────────────────────

-- Vault is enabled on Supabase Pro — no explicit CREATE EXTENSION required.
-- Verify availability: SELECT extname FROM pg_extension WHERE extname = 'supabase_vault';

create or replace function process_breach_notifications()
returns integer language plpgsql security definer as $$
declare
  api_url   text;
  svc_key   text;
  rec       breach_notifications_queue%rowtype;
  body_json text;
  processed integer := 0;
begin
  -- Read credentials from Supabase Vault (encrypted at rest, decrypted in-process)
  select decrypted_secret into api_url
  from   vault.decrypted_secrets
  where  name = 'breach-alert-pm-api-url'
  limit  1;

  select decrypted_secret into svc_key
  from   vault.decrypted_secrets
  where  name = 'breach-alert-agent-service-key'
  limit  1;

  if api_url is null or api_url = '' then
    raise notice 'process_breach_notifications: vault secret breach-alert-pm-api-url not configured';
    return 0;
  end if;
  if svc_key is null or svc_key = '' then
    raise notice 'process_breach_notifications: vault secret breach-alert-agent-service-key not configured';
    return 0;
  end if;

  for rec in
    select * from breach_notifications_queue
    where  status = 'pending'
      and  process_after <= now()
    order by process_after
    limit  10
    for update skip locked
  loop
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

    perform net.http_post(
      url     := api_url || '/api/agent/tasks',
      body    := body_json::jsonb,
      headers := json_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || svc_key,
        'X-Agent-Id',    'breach-alert-system'
      )::jsonb
    );

    update breach_notifications_queue
    set    status  = 'sent',
           sent_at = now()
    where  id = rec.id;

    processed := processed + 1;
  end loop;

  return processed;
end;
$$;

-- ── Register ──────────────────────────────────────────────────────────────────

insert into schema_migrations (id, description)
values (
  '11-breach-alert-use-vault',
  'Patch process_breach_notifications to read credentials from Supabase Vault'
)
on conflict (id) do nothing;
