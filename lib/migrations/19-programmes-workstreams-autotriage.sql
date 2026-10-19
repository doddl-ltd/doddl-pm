-- Migration: 19-programmes-workstreams-autotriage
-- Description: Jon, 2026-10-15:
--   * Programmes group projects, and they mirror how work is organised in Claude:
--       claude.ai Project / sidebar group / agent  ->  PM programme
--       chat / Claude Code session / agent workstream  ->  PM project
--     Claude creates and maintains both (sync_workstream); no hand upkeep.
--   * Triage is automated: Claude files each captured action into the right
--     project (create or update a task) and only leaves genuinely unclear items
--     for a person. Every auto-filed item can be undone.
--
--   A) programmes + projects.programme_id
--   B) workstreams: a Claude chat / session / agent linked to its PM project
--   C) inbox_items: workstream + project hint, auto-triage state
--   D) 'chat' source (Claude conversations) for inbox items and tasks
--   E) notifications type 'auto_assigned' (owner told when Claude files a task for them)
--
-- Additive and safe under the live UI. Idempotent.

-- ═══════════════════════════════════════════════════════════════════════════
-- A) programmes
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.programmes (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text        NOT NULL CHECK (btrim(name) <> ''),
  description  text,
  source       text        NOT NULL DEFAULT 'manual'
               CHECK (source IN ('manual', 'claude_project', 'sidebar_group', 'agent', 'sync')),
  position     integer     NOT NULL DEFAULT 0,
  archived_at  timestamptz,
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS programmes_live_name
  ON public.programmes (lower(btrim(name))) WHERE archived_at IS NULL;

COMMENT ON TABLE public.programmes IS
  'Groups of projects. Mirrors Claude: a claude.ai Project, sidebar group or agent = a programme. Created/maintained by Claude via sync_workstream.';

DROP TRIGGER IF EXISTS programmes_updated_at ON public.programmes;
CREATE TRIGGER programmes_updated_at BEFORE UPDATE ON public.programmes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS programme_id uuid NULL
  REFERENCES public.programmes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS projects_programme ON public.projects (programme_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- B) workstreams
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.workstreams (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text        NOT NULL CHECK (kind IN ('claude_chat', 'claude_code', 'agent', 'teams', 'other')),
  key           text        NOT NULL CHECK (btrim(key) <> ''),
  title         text        NOT NULL,
  programme_id  uuid        REFERENCES public.programmes(id) ON DELETE SET NULL,
  project_id    uuid        REFERENCES public.projects(id) ON DELETE SET NULL,
  created_by    text,
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, key)
);
CREATE INDEX IF NOT EXISTS workstreams_project ON public.workstreams (project_id);

COMMENT ON TABLE public.workstreams IS
  'A Claude chat, Claude Code session/repo or agent, linked to the PM project it feeds. key is stable (e.g. repo:doddl-ads, claude_chat:doddl marketing/crm build in klaviyo).';

-- ═══════════════════════════════════════════════════════════════════════════
-- C) inbox auto-triage
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.inbox_items
  ADD COLUMN IF NOT EXISTS workstream_id   uuid REFERENCES public.workstreams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_hint_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS auto_status     text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS auto_decisions  jsonb,
  ADD COLUMN IF NOT EXISTS auto_reason     text,
  ADD COLUMN IF NOT EXISTS auto_at         timestamptz,
  ADD COLUMN IF NOT EXISTS auto_attempts   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_error      text,
  ADD COLUMN IF NOT EXISTS auto_model      text;

ALTER TABLE public.inbox_items DROP CONSTRAINT IF EXISTS inbox_items_auto_status_check;
ALTER TABLE public.inbox_items ADD CONSTRAINT inbox_items_auto_status_check
  CHECK (auto_status IN ('pending', 'processing', 'filed', 'needs_review', 'skipped', 'undone'));

-- Items a person already decided are not re-triaged.
UPDATE public.inbox_items SET auto_status = 'skipped'
 WHERE status NOT IN ('new', 'partial') AND auto_status = 'pending';

CREATE INDEX IF NOT EXISTS inbox_items_auto_pending
  ON public.inbox_items (created_at) WHERE auto_status IN ('pending', 'processing');

COMMENT ON COLUMN public.inbox_items.auto_status IS
  'pending -> processing -> filed (all actions handled) | needs_review (a person should look) | skipped (decided by a person) | undone (auto-filing reversed).';

-- ═══════════════════════════════════════════════════════════════════════════
-- D) 'chat' source
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.inbox_items DROP CONSTRAINT IF EXISTS inbox_items_source_check;
ALTER TABLE public.inbox_items ADD CONSTRAINT inbox_items_source_check
  CHECK (source IN ('email', 'teams', 'teamsmaestro', 'meeting', 'agent', 'manual', 'chat'));

ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_source_check;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_source_check
  CHECK (source IN ('manual', 'email', 'teams', 'teamsmaestro', 'agent', 'meeting', 'chat'));

-- ═══════════════════════════════════════════════════════════════════════════
-- E) notifications for auto-filed tasks
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('mention', 'comment_on_owned', 'auto_assigned'));

-- ═══════════════════════════════════════════════════════════════════════════
-- Access: server-only
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.programmes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workstreams ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.programmes, public.workstreams FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
