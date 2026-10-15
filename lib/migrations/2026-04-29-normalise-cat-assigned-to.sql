-- ================================================================
-- 2026-04-29-normalise-cat-assigned-to
-- ================================================================
-- Production has dirty `tasks.assigned_to` values that prevent Cat
-- (catherine@doddl.com → resolved to display name "Cat" in the UI)
-- from seeing tasks assigned to her. Normalises:
--
--   "Catherine" -> "Cat"   (2 rows: PM Tool Build go-live gate,
--                           AI OS Phase 0 P0-17 SP-API task)
--   ""          -> NULL    (2 rows in "Test - Live" project)
--
-- The UI compares t.assigned_to.toLowerCase() === userName.toLowerCase()
-- across MyWorkView, MyProjectsView, and the sidebar badge. After this
-- migration all of Cat's assigned tasks resolve consistently.
--
-- Idempotent: re-applying is a no-op once values are normalised.
-- Safe: only touches assigned_to, no DELETE/TRUNCATE.
-- ================================================================

BEGIN;

UPDATE tasks SET assigned_to = 'Cat'
WHERE assigned_to = 'Catherine';

UPDATE tasks SET assigned_to = NULL
WHERE assigned_to = '';

COMMIT;
