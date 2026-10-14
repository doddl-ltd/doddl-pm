-- Migration: 17-pm-lockdown
-- Description: PM tool hardening, part 2 of 2. Removes every privilege the
--              public anon key had on PM tables and makes hard deletes
--              impossible for every role.
--
-- ORDER MATTERS. The anon key ships to every browser that loads the app.
-- Until the staging code (lib/supabase.js -> /api/db proxy) is live on the
-- target environment, the UI still talks to Supabase with that key, so:
--   staging    : apply once the pm-hardening branch is deployed to staging
--   production : apply ONLY after Jon merges staging -> main and the main
--                deployment is live. Applying earlier breaks the live UI.
--
-- After this migration:
--   - anon / authenticated have no access to any PM table (reads included);
--     all access is server-side via /api/db (MSAL-verified humans), the agent
--     API / MCP (per-agent keys or OAuth) and service-role scripts.
--   - DELETE on projects / tasks / task_groups raises for every role
--     (Hard Rule 9). Archive with archived_at instead.
--
-- Rollback (if the live UI turns out to still use anon): re-apply the anon
-- policies from 04-rls-policies.sql section C and DROP the delete guards.

-- ═══════════════════════════════════════════════════════════════════════════
-- A) anon / authenticated lose everything on PM tables
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "anon select projects"       ON public.projects;
DROP POLICY IF EXISTS "anon insert projects"       ON public.projects;
DROP POLICY IF EXISTS "anon update projects"       ON public.projects;
DROP POLICY IF EXISTS "anon delete projects"       ON public.projects;
DROP POLICY IF EXISTS "anon select task_groups"    ON public.task_groups;
DROP POLICY IF EXISTS "anon insert task_groups"    ON public.task_groups;
DROP POLICY IF EXISTS "anon update task_groups"    ON public.task_groups;
DROP POLICY IF EXISTS "anon delete task_groups"    ON public.task_groups;
DROP POLICY IF EXISTS "anon select tasks"          ON public.tasks;
DROP POLICY IF EXISTS "anon insert tasks"          ON public.tasks;
DROP POLICY IF EXISTS "anon update tasks"          ON public.tasks;
DROP POLICY IF EXISTS "anon delete tasks"          ON public.tasks;
DROP POLICY IF EXISTS "anon select comments"       ON public.comments;
DROP POLICY IF EXISTS "anon insert comments"       ON public.comments;
DROP POLICY IF EXISTS "anon select notifications"  ON public.notifications;
DROP POLICY IF EXISTS "anon insert notifications"  ON public.notifications;
DROP POLICY IF EXISTS "anon update notifications"  ON public.notifications;

REVOKE ALL ON public.projects, public.task_groups, public.tasks, public.comments,
              public.notifications, public.agent_audit_log, public.schema_migrations,
              public.migration_backups
  FROM anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- B) no hard deletes, for anyone
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.forbid_hard_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Hard delete on % is disabled (Hard Rule 9). Set archived_at instead.', TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END $$;

DROP TRIGGER IF EXISTS forbid_hard_delete ON public.projects;
CREATE TRIGGER forbid_hard_delete BEFORE DELETE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.forbid_hard_delete();
DROP TRIGGER IF EXISTS forbid_hard_delete ON public.task_groups;
CREATE TRIGGER forbid_hard_delete BEFORE DELETE ON public.task_groups
  FOR EACH ROW EXECUTE FUNCTION public.forbid_hard_delete();
DROP TRIGGER IF EXISTS forbid_hard_delete ON public.tasks;
CREATE TRIGGER forbid_hard_delete BEFORE DELETE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.forbid_hard_delete();

NOTIFY pgrst, 'reload schema';
