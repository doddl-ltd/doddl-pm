-- Migration: 16-pm-hardening
-- Description: PM tool hardening, part 1 of 2 (additive; safe under the
--              current live UI). Adds the tables the agent/MCP layer, the
--              triage inbox and OAuth need, and moves the rules that used to
--              live only in the briefing document into the database:
--
--   A) people              canonical assignee list; tasks.assigned_to FK
--   B) archived_at         soft delete for tasks + projects (task_groups has it)
--   C) external_ref        idempotency key so agent re-runs never duplicate
--   D) progress <-> status trigger (mirrors UI rule #11)
--   E) decision lock       decision + artefact immutable once a human decides
--   F) audit log           append-only (in-flight rows may be finalised once)
--   G) task_history        every task change with its actor, so nothing is
--                          lost when notes are overwritten
--   H) task_links          evidence links (commit, PR, artifact, doc, ...)
--   I) inbox_items         email / Teams / meeting capture awaiting triage
--   J) agent_keys          per-agent API keys (hashes only)
--   K) oauth_*             OAuth 2.1 for the Claude chat connector
--
-- Part 2 (17-pm-lockdown) removes the anon key's access and blocks hard
-- deletes. It must only be applied to production AFTER the staging code that
-- routes the UI through /api/db is merged to main, or the live UI breaks.
--
-- Apply via scripts/safe-apply-migration.js (it calls backup_before_migration).
-- Idempotent: every statement is IF NOT EXISTS / CREATE OR REPLACE / guarded.

-- ═══════════════════════════════════════════════════════════════════════════
-- A) people
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.people (
  name        text        PRIMARY KEY,
  email       text        UNIQUE,
  kind        text        NOT NULL DEFAULT 'human' CHECK (kind IN ('human', 'agent')),
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.people IS
  'Canonical assignee list. tasks.assigned_to references people.name. Matches lib/team.js TEAM.';

INSERT INTO public.people (name, email, kind) VALUES
  ('Jon',    'jon@doddl.com',       'human'),
  ('Laura',  'laura@doddl.com',     'human'),
  ('Cat',    'catherine@doddl.com', 'human'),
  ('Chris',  'finance@doddl.com',   'human'),
  ('Cathy',  'hello@doddl.com',     'human'),
  ('Claude', 'claude@doddl.com',    'agent')
ON CONFLICT (name) DO NOTHING;

-- Blank assignees mean "nobody".
UPDATE public.tasks SET assigned_to = NULL
WHERE assigned_to IS NOT NULL AND btrim(assigned_to) = '';

-- Any other value already in use is kept as an inactive person so the FK
-- below never rejects existing data.
INSERT INTO public.people (name, kind, active)
SELECT DISTINCT assigned_to, 'human', false FROM public.tasks
WHERE assigned_to IS NOT NULL AND assigned_to NOT IN (SELECT name FROM public.people)
ON CONFLICT (name) DO NOTHING;

-- Normalise case/whitespace ("jon " -> "Jon") and reject unknown names with
-- a message that lists the valid ones.
CREATE OR REPLACE FUNCTION public.tasks_normalise_assignee()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE canonical text;
BEGIN
  IF NEW.assigned_to IS NULL THEN RETURN NEW; END IF;
  IF btrim(NEW.assigned_to) = '' THEN NEW.assigned_to := NULL; RETURN NEW; END IF;
  SELECT name INTO canonical FROM public.people
  WHERE lower(name) = lower(btrim(NEW.assigned_to)) LIMIT 1;
  IF canonical IS NULL THEN
    RAISE EXCEPTION 'Unknown assignee "%". Valid: %', NEW.assigned_to,
      (SELECT string_agg(name, ', ' ORDER BY name) FROM public.people WHERE active)
      USING ERRCODE = '23503';
  END IF;
  NEW.assigned_to := canonical;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tasks_normalise_assignee ON public.tasks;
CREATE TRIGGER tasks_normalise_assignee
  BEFORE INSERT OR UPDATE OF assigned_to ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_normalise_assignee();

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_assigned_to_people_fkey') THEN
    ALTER TABLE public.tasks ADD CONSTRAINT tasks_assigned_to_people_fkey
      FOREIGN KEY (assigned_to) REFERENCES public.people(name) ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- B) soft delete
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.tasks    ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL;

