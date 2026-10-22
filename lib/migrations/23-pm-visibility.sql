-- 23-pm-visibility
--
-- Who sees what (Jon, 2026-10-22):
--   "project owners can set a project as private and only users can see the tasks. By default meeting
--    notes captured are only for the people in the meeting. By default any email or teams chat that the
--    user pushes is only visible to the user."
--
-- Rules (one place, used by every way in: the app's /api/db proxy, each person's Claude connector and the
-- agent API, and Triage):
--   project   visible unless it is private; a private one only to its owner and its members
--   task      visible to the person it is assigned to, always; otherwise only if its own visible_to list
--             (null = no extra limit) includes you AND its project is visible to you
--   group     visible_to list (null = no limit) AND its project visible (meeting groups name the meeting)
--   comments, evidence links, history: follow their task
--   notifications: only your own
--   triage items (inbox_items): visible_to list, null = everyone
--
-- The viewer is the doddl person a request is for, sent by the server as the x-doddl-viewer header
-- (PostgREST exposes it in request.headers). No viewer = server code itself (auto-triage, agent keys,
-- scripts), which sees everything. Since 17-pm-lockdown only the service role can reach these tables, and
-- it is only used server-side, so the header cannot come from a browser.
--
-- pm_visible(<table>) are PostgREST computed fields: the server appends pm_visible=is.true to reads, updates
-- and deletes for a person (lib/server/visibility.js).
--
-- Additive and idempotent. The backfill only fills lists that are still empty.

-- ── columns ──────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.projects    ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false;
ALTER TABLE public.projects    ADD COLUMN IF NOT EXISTS members    text[]  NOT NULL DEFAULT '{}';
ALTER TABLE public.tasks       ADD COLUMN IF NOT EXISTS visible_to text[];
ALTER TABLE public.task_groups ADD COLUMN IF NOT EXISTS visible_to text[];
ALTER TABLE public.inbox_items ADD COLUMN IF NOT EXISTS visible_to text[];

COMMENT ON COLUMN public.projects.is_private IS 'Private project: only the owner and members (people names) see it and its tasks. Set by the owner.';
COMMENT ON COLUMN public.projects.members    IS 'People names who can see a private project (the owner always can).';
COMMENT ON COLUMN public.tasks.visible_to    IS 'Null = everyone who can see the project. Otherwise only these people (and the assignee). Meeting actions: the doddl attendees; Teams/e-mail captures: the person who sent or flagged it.';
COMMENT ON COLUMN public.task_groups.visible_to IS 'Null = no limit. Meeting groups: the doddl attendees.';
COMMENT ON COLUMN public.inbox_items.visible_to IS 'Null = everyone. Meetings: the doddl attendees; Teams/e-mail: the person who sent or flagged it; Claude chats: that person.';

-- ── helpers ──────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pm_viewer() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(btrim(coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json ->> 'x-doddl-viewer'), '')
$$;

