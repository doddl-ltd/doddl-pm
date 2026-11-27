-- Migration: 52-family-targets-new-parent
-- Description: Jon 2026-11-27: phase 1 is "delete every old parent, add the new parent SKU, join the colours" in every
--              store. The six keep_existing families (migration 50) now always take their P- parent SKU (force_parent),
--              never a store's old parent. keep_existing stays on for its other meaning: group before content, the new
--              parent titled from a colour's live title, no family master needed. Nothing is sent to Amazon. Idempotent.

SELECT public.backup_before_migration('52-family-targets-new-parent');

ALTER TABLE public.listing_family_target ADD COLUMN IF NOT EXISTS force_parent boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.listing_family_target.force_parent IS 'Every store joins parent_sku, never an existing parent of ours (Jon 2026-11-27, migration 52).';

UPDATE public.listing_family_target
SET force_parent = true, updated_by = 'migration 52', updated_at = now()
WHERE family_code IN ('P-3PC-CUTLERY', 'P-2PC-CUTLERY', 'P-MEALTIME-KIT', 'P-2IN1-PLATE', 'P-CUTLERY-BOWL-BUNDLE', 'P-CONFIDENT-EATER')
  AND NOT force_parent;
