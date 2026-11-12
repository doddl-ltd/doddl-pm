-- Migration: 33-listing-live-check
-- Description: Images per market, what is live, and cases for Amazon (Jon 2026-11-12: "update images for each market,
-- send them & then tell what is live & what is a problem ... once pushed, if Amazon live does not match we need to build
-- a case for Amazon to step in").
--
--   storage bucket listing-images  public: Amazon fetches each uploaded image from its public link when the listing
--                                  is patched (media_location). Uploads come only through PM's signed upload links.
--   listing_edits.sent_at          when HQ patched the edit on Amazon. The live check compares the next reads from
--                                  Amazon with what was sent from then on.
--   listing_cases                  a case for Amazon Seller Support per listing: what we sent, what is live, Amazon's
--                                  own messages. Built in PM, filed by a person in Seller Central (there is no API
--                                  for cases), then the case ID is recorded here.
--
-- Deploy-safe and idempotent: IF NOT EXISTS / ON CONFLICT DO NOTHING. Nothing is dropped or deleted.

SELECT backup_before_migration('33-listing-live-check');

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('listing-images', 'listing-images', true, 20971520, ARRAY['image/jpeg', 'image/png', 'image/tiff', 'image/gif'])
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.listing_edits ADD COLUMN IF NOT EXISTS sent_at timestamptz;

CREATE TABLE IF NOT EXISTS public.listing_cases (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asin           text NOT NULL,
  marketplace    text NOT NULL,
  kind           text NOT NULL DEFAULT 'listing' CHECK (kind IN ('listing', 'aplus')),
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'filed', 'resolved', 'closed')),
  subject        text NOT NULL,
  body           text NOT NULL,
  edit_ids       jsonb NOT NULL DEFAULT '[]'::jsonb,
  amazon_case_id text,
  note           text,
  created_by     text,
  updated_by     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  filed_at       timestamptz,
  resolved_at    timestamptz
);
CREATE INDEX IF NOT EXISTS listing_cases_listing ON public.listing_cases (asin, marketplace);
ALTER TABLE public.listing_cases ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
