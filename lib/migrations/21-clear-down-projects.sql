-- 21-clear-down-projects
--
-- Jon, 2026-10-21: "now clear down all my projects, so my constants (cannot delete) are
-- Adhoc Teams / Emails Tasks - Meeting Note Actions - plus the doddl PM roll-out project
-- leave those. The rest can be delete from the org views."
--
-- Archives (soft delete, Hard Rule 9: nothing is deleted) the 17 other live projects,
-- every live task and task group in them, and marks read the unread notifications that
-- point at those tasks. This is what "Delete project" in the UI does; the agent layer can
-- archive a project but not its tasks, which would leave them in My Work.
--
-- Kept live: Adhoc Teams / Emails Tasks (4f19b2dd-2841-42a6-9d61-69cfbc351afa),
-- Meeting Note Actions (8c843a34-69d2-4e29-a8ea-63845e8a0923) and
-- doddl PM roll-out (b2232e56-2927-4cc3-bc7b-7dd24e82b4d1).
--
-- Every row gets the same archived_at, so a project comes back as a unit: a new migration
-- sets archived_at = NULL on the project and on its tasks and groups carrying that timestamp.
--
-- Projects are listed by id, not "everything but three", so a project created after this
-- was written is never caught. Idempotent: only rows that are still live are touched.

DO $$
DECLARE
  ts  timestamptz := now();
  ids uuid[] := ARRAY[
    '10000000-0000-0000-0000-000000000002', -- AI OS — Phase 0: Infrastructure & Compliance
    '10000000-0000-0000-0000-000000000003', -- AI OS — Phase 1: Data Pipeline
    '10000000-0000-0000-0000-000000000004', -- AI OS — Phase 2: Intelligence Layer
    '10000000-0000-0000-0000-000000000005', -- AI OS — Phase 3: Specialist Agents
    '10000000-0000-0000-0000-000000000006', -- AI OS — Phase 4: Creative AI Stack
    '0ec070ad-65cb-40f5-9cec-5ec049c4679d', -- Analytics Hub & Data Warehouse
    'a3106a19-c683-4145-bff2-0ad67fba7456', -- Bib NPD plan (Cat)
    '2abda921-2225-46e3-8e31-2b9a4a0db1de', -- Big Fixes & Issues
    '10000000-0000-0000-0000-000000000007', -- Bundle Box Launch
    '10000000-0000-0000-0000-000000000011', -- Business Operations — Q2 2026
    '10000000-0000-0000-0000-000000000009', -- Developmental Journey — Website (Laura)
    '1ee7a0ed-7c87-4b85-b83b-4a15882450bc', -- Klaviyo CRM Rebuild
    '76bbce1b-076d-4e2e-944a-46fe669a49fe', -- NPD - Chopsticks (Cat)
    'b097d57a-dbf9-4092-ad03-710ff8926f60', -- Paid Media & Social
    '10000000-0000-0000-0000-000000000001', -- PM Tool Build
    '10000000-0000-0000-0000-000000000008', -- Subscription & Dinner Club
    'e3fbe19d-f447-4d0b-aff0-f4bbca86f13b'  -- Website - Refresh
  ]::uuid[];
  n_notifs int; n_tasks int; n_groups int; n_projects int;
BEGIN
  UPDATE public.notifications SET read = true
   WHERE read = false
     AND task_id IN (SELECT id FROM public.tasks WHERE project_id = ANY (ids) AND archived_at IS NULL);
  GET DIAGNOSTICS n_notifs = ROW_COUNT;

  UPDATE public.tasks SET archived_at = ts WHERE project_id = ANY (ids) AND archived_at IS NULL;
  GET DIAGNOSTICS n_tasks = ROW_COUNT;

  UPDATE public.task_groups SET archived_at = ts WHERE project_id = ANY (ids) AND archived_at IS NULL;
  GET DIAGNOSTICS n_groups = ROW_COUNT;

  UPDATE public.projects SET archived_at = ts WHERE id = ANY (ids) AND archived_at IS NULL;
  GET DIAGNOSTICS n_projects = ROW_COUNT;

  RAISE NOTICE '21-clear-down-projects: % projects, % tasks, % groups archived at %; % notifications marked read',
    n_projects, n_tasks, n_groups, ts, n_notifs;
END $$;