COMMENT ON COLUMN public.tasks.archived_at IS
  'Soft delete. The UI''s delete actions set this (via /api/db); rows are never hard-deleted (Hard Rule 9).';
COMMENT ON COLUMN public.projects.archived_at IS
  'Soft delete. The UI''s delete actions set this (via /api/db); rows are never hard-deleted (Hard Rule 9).';

CREATE INDEX IF NOT EXISTS tasks_live ON public.tasks (project_id) WHERE archived_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- C) external_ref — idempotency for agent writes
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS external_ref text NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tasks_external_ref_key
  ON public.tasks (external_ref) WHERE external_ref IS NOT NULL;

-- Tasks accepted from captured meeting notes keep source = 'meeting'.
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_source_check;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_source_check
  CHECK (source IN ('manual', 'email', 'teams', 'teamsmaestro', 'agent', 'meeting'));

COMMENT ON COLUMN public.tasks.external_ref IS
  'Caller-supplied stable key (e.g. "webbuild3-golive"). create_task with an existing external_ref returns the existing task instead of a duplicate.';

-- ═══════════════════════════════════════════════════════════════════════════
-- D) progress <-> status (UI rule #11, now enforced for every writer)
-- ═══════════════════════════════════════════════════════════════════════════
--   0% -> not_started, 1..99% -> in_progress, 100% -> done, done -> 100%.
--   Explicit states (on_track / at_risk / blocked) are never overwritten by a
--   progress change, matching ProjectTableRow.handleProgress.

CREATE OR REPLACE FUNCTION public.tasks_progress_status()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  vanilla          text[] := ARRAY['not_started', 'in_progress', 'done'];
  status_changed   boolean;
  progress_changed boolean;
BEGIN
  IF NEW.progress IS NOT NULL THEN
    NEW.progress := greatest(0, least(100, NEW.progress));
  END IF;

  IF TG_OP = 'INSERT' THEN
    status_changed := true; progress_changed := NEW.progress IS NOT NULL;
  ELSE
    status_changed   := NEW.status   IS DISTINCT FROM OLD.status;
    progress_changed := NEW.progress IS DISTINCT FROM OLD.progress;
  END IF;

  IF NEW.status = 'done' THEN
    NEW.progress := 100;
  ELSIF progress_changed AND NOT status_changed AND OLD.status = ANY (vanilla) THEN
    NEW.status := CASE WHEN coalesce(NEW.progress, 0) = 0 THEN 'not_started'
                       WHEN NEW.progress = 100 THEN 'done'
                       ELSE 'in_progress' END;
  ELSIF status_changed AND NEW.status = ANY (vanilla) THEN
    IF NEW.progress = 100 AND progress_changed THEN
      NEW.status := 'done';
    ELSIF NEW.status = 'not_started' AND coalesce(NEW.progress, 0) > 0 THEN
      IF progress_changed THEN NEW.status := 'in_progress'; ELSE NEW.progress := 0; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tasks_progress_status ON public.tasks;
CREATE TRIGGER tasks_progress_status
  BEFORE INSERT OR UPDATE OF status, progress ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_progress_status();

-- ═══════════════════════════════════════════════════════════════════════════
-- E) decision lock — what Jon approved can never change underneath him
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.tasks_decision_lock()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.decision IS NOT NULL AND (
       NEW.decision       IS DISTINCT FROM OLD.decision
    OR NEW.decision_by    IS DISTINCT FROM OLD.decision_by
    OR NEW.decision_at    IS DISTINCT FROM OLD.decision_at
    OR NEW.decision_notes IS DISTINCT FROM OLD.decision_notes
    OR NEW.artefact       IS DISTINCT FROM OLD.artefact
    OR NEW.artefact_type  IS DISTINCT FROM OLD.artefact_type
    OR NEW.staging_url    IS DISTINCT FROM OLD.staging_url) THEN
    RAISE EXCEPTION 'Task % has a recorded decision (%). The decision and its artefact are immutable; submit a revision as a new approval task.',
      OLD.id, OLD.decision USING ERRCODE = 'P0001';
  END IF;
  IF NEW.decision IS NOT NULL AND OLD.decision IS NULL THEN
    IF NEW.decision_by IS NULL OR btrim(NEW.decision_by) = '' THEN
      RAISE EXCEPTION 'decision_by is required when recording a decision' USING ERRCODE = '23502';
    END IF;
    NEW.decision_at := coalesce(NEW.decision_at, now());
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tasks_decision_lock ON public.tasks;
CREATE TRIGGER tasks_decision_lock
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_decision_lock();

