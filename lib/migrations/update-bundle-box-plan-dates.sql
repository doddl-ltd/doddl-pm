-- ================================================================
-- update-bundle-box-plan-dates
-- ================================================================
-- Re-maps start_date and due_date on the 59 Bundle Box Launch tasks
-- (project 10000000-0000-0000-0000-000000000007) to the corrected
-- positions from Project_plan_Doddl_March_2026.xlsx.
--
-- Idempotent: every statement is an UPDATE keyed by task id, so re-applying
-- yields the same end state. No deletes, no inserts, no group changes,
-- no project-header changes.
-- ================================================================

BEGIN;

-- Source photographer
UPDATE tasks SET start_date = '2026-04-26', due_date = '2026-04-26' WHERE id = '30000000-0000-0000-0000-000000000400';

-- Build out brief and props
UPDATE tasks SET start_date = '2026-04-26', due_date = '2026-04-26' WHERE id = '30000000-0000-0000-0000-000000000401';

-- Book photographer
UPDATE tasks SET start_date = '2026-04-26', due_date = '2026-04-26' WHERE id = '30000000-0000-0000-0000-000000000402';

-- Send product and props
UPDATE tasks SET start_date = '2026-04-30', due_date = '2026-04-30' WHERE id = '30000000-0000-0000-0000-000000000403';

-- Photography and film shoot
UPDATE tasks SET start_date = '2026-05-06', due_date = '2026-05-06' WHERE id = '30000000-0000-0000-0000-000000000404';

-- Select photos and film to edit colours
UPDATE tasks SET start_date = '2026-05-27', due_date = '2026-05-27' WHERE id = '30000000-0000-0000-0000-000000000405';

-- Colour edit films and images
UPDATE tasks SET start_date = '2026-05-27', due_date = '2026-06-04' WHERE id = '30000000-0000-0000-0000-000000000406';

-- Define lifestyle shoot brief
UPDATE tasks SET start_date = '2026-04-26', due_date = '2026-04-26' WHERE id = '30000000-0000-0000-0000-000000000407';

-- Source photographer and videographer
UPDATE tasks SET start_date = '2026-04-30', due_date = '2026-05-06' WHERE id = '30000000-0000-0000-0000-000000000408';

-- Source location
UPDATE tasks SET start_date = '2026-05-13', due_date = '2026-05-20' WHERE id = '30000000-0000-0000-0000-000000000409';

-- Source participants
UPDATE tasks SET start_date = '2026-05-20', due_date = '2026-06-11' WHERE id = '30000000-0000-0000-0000-000000000410';

-- Film shoot
UPDATE tasks SET start_date = '2026-06-04', due_date = '2026-06-04' WHERE id = '30000000-0000-0000-0000-000000000411';

-- Post production — assets ready
UPDATE tasks SET start_date = '2026-06-11', due_date = '2026-06-18' WHERE id = '30000000-0000-0000-0000-000000000412';

-- Amazon requirements list
UPDATE tasks SET start_date = '2026-04-26', due_date = '2026-04-26' WHERE id = '30000000-0000-0000-0000-000000000413';

-- Amazon asset creation
UPDATE tasks SET start_date = '2026-05-20', due_date = '2026-06-11' WHERE id = '30000000-0000-0000-0000-000000000414';

-- Website requirement list
UPDATE tasks SET start_date = '2026-04-26', due_date = '2026-05-20' WHERE id = '30000000-0000-0000-0000-000000000415';

-- Instagram library creation
UPDATE tasks SET start_date = '2026-05-20', due_date = '2026-05-27' WHERE id = '30000000-0000-0000-0000-000000000416';

-- TikTok library creation
UPDATE tasks SET start_date = '2026-05-20', due_date = '2026-05-27' WHERE id = '30000000-0000-0000-0000-000000000417';

-- Email asset requirements
UPDATE tasks SET start_date = '2026-04-26', due_date = '2026-04-30' WHERE id = '30000000-0000-0000-0000-000000000418';

-- Paid ad brief creation
UPDATE tasks SET start_date = '2026-04-26', due_date = '2026-05-06' WHERE id = '30000000-0000-0000-0000-000000000419';

-- Paid ad creation for campaign
UPDATE tasks SET start_date = '2026-05-27', due_date = '2026-06-18' WHERE id = '30000000-0000-0000-0000-000000000420';

-- US — Engage Momfluence full outline brief
UPDATE tasks SET start_date = '2026-05-06', due_date = '2026-05-06' WHERE id = '30000000-0000-0000-0000-000000000421';

-- US — Shortlist influencers
UPDATE tasks SET start_date = '2026-06-04', due_date = '2026-06-18' WHERE id = '30000000-0000-0000-0000-000000000422';

-- US — Send products to influencers
UPDATE tasks SET start_date = '2026-06-18', due_date = '2026-06-18' WHERE id = '30000000-0000-0000-0000-000000000423';

-- US — Content generation
UPDATE tasks SET start_date = '2026-06-25', due_date = '2026-06-25' WHERE id = '30000000-0000-0000-0000-000000000424';

-- US — Influencer posting
UPDATE tasks SET start_date = '2026-07-01', due_date = '2026-07-01' WHERE id = '30000000-0000-0000-0000-000000000425';

-- UK — Influencer shortlist
UPDATE tasks SET start_date = '2026-04-19', due_date = '2026-04-30' WHERE id = '30000000-0000-0000-0000-000000000426';

-- UK — Influencer brief creation
UPDATE tasks SET start_date = '2026-04-26', due_date = '2026-04-26' WHERE id = '30000000-0000-0000-0000-000000000427';

