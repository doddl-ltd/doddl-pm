-- ================================================================
-- update-bundle-box-project-header-dates
-- ================================================================
-- Re-syncs the Bundle Box Launch project header (id ...0007)
-- start_date / due_date to the active task date range.
--
-- Computed from active tasks (status != 'done', parent group not archived):
--   MIN(start_date) = 2026-04-19  (UK Influencer shortlist + post-purchase page)
--   MAX(due_date)   = 2026-07-01  (US/UK Influencer go-live)
--
-- Idempotent: single UPDATE keyed by id.
-- ================================================================

BEGIN;

UPDATE projects SET
  start_date = '2026-04-19',
  due_date   = '2026-07-01'
WHERE id = '10000000-0000-0000-0000-000000000007';

COMMIT;
