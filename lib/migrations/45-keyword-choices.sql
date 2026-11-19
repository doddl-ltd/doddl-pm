-- Migration: 45-keyword-choices
-- Description: Jon's choice per Brand Analytics search on a family (Jon, 19 Nov 2026: "the user must be able to remove
--              or change focus of the keywords"): { "<normalised search>": "focus" | "watch" | "out" }.
--              focus = scored and written for; watch = shown only; out = not relevant (hidden, never scored, never
--              offered to the copy writer). No entry = automatic (top 20 by volume). Idempotent.

SELECT public.backup_before_migration('45-keyword-choices');

ALTER TABLE public.listing_families ADD COLUMN IF NOT EXISTS keyword_choices jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.listing_families.keyword_choices IS 'Per search: focus | watch | out (migration 45). Set on the family Master tab.';
