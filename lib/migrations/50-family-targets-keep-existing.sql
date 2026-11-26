-- Migration: 50-family-targets-keep-existing
-- Description: Jon 26 Nov 2026 "complete this for every single parent child in all markets". Target structures for the other
--              multi-colour families, with keep_existing = true: a store keeps the parent of ours that already holds most of
--              the family's colours (UK/US/CA/FR 3-piece are complete today), the missing colours join it; a store with none
--              uses the same seller account's parent SKU (one SKU per account); only a family with no parent of ours in an
--              account gets the new P-… parent. Packs stay out (single products). Nothing is sent to Amazon. Idempotent.

SELECT public.backup_before_migration('50-family-targets-keep-existing');

ALTER TABLE public.listing_family_target ADD COLUMN IF NOT EXISTS keep_existing boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.listing_family_target.keep_existing IS 'Keep the parent of ours that already holds most colours in a store (or the account''s parent SKU); parent_sku only where the account has none (migration 50).';

INSERT INTO public.listing_family_target (family_code, parent_sku, theme, children, moved_out, note, updated_by, keep_existing) VALUES
  ('P-3PC-CUTLERY', 'P-3PC-CUTLERY', 'COLOR', ARRAY['B01FI1XXC2', 'B074DZKCZW', 'B074DZSKV6', 'B0FN8BNRXV'], '[]'::jsonb, 'Fresh Green, Magenta, Blueberry, Dusky Rose; pack B0H3G96RDB stays out', 'migration 50', true),
  ('P-2PC-CUTLERY', 'P-2PC-CUTLERY', 'COLOR', ARRAY['B0779CZ9FD', 'B07F82N9HY', 'B07F86P6RN', 'B0FN8DY3Q9'], '[]'::jsonb, 'Aqua, Indigo, Magenta, Dusky Rose; pack B0GWNMCFMX stays out', 'migration 50', true),
  ('P-MEALTIME-KIT', 'P-MEALTIME-KIT', 'COLOR', ARRAY['B0H6XQQWFY', 'B0H6XTYF65'], '[]'::jsonb, 'Fresh Green, Dusky Rose', 'migration 50', true),
  ('P-2IN1-PLATE', 'P-2IN1-PLATE', 'COLOR', ARRAY['B0H6XSBMSD', 'B0H6XZ9K8L'], '[]'::jsonb, 'two colours; UK and US grouped today', 'migration 50', true),
  ('P-CUTLERY-BOWL-BUNDLE', 'P-CUTLERY-BOWL-BUNDLE', 'COLOR', ARRAY['B0FPMNTJRX', 'B0FPQNQX2G'], '[]'::jsonb, 'Fresh Green, Dusky Rose; UK only today', 'migration 50', true),
  ('P-CONFIDENT-EATER', 'P-CONFIDENT-EATER', 'COLOR', ARRAY['B0FPQPNWFN', 'B0G3Q2Y31T', 'B0G3Q61MGZ'], '[]'::jsonb, 'three sets; UK only today', 'migration 50', true)
ON CONFLICT (family_code) DO NOTHING;
