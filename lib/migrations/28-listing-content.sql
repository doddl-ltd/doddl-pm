-- Migration: 28-listing-content
-- Description: What HQ's bulk listing pull reads from Amazon beyond the copy fields (Jon 2026-11-11: "Has it pulled
-- images and the A+ content ... I also want all the attributes pulling as well").
--
--   listing_products.category     the browse path Amazon files the product under
--   listing_products.variations   { parent_asins[], child_asins[], theme }
--   listing_products.attributes   [{ name, value, source: 'page' | 'our listing' }]: every attribute, flattened to text
--   listing_products.aplus        [{ ref, name, status, updated, modules: [{ type, texts[], images: [{ url, alt, px }] }] }]
--
-- Images stay on listing_fields (field 'Images', live = [{ slot, label, url, px }]), as the contract already says.
-- Deploy-safe and idempotent: ADD COLUMN IF NOT EXISTS only. Nothing is dropped or deleted.

SELECT backup_before_migration('28-listing-content');

ALTER TABLE public.listing_products ADD COLUMN IF NOT EXISTS category   text;
ALTER TABLE public.listing_products ADD COLUMN IF NOT EXISTS variations jsonb;
ALTER TABLE public.listing_products ADD COLUMN IF NOT EXISTS attributes jsonb;
ALTER TABLE public.listing_products ADD COLUMN IF NOT EXISTS aplus      jsonb;

COMMENT ON COLUMN public.listing_products.attributes IS 'Every Amazon attribute for this listing, flattened to text: [{name, value, source}] (source page = the live catalogue, our listing = our seller listing).';
COMMENT ON COLUMN public.listing_products.aplus IS 'A+ documents applied to this ASIN in this marketplace: [{ref, name, status, updated, modules: [{type, texts, images: [{url, alt, px}]}]}].';

NOTIFY pgrst, 'reload schema';