CREATE OR REPLACE FUNCTION public.pm_in(names text[], viewer text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT EXISTS (SELECT 1 FROM unnest(coalesce(names, '{}'::text[])) n WHERE lower(btrim(n)) = lower(btrim(viewer)))
$$;

CREATE OR REPLACE FUNCTION public.pm_project_visible(p_id uuid, viewer text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT viewer IS NULL OR p_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = p_id AND p.is_private
      AND lower(btrim(coalesce(p.owner, ''))) <> lower(btrim(viewer))
      AND NOT public.pm_in(p.members, viewer))
$$;

CREATE OR REPLACE FUNCTION public.pm_task_row_visible(assigned_to text, visible_to text[], project_id uuid, viewer text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT viewer IS NULL
      OR lower(btrim(coalesce(assigned_to, ''))) = lower(btrim(viewer))
      OR ((visible_to IS NULL OR public.pm_in(visible_to, viewer)) AND public.pm_project_visible(project_id, viewer))
$$;

CREATE OR REPLACE FUNCTION public.pm_task_visible(t_id uuid, viewer text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT viewer IS NULL OR EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = t_id AND public.pm_task_row_visible(t.assigned_to, t.visible_to, t.project_id, viewer))
$$;

-- ── computed fields (PostgREST: ?pm_visible=is.true) ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pm_visible(r public.projects) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT v IS NULL OR NOT r.is_private OR lower(btrim(coalesce(r.owner, ''))) = lower(btrim(v)) OR public.pm_in(r.members, v)
  FROM (SELECT public.pm_viewer() AS v) s
$$;

CREATE OR REPLACE FUNCTION public.pm_visible(r public.tasks) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT public.pm_task_row_visible(r.assigned_to, r.visible_to, r.project_id, public.pm_viewer())
$$;

CREATE OR REPLACE FUNCTION public.pm_visible(r public.task_groups) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT v IS NULL OR ((r.visible_to IS NULL OR public.pm_in(r.visible_to, v)) AND public.pm_project_visible(r.project_id, v))
  FROM (SELECT public.pm_viewer() AS v) s
$$;

CREATE OR REPLACE FUNCTION public.pm_visible(r public.comments) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT public.pm_task_visible(r.task_id, public.pm_viewer())
$$;

CREATE OR REPLACE FUNCTION public.pm_visible(r public.task_links) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT public.pm_task_visible(r.task_id, public.pm_viewer())
$$;

CREATE OR REPLACE FUNCTION public.pm_visible(r public.task_history) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT public.pm_task_visible(r.task_id, public.pm_viewer())
$$;

CREATE OR REPLACE FUNCTION public.pm_visible(r public.notifications) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT v IS NULL OR lower(btrim(coalesce(r.user_name, ''))) = lower(btrim(v))
  FROM (SELECT public.pm_viewer() AS v) s
$$;

CREATE OR REPLACE FUNCTION public.pm_visible(r public.inbox_items) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT v IS NULL OR r.visible_to IS NULL OR public.pm_in(r.visible_to, v)
  FROM (SELECT public.pm_viewer() AS v) s
$$;

-- Server-side only, like the tables (17-pm-lockdown).
REVOKE ALL ON FUNCTION public.pm_viewer(), public.pm_in(text[], text), public.pm_project_visible(uuid, text),
  public.pm_task_row_visible(text, text[], uuid, text), public.pm_task_visible(uuid, text),
  public.pm_visible(public.projects), public.pm_visible(public.tasks), public.pm_visible(public.task_groups),
  public.pm_visible(public.comments), public.pm_visible(public.task_links), public.pm_visible(public.task_history),
  public.pm_visible(public.notifications), public.pm_visible(public.inbox_items)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pm_viewer(), public.pm_in(text[], text), public.pm_project_visible(uuid, text),
  public.pm_task_row_visible(text, text[], uuid, text), public.pm_task_visible(uuid, text),
  public.pm_visible(public.projects), public.pm_visible(public.tasks), public.pm_visible(public.task_groups),
  public.pm_visible(public.comments), public.pm_visible(public.task_links), public.pm_visible(public.task_history),
  public.pm_visible(public.notifications), public.pm_visible(public.inbox_items)
  TO service_role;

-- ── backfill: captures made before today keep the new defaults ───────────────────────────────────────────
-- Triage items: meetings -> doddl attendees (+ organiser); Teams -> who sent it; e-mail -> who flagged it.
UPDATE public.inbox_items i
SET visible_to = s.names
FROM (
  SELECT i2.id, array_agg(DISTINCT p.name ORDER BY p.name) AS names
  FROM public.inbox_items i2
  JOIN public.people p ON lower(p.email) = ANY (
    CASE i2.source
      WHEN 'meeting' THEN (SELECT array_agg(lower(x)) FROM unnest(i2.participants || coalesce(i2.payload ->> 'organizer_email', '')) x)
      WHEN 'email'   THEN ARRAY[lower(coalesce(i2.payload ->> 'flagged_by', ''))]
      WHEN 'teams'   THEN ARRAY[lower(coalesce(i2.payload ->> 'captured_by', ''))]
    END)
  WHERE i2.source IN ('meeting', 'email', 'teams') AND i2.visible_to IS NULL
  GROUP BY i2.id
) s
WHERE i.id = s.id;

-- Tasks filed from those items (external_ref "inbox:<item id>:<n>") get the same list.
UPDATE public.tasks t
SET visible_to = i.visible_to
FROM public.inbox_items i
WHERE t.visible_to IS NULL
  AND i.visible_to IS NOT NULL
  AND i.source IN ('meeting', 'email', 'teams')
  AND t.external_ref LIKE 'inbox:' || i.id::text || ':%';

-- Meeting groups: everyone who can see one of their tasks.
UPDATE public.task_groups g
SET visible_to = s.names
FROM (
  SELECT t.group_id, array_agg(DISTINCT x ORDER BY x) AS names
  FROM public.tasks t, unnest(t.visible_to) x
  WHERE t.group_id IS NOT NULL AND t.visible_to IS NOT NULL
  GROUP BY t.group_id
) s
WHERE g.id = s.group_id
  AND g.visible_to IS NULL
  AND g.project_id IN (SELECT id FROM public.projects WHERE name = 'Meeting Note Actions' AND archived_at IS NULL);
