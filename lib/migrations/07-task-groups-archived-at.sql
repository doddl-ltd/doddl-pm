-- ================================================================
-- 07-task-groups-archived-at
-- ================================================================
-- Adds archived_at to task_groups for soft-delete/archival support.
-- Required because Hard Rule 9 bans DELETE from task_groups; archival
-- is the compliant way to remove a group from the active plan.
--
-- Pure DDL. Idempotent via ADD COLUMN IF NOT EXISTS.
-- ================================================================

ALTER TABLE public.task_groups
  ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL;

COMMENT ON COLUMN public.task_groups.archived_at IS
  'Soft-delete marker. Rows with archived_at IS NOT NULL are archived and should be hidden from the live UI.';
