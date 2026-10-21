-- 22-restore-cat-projects
--
-- Jon, 2026-10-21, after 21-clear-down-projects: "can i undo these projects ... Cat's Bib NPD
-- plan ... and NPD - Chopsticks".
--
-- Brings each project back with exactly the tasks and task groups that 21 archived with it:
-- rows carrying the project's own archived_at timestamp. Anything archived earlier (deleted
-- by hand before the clear-down) stays archived. Notifications 21 marked read stay read.
--
-- Idempotent: a project that is already live is skipped.

DO $$
DECLARE
  ids uuid[] := ARRAY[
    'a3106a19-c683-4145-bff2-0ad67fba7456', -- Bib NPD plan (Cat)
    '76bbce1b-076d-4e2e-944a-46fe669a49fe'  -- NPD - Chopsticks (Cat)
  ]::uuid[];
  p record;
  n_tasks int; n_groups int;
BEGIN
  FOR p IN SELECT id, name, archived_at FROM public.projects WHERE id = ANY (ids) AND archived_at IS NOT NULL LOOP
    UPDATE public.tasks SET archived_at = NULL WHERE project_id = p.id AND archived_at = p.archived_at;
    GET DIAGNOSTICS n_tasks = ROW_COUNT;
    UPDATE public.task_groups SET archived_at = NULL WHERE project_id = p.id AND archived_at = p.archived_at;
    GET DIAGNOSTICS n_groups = ROW_COUNT;
    UPDATE public.projects SET archived_at = NULL WHERE id = p.id;
    RAISE NOTICE '22-restore-cat-projects: % restored with % tasks and % groups', p.name, n_tasks, n_groups;
  END LOOP;
END $$;
