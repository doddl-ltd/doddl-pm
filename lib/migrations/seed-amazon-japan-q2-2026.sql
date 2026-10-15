-- ================================================================
-- seed-amazon-japan-q2-2026
-- ================================================================
-- Adds the Amazon Japan — Scale Plan Q2 2026 project with 5 task
-- groups and 22 tasks. Staging-only delivery for now (plan starts
-- 2026-04-23, 90-day horizon ending 2026-07-23).
--
-- Notes on value normalisation (status / priority):
--   CHECK constraints require lowercase: 'not_started' / 'high' / etc.
--   The user-facing prompt used 'Not Started' / 'Critical' etc.; those
--   are stored lowercase here and re-cased in the UI layer.
--
-- Project status mapping:
--   Prompt said status='Not Started' for the project. The projects.status
--   CHECK allows only 'active' | 'on_hold' | 'completed' | 'archived'.
--   Plan kicks off today, so stored as 'active'.
--
-- depends_on is a single uuid referencing tasks.id. Task-number
-- dependencies from the prompt are mapped to UUIDs inline.
--
-- Idempotent via ON CONFLICT (id) DO NOTHING.
-- ================================================================

-- 1. Project
INSERT INTO public.projects (id, name, description, status, priority, owner, start_date, due_date) VALUES
  (
    '10000000-0000-0000-0000-000000000012',
    'Amazon Japan — Scale Plan Q2 2026',
    '90-day plan to grow Japan from ¥771K/mo (~£4.1k) to ¥1.28–1.5M/mo (~£6.8–8k). Concentrate spend on the Global SKU (B0779CZ9FD) as structural defence against copycat B0D3ZTLWYB. Cull 41 underperforming SKUs. Reallocate ad spend from money-losing campaigns to proven generic terms + branded misspellings. Distributor owns Amazon JP account.',
    'active',
    'high',
    'Jon',
    '2026-04-23',
    '2026-07-23'
  )
ON CONFLICT (id) DO NOTHING;

-- 2. Task groups (5)
INSERT INTO public.task_groups (id, project_id, name, position) VALUES
  ('20000000-0000-0000-0000-000000000070', '10000000-0000-0000-0000-000000000012', 'Critical-path blockers (Week 1)',                            1),
  ('20000000-0000-0000-0000-000000000071', '10000000-0000-0000-0000-000000000012', 'Ad kills (Week 1, immediate)',                                2),
  ('20000000-0000-0000-0000-000000000072', '10000000-0000-0000-0000-000000000012', 'Ad scale & restructure (Week 1–2)',                           3),
  ('20000000-0000-0000-0000-000000000073', '10000000-0000-0000-0000-000000000012', 'SKU cull Phase 1 (Week 2, after distributor sign-off)',       4),
  ('20000000-0000-0000-0000-000000000074', '10000000-0000-0000-0000-000000000012', 'Listing CRO + Phase 2 strategic (Weeks 2–4 onward)',          5)
ON CONFLICT (id) DO NOTHING;