-- ═══════════════════════════════════════════════════════════════════════════
-- F) agent_audit_log append-only
-- ═══════════════════════════════════════════════════════════════════════════
-- lib/agentAuth.js writes an in-flight row (status_code = 0) before the
-- handler runs and finalises it afterwards. That single finalise is the only
-- update allowed; nothing may be deleted.

CREATE OR REPLACE FUNCTION public.agent_audit_log_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'agent_audit_log is append-only' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status_code <> 0
     OR NEW.id <> OLD.id OR NEW.agent_id <> OLD.agent_id OR NEW.method <> OLD.method
     OR NEW.path <> OLD.path OR NEW.created_at <> OLD.created_at
     OR NEW.request_body IS DISTINCT FROM OLD.request_body
     OR NEW.ip_address   IS DISTINCT FROM OLD.ip_address
     OR NEW.user_agent   IS DISTINCT FROM OLD.user_agent THEN
    RAISE EXCEPTION 'agent_audit_log is append-only (only an in-flight row may be finalised, once)' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS agent_audit_log_append_only ON public.agent_audit_log;
CREATE TRIGGER agent_audit_log_append_only
  BEFORE UPDATE OR DELETE ON public.agent_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.agent_audit_log_append_only();

-- ═══════════════════════════════════════════════════════════════════════════
-- G) task_history
-- ═══════════════════════════════════════════════════════════════════════════
-- Actor comes from the x-doddl-actor request header that /api/db (humans)
-- and the agent layer (agents) set; PostgREST exposes request headers to
-- triggers as the request.headers GUC.

CREATE TABLE IF NOT EXISTS public.task_history (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id     uuid        NOT NULL,
  op          text        NOT NULL CHECK (op IN ('insert', 'update', 'delete')),
  actor       text,
  changed     jsonb       NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_history_task ON public.task_history (task_id, created_at DESC);

COMMENT ON TABLE public.task_history IS
  'One row per task change. changed = {field: {old, new}} for updates, the full row for insert/delete.';

CREATE OR REPLACE FUNCTION public.request_actor()
RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE h text;
BEGIN
  h := current_setting('request.headers', true);
  IF h IS NOT NULL AND h <> '' THEN
    RETURN coalesce(nullif(h::json ->> 'x-doddl-actor', ''), current_user);
  END IF;
  RETURN current_user;
EXCEPTION WHEN others THEN
  RETURN current_user;
END $$;

CREATE OR REPLACE FUNCTION public.tasks_record_history()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE diff jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.task_history (task_id, op, actor, changed)
    VALUES (NEW.id, 'insert', public.request_actor(), to_jsonb(NEW));
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.task_history (task_id, op, actor, changed)
    VALUES (OLD.id, 'delete', public.request_actor(), to_jsonb(OLD));
  ELSE
    SELECT jsonb_object_agg(n.key, jsonb_build_object('old', o.value, 'new', n.value))
      INTO diff
      FROM jsonb_each(to_jsonb(NEW)) n
      JOIN jsonb_each(to_jsonb(OLD)) o USING (key)
     WHERE n.value IS DISTINCT FROM o.value AND n.key <> 'updated_at';
    IF diff IS NOT NULL THEN
      INSERT INTO public.task_history (task_id, op, actor, changed)
      VALUES (NEW.id, 'update', public.request_actor(), diff);
    END IF;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS tasks_record_history ON public.tasks;
CREATE TRIGGER tasks_record_history
  AFTER INSERT OR UPDATE OR DELETE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_record_history();

-- ═══════════════════════════════════════════════════════════════════════════
-- H) task_links — evidence for "done"
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.task_links (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     uuid        NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  url         text        NOT NULL CHECK (btrim(url) <> ''),
  kind        text        NOT NULL DEFAULT 'link'
              CHECK (kind IN ('commit', 'pr', 'artifact', 'doc', 'deploy', 'email', 'meeting', 'file', 'link')),
  label       text,
  added_by    text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, url)
);
CREATE INDEX IF NOT EXISTS task_links_task ON public.task_links (task_id);

