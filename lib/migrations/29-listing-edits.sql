-- Migration: 29-listing-edits
-- Description: Edits made on PM's Amazon listing screen (Jon 2026-11-11: "I need a place to edit and change values").
--
--   listing_edits   one current edit per listing field or attribute: what was live when it was edited, the new value,
--                   who edited it and its state. 'proposed' = saved in PM only. Nothing here is sent to Amazon: a
--                   change reaches Amazon only through a listing_change approval and the listing executor.
--
-- Server-only like migrations 26/27: anon / authenticated get nothing; the app reads and writes it through
-- /api/listings/* as the signed-in person. Deploy-safe and idempotent; nothing is dropped or deleted.

SELECT backup_before_migration('29-listing-edits');

CREATE TABLE IF NOT EXISTS public.listing_edits (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  asin         text        NOT NULL,
  marketplace  text        NOT NULL,
  kind         text        NOT NULL CHECK (kind IN ('field', 'attribute')),
  name         text        NOT NULL,
  live         jsonb,
  value        jsonb       NOT NULL,
  note         text,
  status       text        NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'withdrawn', 'in_approval', 'sent')),
  created_by   text,
  updated_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asin, marketplace, kind, name),
  FOREIGN KEY (asin, marketplace) REFERENCES public.listing_products(asin, marketplace)
);
CREATE INDEX IF NOT EXISTS listing_edits_listing ON public.listing_edits (asin, marketplace);
CREATE INDEX IF NOT EXISTS listing_edits_open ON public.listing_edits (status) WHERE status = 'proposed';

DROP TRIGGER IF EXISTS listing_edits_updated_at ON public.listing_edits;
CREATE TRIGGER listing_edits_updated_at
  BEFORE UPDATE ON public.listing_edits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.listing_edits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.listing_edits FROM anon, authenticated;

COMMENT ON TABLE public.listing_edits IS
  'Edits to Amazon listing fields and attributes made in PM. proposed = saved in PM only; never sent to Amazon from here.';

NOTIFY pgrst, 'reload schema';
