-- Migration: 09-breach-log
-- Description: GDPR Article 33 breach register — single append-only table.
--
-- Design rules:
--   • Rows are NEVER deleted or updated after creation.
--   • Write access restricted to the DPO lead (jon@doddl.com) via Supabase
--     service-role key only — no anonymous or standard authenticated writes.
--   • All authenticated users can read (internal audit trail).
--   • breach_id is a human-readable sequential reference, separate from the
--     internal uuid pk, for use in ICO correspondence.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Sequence for human-readable breach reference numbers ──────────────────
-- Format: BREACH-YYYY-NNN (e.g. BREACH-2026-001)

create sequence if not exists breach_id_seq start 1 increment 1;

create or replace function next_breach_id()
returns text language plpgsql as $$
declare
  yr text := to_char(now(), 'YYYY');
  n  integer;
begin
  n := nextval('breach_id_seq');
  return 'BREACH-' || yr || '-' || lpad(n::text, 3, '0');
end;
$$;

-- ── 2. breach_log table ───────────────────────────────────────────────────────

create table if not exists breach_log (
  -- Internal primary key
  id                          uuid        primary key default gen_random_uuid(),

  -- Human-readable reference used in ICO correspondence (auto-generated, immutable)
  breach_id                   text        not null unique default next_breach_id(),

  -- Timeline
  date_detected               date        not null,
  date_reported_internally    date        not null,

  -- Scope
  data_categories_affected    text[]      not null,    -- e.g. ARRAY['email','name','address']
  estimated_individuals_affected integer  not null check (estimated_individuals_affected >= 0),
  severity_level              text        not null check (severity_level in ('low','medium','high','critical')),

  -- ICO notification (GDPR Article 33 — 72-hour clock)
  ico_notified                boolean     not null default false,
  ico_notification_date       date,
  ico_reference_number        text,

  -- Individual notification (GDPR Article 34)
  individuals_notified        boolean     not null default false,
  date_individuals_notified   date,

  -- Narrative
  description                 text        not null,
  actions_taken               text        not null,
  logged_by                   text        not null,   -- email address of DPO lead who logged the record

  -- Immutability: no updated_at column — rows are never modified after INSERT
  created_at                  timestamptz not null default now()
);

-- Index for date-range queries (ICO reporting, annual review)
create index if not exists breach_log_date_detected          on breach_log (date_detected desc);
create index if not exists breach_log_ico_notified           on breach_log (ico_notified) where ico_notified = false;
create index if not exists breach_log_severity               on breach_log (severity_level);

-- ── 3. Immutability trigger — block UPDATE and DELETE on all rows ─────────────

create or replace function breach_log_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'breach_log rows are immutable — UPDATE and DELETE are prohibited. Create a new row to amend the record.';
end;
$$;

drop trigger if exists breach_log_no_update on breach_log;
create trigger breach_log_no_update
  before update on breach_log
  for each row execute function breach_log_immutable();

drop trigger if exists breach_log_no_delete on breach_log;
create trigger breach_log_no_delete
  before delete on breach_log
  for each row execute function breach_log_immutable();

-- ── 4. RLS ────────────────────────────────────────────────────────────────────
-- Write (INSERT) is allowed only via the service-role key (bypasses RLS).
-- Authenticated users can read for audit purposes.
-- No UPDATE or DELETE policy is defined — the trigger above enforces that.

alter table breach_log enable row level security;

-- All authenticated users can read (internal audit trail)
create policy "authenticated read breach_log"
  on breach_log for select
  using (auth.role() = 'authenticated');

-- No INSERT policy via RLS — inserts go through the service-role key only
-- (service role bypasses RLS; this means no authenticated user can INSERT
-- via the anon/authenticated path — DPO must use the server-side admin route)

-- Explicit block on INSERT via authenticated role (belt-and-braces)
create policy "no authenticated insert breach_log"
  on breach_log for insert
  with check (false);

-- ── 5. Register migration ─────────────────────────────────────────────────────

insert into schema_migrations (id, description)
values (
  '09-breach-log',
  'GDPR breach_log table — append-only, DPO write access only, immutability trigger, auto breach_id reference numbers'
)
on conflict (id) do nothing;
