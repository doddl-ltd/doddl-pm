-- Migration: 49-baby-cutlery-target
-- Description: Target structure for Baby Cutlery (Jon, 25 Nov 2026: "do the same for the baby cutlery" as the 2-in-1 Bowl):
--              one parent seller SKU P-BABY-CUTLERY in every store, children Fresh Green B07W44R4DJ (DOD008) and
--              Dusky Rose B0FN8FQWLM (DOD052). Replaces the UK/US/CA parents (PARENT 1: Baby Cutlery (6–12m),
--              4F-1NZP-8Y9H, BabyMaster); the EU stores have none today. Nothing is sent to Amazon. Idempotent.

SELECT public.backup_before_migration('49-baby-cutlery-target');

INSERT INTO public.listing_family_target (family_code, parent_sku, theme, children, moved_out, note, updated_by)
VALUES ('P-BABY-CUTLERY', 'P-BABY-CUTLERY', 'COLOR', ARRAY['B07W44R4DJ', 'B0FN8FQWLM'], '[]'::jsonb,
        'Jon 25 Nov 2026: same as the 2-in-1 Bowl, one global parent', 'migration 49')
ON CONFLICT (family_code) DO NOTHING;
