-- ================================================================
-- seed-bundle-box-plan
-- ================================================================
-- Replaces the 3 placeholder tasks + 1 placeholder group on project
-- 10000000-0000-0000-0000-000000000007 (Bundle Box Launch) with the
-- full 59-task / 10-group plan from Project_plan_Doddl_March_2026.xlsx.
--
-- Placeholders are ARCHIVED, not deleted (Hard Rule 9):
--   - 3 tasks: status -> 'done'
--   - 1 group: archived_at -> now()    (column added in migration 07)
--
-- Idempotent: UPDATEs are scoped by id, INSERTs use ON CONFLICT DO NOTHING.
-- Re-applying is safe; scripts/safe-apply-migration.js skips anyway based
-- on schema_migrations.
--
-- Post-migration active counts (filters applied by UI):
--   - active task_groups for project: 10   (10 new, 1 archived)
--   - active tasks for project:       59   (59 new, 3 archived)
-- Raw COUNT(*) will read 11 groups and 62 tasks because archival is
-- soft-delete. The UI must filter `archived_at IS NULL` on task_groups
-- and/or `status != 'done'` on tasks to render the "active" view.
-- ================================================================

-- 1. Project header update (active window is today → launch).
UPDATE public.projects SET
  description = 'Full Bundle Box launch plan from the March 2026 project plan. 59 tasks across 10 workstreams: Product Photography, Lifestyle Shoot, Asset Creation, Influencer Sourcing, Website, Organic Social, Email, PR, B2B Partners, Brand Partners.',
  start_date = '2026-04-24',
  due_date = '2026-06-30'
WHERE id = '10000000-0000-0000-0000-000000000007';

-- 2. Archive the 3 placeholder tasks.
UPDATE public.tasks
SET status = 'done'
WHERE id IN (
  '30000000-0000-0000-0000-000000000083',
  '30000000-0000-0000-0000-000000000084',
  '30000000-0000-0000-0000-000000000085'
)
AND project_id = '10000000-0000-0000-0000-000000000007';

-- 3. Archive the 1 placeholder group.
UPDATE public.task_groups
SET archived_at = COALESCE(archived_at, now())
WHERE id = '20000000-0000-0000-0000-000000000023'
  AND project_id = '10000000-0000-0000-0000-000000000007';

-- 4. Insert 10 new task groups.
INSERT INTO public.task_groups (id, project_id, name, position) VALUES
  ('20000000-0000-0000-0000-000000000060', '10000000-0000-0000-0000-000000000007', 'Product Photography & Film', 1),
  ('20000000-0000-0000-0000-000000000061', '10000000-0000-0000-0000-000000000007', 'Lifestyle Shoot', 2),
  ('20000000-0000-0000-0000-000000000062', '10000000-0000-0000-0000-000000000007', 'Asset Creation', 3),
  ('20000000-0000-0000-0000-000000000063', '10000000-0000-0000-0000-000000000007', 'Influencer Sourcing', 4),
  ('20000000-0000-0000-0000-000000000064', '10000000-0000-0000-0000-000000000007', 'Website', 5),
  ('20000000-0000-0000-0000-000000000065', '10000000-0000-0000-0000-000000000007', 'Organic Social', 6),
  ('20000000-0000-0000-0000-000000000066', '10000000-0000-0000-0000-000000000007', 'Email', 7),
  ('20000000-0000-0000-0000-000000000067', '10000000-0000-0000-0000-000000000007', 'PR', 8),
  ('20000000-0000-0000-0000-000000000068', '10000000-0000-0000-0000-000000000007', 'B2B Partners', 9),
  ('20000000-0000-0000-0000-000000000069', '10000000-0000-0000-0000-000000000007', 'Brand Partners & Platforms', 10)
ON CONFLICT (id) DO NOTHING;

