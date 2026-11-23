-- Migration: 48-listing-edit-parent
-- Description: A listing edit may create a variation parent (Jon, 23 Nov 2026: every store's 2-in-1 Bowl under one parent
--              seller SKU P-2IN1-BOWL). kind 'parent': asin = a child ASIN of the family in that store (the anchor),
--              name = the new parent seller SKU, value = JSON text { variation_theme, item_name, template_sku,
--              suggested_asin }. Doddl HQ turns it into a create-parent proposal (Amazon validation preview, approval
--              card, then the live PUT). Idempotent.

SELECT public.backup_before_migration('48-listing-edit-parent');

ALTER TABLE public.listing_edits DROP CONSTRAINT IF EXISTS listing_edits_kind_check;
ALTER TABLE public.listing_edits ADD CONSTRAINT listing_edits_kind_check CHECK (kind IN ('field', 'attribute', 'parent'));

NOTIFY pgrst, 'reload schema';
