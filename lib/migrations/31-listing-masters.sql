-- Migration: 31-listing-masters
-- Description: The master listing (Jon 2026-11-12: "UK English is always the source, then we build variations for each
-- market"; "images need to be for each locale"; "all attributes the same ... remove some attributes that are not
-- required"). One master per ASIN (the same ASIN is used in every store; a bundle is its own ASIN and master).
--
--   listing_masters   per ASIN: UK English copy, ONE attribute set (each with keep / remove), and one image list per
--                     market locale. Seeded by HQ from the live UK listing (status 'seed'); edits in PM make it 'draft';
--                     Jon approves it ('approved'). HQ never overwrites a master a person has edited.
--   listing_ptd       Amazon's Product Type Definition per product type and marketplace: attribute groups, display
--                     names and which attributes Amazon requires (for grouping and the Required tag).
--
-- Server-only like 26/27/29: anon / authenticated get nothing; the app reads and writes through /api/listings/*, HQ through
-- /api/agent/listings/*. Deploy-safe and idempotent; nothing is dropped or deleted.

SELECT backup_before_migration('31-listing-masters');

CREATE TABLE IF NOT EXISTS public.listing_masters (
  asin          text        PRIMARY KEY,
  master_sku    text,
  product       text,
  product_type  text,
  status        text        NOT NULL DEFAULT 'seed' CHECK (status IN ('seed', 'draft', 'approved')),
  copy          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  attributes    jsonb       NOT NULL DEFAULT '[]'::jsonb,
  images        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  seeded_from   text,
  note          text,
  approved_by   text,
  approved_at   timestamptz,
  updated_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS listing_masters_updated_at ON public.listing_masters;
CREATE TRIGGER listing_masters_updated_at
  BEFORE UPDATE ON public.listing_masters
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS public.listing_ptd (
  product_type  text        NOT NULL,
  marketplace   text        NOT NULL,
  groups        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  titles        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  required      text[]      NOT NULL DEFAULT '{}',
  version       text,
  checked_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_type, marketplace)
);

ALTER TABLE public.listing_masters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listing_ptd ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.listing_masters, public.listing_ptd FROM anon, authenticated;

COMMENT ON TABLE public.listing_masters IS 'Master listing per ASIN: UK English copy, one attribute set (keep/remove), images per market locale. Seeded by HQ; edited and approved in PM.';
COMMENT ON TABLE public.listing_ptd IS 'Amazon Product Type Definitions per product type and marketplace: attribute groups, display names, required attributes.';

NOTIFY pgrst, 'reload schema';