-- 3. Tasks (22)
INSERT INTO public.tasks (id, title, description, status, priority, project_id, group_id, assigned_to, start_date, due_date, progress, depends_on, notes, position) VALUES
  -- Group 1 — Critical-path blockers (3 tasks)
  ('30000000-0000-0000-0000-000000000500',
   'Confirm JP Brand Registry ownership with distributor',
   NULL, 'not_started', 'critical',
   '10000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000070',
   'Jon', '2026-04-23', '2026-04-26', 0, NULL,
   'Blocks all listing-level work (A+ content, image updates, Vine, Stores). Must clarify whether doddl or distributor holds Brand Registry for the JP marketplace.',
   1),

  ('30000000-0000-0000-0000-000000000501',
   'Confirm B0779CZ9FD stock cover + reorder lead time',
   NULL, 'not_started', 'critical',
   '10000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000070',
   'Jon', '2026-04-23', '2026-04-25', 0, NULL,
   'Global SKU run-rate ~100 units/mo and rising. Pushing demand into a stockout kills the entire plan. Need: current FBA JP units on hand, reorder cadence, UK→JP lead time.',
   2),

  ('30000000-0000-0000-0000-000000000502',
   'Get distributor sign-off on Phase 1 SKU cull (41 SKUs)',
   NULL, 'not_started', 'high',
   '10000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000070',
   'Jon', '2026-04-23', '2026-04-28', 0, NULL,
   'Frame as ''zero-revenue cleanup'' not ''strategic restructure''. 41 SKUs delisted: 4× 2pc mega bundle, 6× 3pc mega bundle, 3× 3pc + Case, 2× 2pc + Plate, 1× 3pc + Plate, 1× Bowl-only, 17 of 18 Plate-only, 5× EasyTots, 3× Diaper cake. All did ¥0 or near-zero in April.',
   3),

  -- Group 2 — Ad kills (5 tasks)
  ('30000000-0000-0000-0000-000000000503',
   'Pause SBV | 2 Piece campaign',
   NULL, 'not_started', 'high',
   '10000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000071',
   'Jon', '2026-04-23', '2026-04-24', 0, NULL,
   'Spending ~¥6,300/mo, 0 sales, 0 ROAS. Kill today.',
   1),

  ('30000000-0000-0000-0000-000000000504',
   'Pause JP_SP_KW_Broad_2_Piece_Toddler_Research',
   NULL, 'not_started', 'high',
   '10000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000071',
   'Jon', '2026-04-23', '2026-04-24', 0, NULL,
   '¥930/mo, 0 sales. Premature broad-match research before core terms validated.',
   2),

  ('30000000-0000-0000-0000-000000000505',
   'Pause JP_SP_KW_Exact + Phrase Core (¥0 sales)',
   NULL, 'not_started', 'high',
   '10000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000071',
   'Jon', '2026-04-23', '2026-04-24', 0, NULL,
   'Combined ~¥285/mo, 0 sales. Wrong targeting — kill and rebuild under task 9.',
   3),

  ('30000000-0000-0000-0000-000000000506',
   'Pause JP_SP_PT_Competitors targeting B0D3ZTLWYB',
   NULL, 'not_started', 'high',
   '10000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000071',
   'Jon', '2026-04-23', '2026-04-24', 0, NULL,
   'Spending ¥11,540/mo for ¥10,500 sales = 0.91 ROAS. Cannot win on copycat''s PDP at their price. Move spend to Global SKU defence.',
   4),

  ('30000000-0000-0000-0000-000000000507',
   'Harvest AUTO_全商品 search terms then pause',
   NULL, 'not_started', 'high',
   '10000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000071',
   'Jon', '2026-04-30', '2026-05-07', 0, '30000000-0000-0000-0000-000000000503',
   'Currently ¥21,000/mo at 1.10 ROAS. Pull 7 days of converting search terms first, migrate winners into manual exact campaigns, then kill the auto.',
   5),

  -- Group 3 — Ad scale & restructure (3 tasks)
  ('30000000-0000-0000-0000-000000000508',
   'Build SP Exact campaign on top 5 generic terms → Global SKU',
   NULL, 'not_started', 'critical',
   '10000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000072',
   'Jon', '2026-04-23', '2026-04-25', 0, NULL,
   'Target B0779CZ9FD. Keywords (all proven 4.5–10x ROAS in current data): 離乳食 スプーン (117K impr / 4.7x), 赤ちゃん スプーン (47K / 4.9x), 赤ちゃん スプーン 自分で (23K / 5.6x), 赤ちゃん スプーン 1歳 (4.5K / 10.5x), スプーン 赤ちゃん (8.6K / 4.5x). Budget ¥3,000/day, CPC cap ¥60. Expected +¥250–300K/mo.',
   1),

  ('30000000-0000-0000-0000-000000000509',
   'Build defensive SP Exact for branded misspellings → Global SKU',
   NULL, 'not_started', 'high',
   '10000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000072',
   'Jon', '2026-04-23', '2026-04-24', 0, NULL,
   'Target B0779CZ9FD. Keywords from search term report: dodle, doddle, どーとる, ドードゥル, ドードル, ドードゥル スプーン, doddl スプーン, doddl スプーン フォーク, doddl スプーン フォーク セット 子供. Budget ¥500/day, CPC cap ¥40. 8x+ ROAS expected.',
   2),

  ('30000000-0000-0000-0000-000000000510',
   'Audit and tighten SB指名 — add negatives, target 6x+ ROAS',
   NULL, 'not_started', 'medium',
   '10000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000072',
   'Jon', '2026-04-30', '2026-05-02', 0, NULL,
   'Currently spending ¥306K/mo at 3.26x ROAS. Branded SB should run 6x+. Pull search term report, add negatives for non-doddl terms, raise CPC floor on true branded. Expected ~¥30K/mo cost saving + tighter brand defence.',
   3),

  -- Group 4 — SKU cull Phase 1 (7 tasks, all depend on task 3)
  ('30000000-0000-0000-0000-000000000511',
   'Delist 4× 2pc mega bundle SKUs (¥0 April)',
   NULL, 'not_started', 'medium',
   '10000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000073',
   'Jon', '2026-04-30', '2026-05-01', 0, '30000000-0000-0000-0000-000000000502',
   'All did ¥0 in April. Bulk flat-file delist. Zero commercial risk.',
   1),

  ('30000000-0000-0000-0000-000000000512',
   'Delist 6× 3pc mega bundle SKUs (¥0 April)',
   NULL, 'not_started', 'medium',
   '10000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000073',
   'Jon', '2026-04-30', '2026-05-01', 0, '30000000-0000-0000-0000-000000000502',
   'All did ¥0 in April. Bulk flat-file delist.',
   2),

  ('30000000-0000-0000-0000-000000000513',
   'Delist 3× 3pc + Case SKUs (confirm not stockout first)',
   NULL, 'not_started', 'medium',
   '10000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000073',
   'Jon', '2026-04-30', '2026-05-01', 0, '30000000-0000-0000-0000-000000000502',
   '¥0 in April but generated ¥77K Feb–Apr. Confirm with distributor whether listing died or stock ran out before delisting.',
   3),

  ('30000000-0000-0000-0000-000000000514',
   'Delist 2× 2pc + Plate, 1× 3pc + Plate, 1× Bowl-only (¥0 April)',
   NULL, 'not_started', 'medium',
   '10000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000073',
   'Jon', '2026-04-30', '2026-05-01', 0, '30000000-0000-0000-0000-000000000502',
   'All did ¥0 in April.',
   4),

  ('30000000-0000-0000-0000-000000000515',
   'Delist 17 of 18 Plate-only SKUs (keep best-seller only)',
   NULL, 'not_started', 'medium',
   '10000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000073',
   'Jon', '2026-04-30', '2026-05-02', 0, '30000000-0000-0000-0000-000000000502',
   '18 SKUs generated ¥7,374 in April (~£40 total). Keep 1 hero colour.',
   5),

  ('30000000-0000-0000-0000-000000000516',
   'Remove EasyTots (5) + Diaper cake (3) SKUs from doddl scope',
   NULL, 'not_started', 'low',
   '10000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000073',
   'Jon', '2026-04-30', '2026-05-01', 0, '30000000-0000-0000-0000-000000000502',
   'Not doddl P&L. Confirm with distributor — they may want them on a separate brand profile.',
   6),

  ('30000000-0000-0000-0000-000000000517',
   'Consolidate 2pc + Case from 3 SKUs to 1 best-seller',
   NULL, 'not_started', 'low',
   '10000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000073',
   'Jon', '2026-05-14', '2026-05-16', 0, '30000000-0000-0000-0000-000000000502',
   '¥173K Feb–Apr is real revenue. Keep the winning colour/config, delist the other two.',
   7),

  -- Group 5 — Listing CRO + Phase 2 (4 tasks)
  ('30000000-0000-0000-0000-000000000518',
   'Engage native JP copywriter for Global SKU A+ content rewrite',
   NULL, 'not_started', 'high',
   '10000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000074',
   'Laura', '2026-04-30', '2026-05-05', 0, '30000000-0000-0000-0000-000000000500',
   'Lead A+ with global review count ("UK/US/EUで◯◯◯件以上のレビュー"). Reinforce 英国発 (from UK) badge in image #1. Add developmental-benefit badge to image #2 (motor skill / independence — high resonance in JP parenting culture). One-off ~£300.',
   1),

  ('30000000-0000-0000-0000-000000000519',
   'Apply A+ updates to B0779CZ9FD listing',
   NULL, 'not_started', 'high',
   '10000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000074',
   'Laura', '2026-05-07', '2026-05-09', 0, '30000000-0000-0000-0000-000000000518',
   'Upload via Brand Registry. Confirm bullets 1–2 reinforce 英国発 + 人間工学デザイン + 1歳〜. Expected CVR lift 6.37% → 7.5%+, +¥30–60K/mo.',
   2),

  ('30000000-0000-0000-0000-000000000520',
   'Roll Global ASIN strategy to 3pc set + 6mo+ set — strategic decision',
   NULL, 'not_started', 'high',
   '10000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000074',
   'Cat', '2026-06-01', '2026-07-01', 0, '30000000-0000-0000-0000-000000000518',
   'Phase 2. After Global SKU performance has been stable for 30+ days, evaluate replicating the same review-pooled architecture for the 3pc cutlery set and the 6mo+ baby set. Both currently rely on JP-only reviews and are vulnerable to the copycat. Expected +¥150–250K/mo on a 90-day horizon.',
   3),

  ('30000000-0000-0000-0000-000000000521',
   'Weekly JP performance review — 30-min Friday cadence',
   NULL, 'not_started', 'medium',
   '10000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000074',
   'Jon', '2026-04-25', '2026-07-24', 0, NULL,
   'Recurring: review Global SKU sessions/CVR, ad spend by campaign, top search terms, copycat activity (B0D3ZTLWYB BSR + price). Flag any drift from plan. Effort = 90 days of recurring 0.5h slots.',
   4)
ON CONFLICT (id) DO NOTHING;
