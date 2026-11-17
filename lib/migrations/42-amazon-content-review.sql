-- Migration: 42-amazon-content-review
-- Description: Amazon content review by Jon and Laura (Jon 2026-11-17: "The A+ content page needs to go to approvals now
-- for Laura & myself to feedback ... Push all of this to approval for Laura & me, once we have approved it push the
-- content live to Amazon"). Every product goes through the same steps:
--
--   A+ page        a person writes the brief; the agent builds the page in doddl's house design from the image library
--                  (lib/pm/aplusHouse.js) and puts it in approvals as one card for Jon and Laura.
--   each store     once the listing agent has translated a store's copy, images and A+ page, one card per store for
--                  Jon and Laura. Approving it approves every piece (the language review) and pushes the store to
--                  Doddl HQ, which makes its usual send card. Nothing reaches Amazon before that.
--
--   approval_rules 'amazon_content'   approver Jon, second approver Laura (both must approve), always single cards.
--   listing_aplus.house               the house-design plan: words, chosen photos, shot list, rendered panels per store
--   listing_aplus.review_task_id      the open review card for the UK page
--
-- Deploy-safe and idempotent: IF NOT EXISTS / ON CONFLICT DO NOTHING only. Nothing is dropped or deleted.

SELECT backup_before_migration('42-amazon-content-review');

INSERT INTO public.approval_rules
  (area, label, what, approver, backup, second_approver, batch_mode, batch_day, reply_by, max_pack, spend_applies, batchable, note, position, updated_by)
VALUES
  ('amazon_content', 'Amazon content review', 'A+ pages, translated copy and images, per store', 'Jon', NULL, 'Laura', 'single', NULL, NULL, NULL, false, false,
   'Always single: one product (or one store of one product) per card. Both Jon and Laura approve.', 3, 'migration 42')
ON CONFLICT (area) DO NOTHING;

INSERT INTO public.approval_rules_log (area, changed_by, change, reason)
SELECT 'amazon_content', 'system', 'Amazon content review set up: Jon and Laura both approve', 'Jon 2026-11-17 (migration 42)'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_rules_log WHERE area = 'amazon_content');

ALTER TABLE public.listing_aplus ADD COLUMN IF NOT EXISTS house jsonb;
ALTER TABLE public.listing_aplus ADD COLUMN IF NOT EXISTS review_task_id uuid;

COMMENT ON COLUMN public.listing_aplus.house IS
  'House-design plan (lib/pm/aplusHouse.js): { brief, words, photos {slot: library file}, shot_list [{slot, need}], panels {locale: {slot: url}}, words_by_locale {locale: words}, built_at, cost_usd }';
