-- Migration: 32-master-variants
-- Description: Sending a master listing to every market (Jon 2026-11-12: "Yes, build it"; "UK English is always the
-- source, then we build variations for each market").
--
--   listing_masters.variants      per non-English market: the translated copy and text attributes, who approved them
--                                 ({ DE: { copy: {...}, attributes: { name: value }, status: draft|approved,
--                                 approved_by, approved_at, model, cost_usd } }). The approval is the language review.
--   listing_edits.source          'hand' (typed on a market tab) or 'master' (sent from the master)
--   listing_edits.language_reviewed_by   the person who approved the translation the edit came from (non-English
--                                 markets); HQ refuses non-English copy without it.
--
-- Deploy-safe and idempotent: ADD COLUMN IF NOT EXISTS only. Nothing is dropped or deleted.

SELECT backup_before_migration('32-master-variants');

ALTER TABLE public.listing_masters ADD COLUMN IF NOT EXISTS variants jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.listing_edits ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'hand';
ALTER TABLE public.listing_edits ADD COLUMN IF NOT EXISTS language_reviewed_by text;

NOTIFY pgrst, 'reload schema';