-- UK — Influencer outreach
UPDATE tasks SET start_date = '2026-05-06', due_date = '2026-05-27' WHERE id = '30000000-0000-0000-0000-000000000428';

-- UK — Influencer product send
UPDATE tasks SET start_date = '2026-06-18', due_date = '2026-06-18' WHERE id = '30000000-0000-0000-0000-000000000429';

-- UK — Content received
UPDATE tasks SET start_date = '2026-06-25', due_date = '2026-06-25' WHERE id = '30000000-0000-0000-0000-000000000430';

-- UK — Influencer posting goes live
UPDATE tasks SET start_date = '2026-07-01', due_date = '2026-07-01' WHERE id = '30000000-0000-0000-0000-000000000431';

-- Create post-purchase campaign page
UPDATE tasks SET start_date = '2026-04-19', due_date = '2026-04-26' WHERE id = '30000000-0000-0000-0000-000000000432';

-- Create coming soon page
UPDATE tasks SET start_date = '2026-05-13', due_date = '2026-05-20' WHERE id = '30000000-0000-0000-0000-000000000433';

-- Create campaign page copy
UPDATE tasks SET start_date = '2026-05-06', due_date = '2026-05-06' WHERE id = '30000000-0000-0000-0000-000000000434';

-- Build campaign page
UPDATE tasks SET start_date = '2026-05-06', due_date = '2026-05-13' WHERE id = '30000000-0000-0000-0000-000000000435';

-- Re-skin website for launch
UPDATE tasks SET start_date = '2026-06-04', due_date = '2026-06-04' WHERE id = '30000000-0000-0000-0000-000000000436';

-- Prepare launch assets
UPDATE tasks SET start_date = '2026-05-20', due_date = '2026-06-18' WHERE id = '30000000-0000-0000-0000-000000000437';

-- Teaser content
UPDATE tasks SET start_date = '2026-05-20', due_date = '2026-05-20' WHERE id = '30000000-0000-0000-0000-000000000438';

-- Colour reveal post
UPDATE tasks SET start_date = '2026-05-20', due_date = '2026-05-27' WHERE id = '30000000-0000-0000-0000-000000000439';

-- Launch day social content
UPDATE tasks SET start_date = '2026-06-04', due_date = '2026-06-04' WHERE id = '30000000-0000-0000-0000-000000000440';

-- Create Flow A — returning customers
UPDATE tasks SET start_date = '2026-05-27', due_date = '2026-06-11' WHERE id = '30000000-0000-0000-0000-000000000441';

-- Create Flow B — grandparents and gifters
UPDATE tasks SET start_date = '2026-05-13', due_date = '2026-05-20' WHERE id = '30000000-0000-0000-0000-000000000442';

-- Create Flow C — new parents
UPDATE tasks SET start_date = '2026-04-26', due_date = '2026-04-30' WHERE id = '30000000-0000-0000-0000-000000000443';

-- PR — complete journey pitch
UPDATE tasks SET start_date = '2026-05-13', due_date = '2026-05-20' WHERE id = '30000000-0000-0000-0000-000000000444';

-- PR — gifting angle
UPDATE tasks SET start_date = '2026-05-13', due_date = '2026-05-20' WHERE id = '30000000-0000-0000-0000-000000000445';

-- PR — colour exclusive story
UPDATE tasks SET start_date = '2026-05-13', due_date = '2026-05-20' WHERE id = '30000000-0000-0000-0000-000000000446';

-- Press gifting
UPDATE tasks SET start_date = '2026-06-18', due_date = '2026-06-18' WHERE id = '30000000-0000-0000-0000-000000000447';

-- Christmas gift guide push
UPDATE tasks SET start_date = '2026-06-25', due_date = '2026-06-25' WHERE id = '30000000-0000-0000-0000-000000000448';

-- Nursery research PR angle
UPDATE tasks SET start_date = '2026-06-25', due_date = '2026-06-25' WHERE id = '30000000-0000-0000-0000-000000000449';

-- Share presentation — B2B partners
UPDATE tasks SET start_date = '2026-05-27', due_date = '2026-06-04' WHERE id = '30000000-0000-0000-0000-000000000450';

-- Define assets needed from partners
UPDATE tasks SET start_date = '2026-04-26', due_date = '2026-04-30' WHERE id = '30000000-0000-0000-0000-000000000451';

-- Share assets with B2B partners
UPDATE tasks SET start_date = '2026-06-04', due_date = '2026-06-11' WHERE id = '30000000-0000-0000-0000-000000000452';

-- Source brands for competitions
UPDATE tasks SET start_date = '2026-05-06', due_date = '2026-05-13' WHERE id = '30000000-0000-0000-0000-000000000453';

-- Brand competition shortlist
UPDATE tasks SET start_date = '2026-05-20', due_date = '2026-06-04' WHERE id = '30000000-0000-0000-0000-000000000454';

-- Launch competitions
UPDATE tasks SET start_date = '2026-06-11', due_date = '2026-06-11' WHERE id = '30000000-0000-0000-0000-000000000455';

-- Engage expert partners
UPDATE tasks SET start_date = '2026-05-27', due_date = '2026-06-04' WHERE id = '30000000-0000-0000-0000-000000000456';

-- Network seeding research
UPDATE tasks SET start_date = '2026-05-27', due_date = '2026-06-04' WHERE id = '30000000-0000-0000-0000-000000000457';

-- Network seeding begins
UPDATE tasks SET start_date = '2026-06-11', due_date = '2026-06-11' WHERE id = '30000000-0000-0000-0000-000000000458';

COMMIT;
