-- Migration: 13-phase0-phase1-status-update
-- Purpose:   Mark Phase 0 tasks done and Phase 1 connector tasks to their
--            current delivery state (done / in_progress / blocked) as of
--            2026-05-26.
-- Idempotent: yes — UPDATEs are safe to re-run; no inserts or deletes.
-- Author:    Jon Fawcett / Claude
-- Date:      2026-05-26

SELECT backup_before_migration('13-phase0-phase1-status-update');

-- PHASE 0: Mark all 22 tasks done (completed 6 May 2026)
UPDATE tasks SET status = 'done', progress = 100
WHERE project_id = '10000000-0000-0000-0000-000000000002';

-- PHASE 1: Mark fully complete connectors done
UPDATE tasks SET status = 'done', progress = 100
WHERE project_id = '10000000-0000-0000-0000-000000000003'
AND title IN (
  'P1-1: Amazon SP-API connector — UK marketplace',
  'P1-2: Amazon SP-API connector — US marketplace',
  'P1-3: Amazon SP-API connector — CA marketplace',
  'P1-4: Amazon SP-API connector — EU marketplace',
  'P1-7: Shopify connector',
  'P1-9: Meta Ads connector',
  'P1-10: Klaviyo connector'
);

-- PHASE 1: Mark GA4 in progress
UPDATE tasks SET status = 'in_progress', progress = 60
WHERE project_id = '10000000-0000-0000-0000-000000000003'
AND title = 'P1-8: Google Ads connector';

-- PHASE 1: Mark blocked connectors
UPDATE tasks SET status = 'blocked', progress = 0
WHERE project_id = '10000000-0000-0000-0000-000000000003'
AND title IN (
  'P1-6: Amazon Ads connector',
  'P1-5: Amazon SP-API connector — JP marketplace'
);

-- PHASE 0: Mark project itself active
UPDATE projects SET status = 'active'
WHERE id = '10000000-0000-0000-0000-000000000002';

-- VERIFY
SELECT title, status, progress
FROM tasks
WHERE project_id IN (
  '10000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000003'
)
ORDER BY project_id, title;