-- 5. Insert 59 new tasks.
INSERT INTO public.tasks (id, title, description, status, priority, project_id, group_id, assigned_to, start_date, due_date, notes, position) VALUES
  -- Product Photography & Film (group 60) — 7 tasks
  ('30000000-0000-0000-0000-000000000400', 'Source photographer',                                                      NULL, 'not_started', 'high',     '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000060', 'Laura', '2026-04-24', '2026-05-08', NULL,                                                        1),
  ('30000000-0000-0000-0000-000000000401', 'Build out brief and props',                                                NULL, 'not_started', 'high',     '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000060', 'Laura', '2026-04-24', '2026-05-08', 'Lifestyle and product',                                     2),
  ('30000000-0000-0000-0000-000000000402', 'Book photographer',                                                        NULL, 'not_started', 'high',     '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000060', 'Laura', '2026-04-24', '2026-05-08', NULL,                                                        3),
  ('30000000-0000-0000-0000-000000000403', 'Send product and props',                                                   NULL, 'not_started', 'medium',   '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000060', 'Laura', '2026-04-24', '2026-05-08', NULL,                                                        4),
  ('30000000-0000-0000-0000-000000000404', 'Photography and film shoot',                                               NULL, 'not_started', 'critical', '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000060', 'Laura', '2026-04-24', '2026-05-08', NULL,                                                        5),
  ('30000000-0000-0000-0000-000000000405', 'Select photos and film to edit colours',                                   NULL, 'not_started', 'medium',   '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000060', 'Laura', '2026-04-24', '2026-05-08', 'Lifestyle and product',                                     6),
  ('30000000-0000-0000-0000-000000000406', 'Colour edit films and images',                                             NULL, 'not_started', 'medium',   '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000060', 'Laura', '2026-04-24', '2026-05-08', 'Nano Banana? If not source someone that can',               7),

  -- Lifestyle Shoot (group 61) — 6 tasks
  ('30000000-0000-0000-0000-000000000407', 'Define lifestyle shoot brief',                                             NULL, 'not_started', 'high',     '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000061', 'Laura', '2026-04-24', '2026-05-08', 'Bib/2-in-1 plate/selection of colours (Bundle boxes)',      1),
  ('30000000-0000-0000-0000-000000000408', 'Source photographer and videographer',                                     NULL, 'not_started', 'high',     '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000061', 'Laura', '2026-04-24', '2026-05-08', NULL,                                                        2),
  ('30000000-0000-0000-0000-000000000409', 'Source location',                                                          NULL, 'not_started', 'high',     '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000061', 'Laura', '2026-04-24', '2026-05-08', NULL,                                                        3),
  ('30000000-0000-0000-0000-000000000410', 'Source participants',                                                      NULL, 'not_started', 'medium',   '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000061', 'Laura', '2026-04-24', '2026-05-08', NULL,                                                        4),
  ('30000000-0000-0000-0000-000000000411', 'Film shoot',                                                               NULL, 'not_started', 'critical', '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000061', 'Laura', '2026-04-24', '2026-05-08', NULL,                                                        5),
  ('30000000-0000-0000-0000-000000000412', 'Post production — assets ready',                                           NULL, 'not_started', 'high',     '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000061', 'Laura', '2026-04-24', '2026-05-08', NULL,                                                        6),

  -- Asset Creation (group 62) — 8 tasks
  ('30000000-0000-0000-0000-000000000413', 'Amazon requirements list',                                                 NULL, 'not_started', 'high',     '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000062', 'Laura', '2026-04-24', '2026-05-08', NULL,                                                        1),
  ('30000000-0000-0000-0000-000000000414', 'Amazon asset creation',                                                    NULL, 'not_started', 'high',     '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000062', 'Laura', '2026-04-24', '2026-05-08', NULL,                                                        2),
  ('30000000-0000-0000-0000-000000000415', 'Website requirement list',                                                 NULL, 'not_started', 'high',     '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000062', 'Laura', '2026-04-24', '2026-05-08', NULL,                                                        3),
  ('30000000-0000-0000-0000-000000000416', 'Instagram library creation',                                               NULL, 'not_started', 'medium',   '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000062', 'Laura', '2026-04-24', '2026-05-08', NULL,                                                        4),
  ('30000000-0000-0000-0000-000000000417', 'TikTok library creation',                                                  NULL, 'not_started', 'medium',   '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000062', 'Laura', '2026-04-24', '2026-05-08', NULL,                                                        5),
  ('30000000-0000-0000-0000-000000000418', 'Email asset requirements',                                                 NULL, 'not_started', 'medium',   '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000062', 'Laura', '2026-04-24', '2026-05-08', NULL,                                                        6),
  ('30000000-0000-0000-0000-000000000419', 'Paid ad brief creation for Meta and TikTok — requirements list',           NULL, 'not_started', 'high',     '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000062', 'Laura', '2026-04-24', '2026-05-08', NULL,                                                        7),
  ('30000000-0000-0000-0000-000000000420', 'Paid ad creation for launch campaign',                                     NULL, 'not_started', 'high',     '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000062', 'Laura', '2026-04-24', '2026-05-08', NULL,                                                        8),

  -- Influencer Sourcing (group 63) — 11 tasks
  ('30000000-0000-0000-0000-000000000421', 'US — Engage Momfluence full outline brief',                                NULL, 'not_started', 'high',     '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000063', 'Laura', '2026-04-24', '2026-05-08', NULL,                                                        1),
  ('30000000-0000-0000-0000-000000000422', 'US — Shortlist influencers',                                               NULL, 'not_started', 'high',     '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000063', 'Laura', '2026-04-24', '2026-05-08', NULL,                                                        2),
  ('30000000-0000-0000-0000-000000000423', 'US — Send products to influencers',                                        NULL, 'not_started', 'medium',   '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000063', 'Laura', '2026-04-24', '2026-05-08', NULL,                                                        3),
  ('30000000-0000-0000-0000-000000000424', 'US — Content generation',                                                  NULL, 'not_started', 'medium',   '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000063', 'Laura', '2026-04-24', '2026-05-08', NULL,                                                        4),
  ('30000000-0000-0000-0000-000000000425', 'US — Influencer posting',                                                  NULL, 'not_started', 'medium',   '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000063', 'Laura', '2026-04-24', '2026-05-08', NULL,                                                        5),
  ('30000000-0000-0000-0000-000000000426', 'UK — Influencer shortlist',                                                NULL, 'not_started', 'high',     '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000063', 'Laura', '2026-04-24', '2026-05-08', 'Include grandparents targets',                              6),
  ('30000000-0000-0000-0000-000000000427', 'UK — Influencer brief creation',                                           NULL, 'not_started', 'high',     '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000063', 'Laura', '2026-04-24', '2026-05-08', 'Agree budget before outreach',                              7),
  ('30000000-0000-0000-0000-000000000428', 'UK — Influencer outreach',                                                 NULL, 'not_started', 'high',     '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000063', 'Laura', '2026-04-24', '2026-05-08', NULL,                                                        8),
  ('30000000-0000-0000-0000-000000000429', 'UK — Influencer product send',                                             NULL, 'not_started', 'medium',   '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000063', 'Laura', '2026-04-24', '2026-05-08', NULL,                                                        9),
  ('30000000-0000-0000-0000-000000000430', 'UK — Content received from influencers',                                   NULL, 'not_started', 'medium',   '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000063', 'Laura', '2026-04-24', '2026-05-08', NULL,                                                        10),
  ('30000000-0000-0000-0000-000000000431', 'UK — Influencer posting goes live',                                        NULL, 'not_started', 'medium',   '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000063', 'Laura', '2026-04-24', '2026-05-08', NULL,                                                        11),

  -- Website (group 64) — 5 tasks
  ('30000000-0000-0000-0000-000000000432', 'Create post-purchase campaign page',                                       NULL, 'not_started', 'critical', '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000064', 'Jon',   '2026-04-24', '2026-05-08', 'QR link from postcards inside bundle box',                  1),
  ('30000000-0000-0000-0000-000000000433', 'Create coming soon page with email sign-up',                               NULL, 'not_started', 'high',     '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000064', 'Jon',   '2026-04-24', '2026-05-08', 'Create email capture form',                                 2),
  ('30000000-0000-0000-0000-000000000434', 'Create campaign page copy and structure',                                  NULL, 'not_started', 'high',     '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000064', 'Laura', '2026-04-24', '2026-05-08', NULL,                                                        3),
  ('30000000-0000-0000-0000-000000000435', 'Build campaign page',                                                      NULL, 'not_started', 'high',     '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000064', 'Jon',   '2026-04-24', '2026-05-08', NULL,                                                        4),
  ('30000000-0000-0000-0000-000000000436', 'Re-skin website for launch',                                               NULL, 'not_started', 'medium',   '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000064', 'Jon',   '2026-04-24', '2026-05-08', 'Additional imagery, film, assets etc',                      5),

  -- Organic Social (group 65) — 4 tasks
  ('30000000-0000-0000-0000-000000000437', 'Prepare launch assets — month 1 content and schedule posts',               NULL, 'not_started', 'high',     '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000065', 'Laura', '2026-04-24', '2026-05-08', NULL,                                                        1),
  ('30000000-0000-0000-0000-000000000438', 'Teaser content',                                                           NULL, 'not_started', 'high',     '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000065', 'Laura', '2026-04-24', '2026-05-08', NULL,                                                        2),
  ('30000000-0000-0000-0000-000000000439', 'Colour reveal post',                                                       NULL, 'not_started', 'high',     '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000065', 'Laura', '2026-04-24', '2026-05-08', NULL,                                                        3),
  ('30000000-0000-0000-0000-000000000440', 'Launch day social content goes live',                                      NULL, 'not_started', 'critical', '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000065', 'Laura', '2026-04-24', '2026-05-08', NULL,                                                        4),

  -- Email (group 66) — 3 tasks
  ('30000000-0000-0000-0000-000000000441', 'Create Flow A — returning customers',                                      NULL, 'not_started', 'high',     '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000066', 'Laura', '2026-04-24', '2026-05-08', NULL,                                                        1),
  ('30000000-0000-0000-0000-000000000442', 'Create Flow B — grandparents and gifters',                                 NULL, 'not_started', 'high',     '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000066', 'Laura', '2026-04-24', '2026-05-08', 'Agree segmentation approach before building',               2),
  ('30000000-0000-0000-0000-000000000443', 'Create Flow C — new parents',                                              NULL, 'not_started', 'high',     '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000066', 'Laura', '2026-04-24', '2026-05-08', NULL,                                                        3),

  -- PR (group 67) — 6 tasks
  ('30000000-0000-0000-0000-000000000444', 'PR — complete journey pitch',                                              NULL, 'not_started', 'medium',   '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000067', 'Laura', '2026-04-24', '2026-05-08', NULL,                                                        1),
  ('30000000-0000-0000-0000-000000000445', 'PR — gifting angle',                                                       NULL, 'not_started', 'medium',   '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000067', 'Laura', '2026-04-24', '2026-05-08', NULL,                                                        2),
  ('30000000-0000-0000-0000-000000000446', 'PR — colour exclusive story',                                              NULL, 'not_started', 'medium',   '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000067', 'Laura', '2026-04-24', '2026-05-08', NULL,                                                        3),
  ('30000000-0000-0000-0000-000000000447', 'Press gifting — identify 5 journalists and send bundles',                  NULL, 'not_started', 'high',     '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000067', 'Laura', '2026-04-24', '2026-05-08', NULL,                                                        4),
  ('30000000-0000-0000-0000-000000000448', 'Christmas gift guide push — scope and plan',                               NULL, 'not_started', 'medium',   '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000067', 'Laura', '2026-04-24', '2026-05-08', NULL,                                                        5),
  ('30000000-0000-0000-0000-000000000449', 'Nursery research PR angle',                                                NULL, 'not_started', 'medium',   '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000067', 'Laura', '2026-04-24', '2026-05-08', NULL,                                                        6),

  -- B2B Partners (group 68) — 3 tasks
  ('30000000-0000-0000-0000-000000000450', 'Share presentation and set up calls with B2B partners',                    NULL, 'not_started', 'medium',   '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000068', 'Jon',   '2026-04-24', '2026-05-08', 'Singapore, Poland — international distributors',            1),
  ('30000000-0000-0000-0000-000000000451', 'Define what assets are needed from B2B partners',                          NULL, 'not_started', 'medium',   '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000068', 'Jon',   '2026-04-24', '2026-05-08', 'Taiwan, Korea',                                             2),
  ('30000000-0000-0000-0000-000000000452', 'Share assets with B2B partners',                                           NULL, 'not_started', 'medium',   '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000068', 'Jon',   '2026-04-24', '2026-05-08', NULL,                                                        3),

  -- Brand Partners & Platforms (group 69) — 6 tasks
  ('30000000-0000-0000-0000-000000000453', 'Source brands for competitions at launch',                                 NULL, 'not_started', 'medium',   '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000069', 'Laura', '2026-04-24', '2026-05-08', 'US and UK',                                                 1),
  ('30000000-0000-0000-0000-000000000454', 'Brand competition shortlist',                                              NULL, 'not_started', 'medium',   '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000069', 'Laura', '2026-04-24', '2026-05-08', 'US and UK',                                                 2),
  ('30000000-0000-0000-0000-000000000455', 'Launch competitions',                                                      NULL, 'not_started', 'medium',   '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000069', 'Laura', '2026-04-24', '2026-05-08', 'US and UK',                                                 3),
  ('30000000-0000-0000-0000-000000000456', 'Engage and update expert partners',                                        NULL, 'not_started', 'medium',   '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000069', 'Laura', '2026-04-24', '2026-05-08', 'US and UK',                                                 4),
  ('30000000-0000-0000-0000-000000000457', 'Network seeding research — Mumsnet, NCT, Reddit, US parent groups, grandparent groups', NULL, 'not_started', 'medium',   '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000069', 'Laura', '2026-04-24', '2026-05-08', 'Identify best channels for US and UK',                      5),
  ('30000000-0000-0000-0000-000000000458', 'Network seeding begins',                                                   NULL, 'not_started', 'medium',   '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000069', 'Laura', '2026-04-24', '2026-05-08', NULL,                                                        6)
ON CONFLICT (id) DO NOTHING;