COMMENT ON COLUMN public.task_links.url IS
  'A URL, or a stable reference such as "D0DDL/doddl-reports@e642361" or a file path.';

-- ═══════════════════════════════════════════════════════════════════════════
-- I) inbox_items — capture first, triage second
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.inbox_items (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source             text        NOT NULL CHECK (source IN ('email', 'teams', 'teamsmaestro', 'meeting', 'agent', 'manual')),
  source_ref         text,
  title              text        NOT NULL,
  summary            text,
  body               text,
  payload            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  participants       text[]      NOT NULL DEFAULT '{}',
  occurred_at        timestamptz,
  proposed_actions   jsonb       NOT NULL DEFAULT '[]'::jsonb,
  status             text        NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'accepted', 'partial', 'dismissed')),
  assigned_to        text        REFERENCES public.people(name) ON UPDATE CASCADE ON DELETE SET NULL,
  triaged_by         text,
  triaged_at         timestamptz,
  triage_notes       text,
  resulting_task_ids uuid[]      NOT NULL DEFAULT '{}',
  created_by         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS inbox_items_source_ref
  ON public.inbox_items (source, source_ref) WHERE source_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS inbox_items_open ON public.inbox_items (status, created_at DESC);

COMMENT ON TABLE public.inbox_items IS
  'Captured emails, Teams messages, meeting notes and agent proposals. Nothing becomes a task until a human (or a chat session acting for one) accepts it.';
COMMENT ON COLUMN public.inbox_items.proposed_actions IS
  'Array of {kind: create_task|update_task, title, task_id?, owner_email?, assigned_to?, due_date?, status?, progress?, notes?}.';

DROP TRIGGER IF EXISTS inbox_items_updated_at ON public.inbox_items;
CREATE TRIGGER inbox_items_updated_at
  BEFORE UPDATE ON public.inbox_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- J) agent_keys — one key per agent, so identity is not self-declared
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.agent_keys (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      text        NOT NULL,
  key_hash      text        NOT NULL UNIQUE,
  key_prefix    text        NOT NULL,
  scopes        text[]      NOT NULL DEFAULT ARRAY['tasks:read', 'tasks:write', 'inbox:write'],
  label         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);
CREATE INDEX IF NOT EXISTS agent_keys_agent ON public.agent_keys (agent_id);

COMMENT ON TABLE public.agent_keys IS
  'sha256(key) only. Plaintext keys live in Key Vault doddl-kv-prod as pm-agent-key-<agent_id>. Scopes: tasks:read, tasks:write, inbox:write, inbox:triage, approvals:write.';

-- ═══════════════════════════════════════════════════════════════════════════
-- K) OAuth 2.1 (Claude chat custom connector)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.oauth_clients (
  client_id      text        PRIMARY KEY,
  client_name    text,
  redirect_uris  text[]      NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_used_at   timestamptz
);

CREATE TABLE IF NOT EXISTS public.oauth_codes (
  code_hash       text        PRIMARY KEY,
  client_id       text        NOT NULL REFERENCES public.oauth_clients(client_id) ON DELETE CASCADE,
  redirect_uri    text        NOT NULL,
  code_challenge  text        NOT NULL,
  scope           text,
  resource        text,
  user_name       text        NOT NULL,
  user_email      text        NOT NULL,
  expires_at      timestamptz NOT NULL,
  used_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.oauth_tokens (
  token_hash  text        PRIMARY KEY,
  kind        text        NOT NULL CHECK (kind IN ('access', 'refresh')),
  client_id   text        NOT NULL REFERENCES public.oauth_clients(client_id) ON DELETE CASCADE,
  family_id   uuid        NOT NULL,
  user_name   text        NOT NULL,
  user_email  text        NOT NULL,
  scope       text,
  expires_at  timestamptz NOT NULL,
  rotated_at  timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS oauth_tokens_family ON public.oauth_tokens (family_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- Access: new tables are server-only (service_role bypasses RLS)
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.people        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_history  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_links    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbox_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_keys    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oauth_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oauth_codes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oauth_tokens  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.people, public.task_history, public.task_links, public.inbox_items,
              public.agent_keys, public.oauth_clients, public.oauth_codes, public.oauth_tokens
  FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
