-- Migration: 39-image-translations
-- Description: Listing images translated per market inside doddlHQ (Jon 2026-11-16: "it is literally a text change on an
-- image that exists already"; "build it, dont test it yet"). Claude reads the words on an image (where each block sits,
-- its colours and weight) and translates them; doddlHQ repaints each text panel and sets the translation in the brand
-- font; Claude reads the result back to check it; a person approves it, and only then does it replace that image in the
-- market's master image set. Main images are never translated.
--
--   image_translations   one row per (ASIN, source image, market): status read -> rendered -> checked (or problem)
--                        -> approved / rejected; or no_text / over_photo when it cannot or need not be done here.
--
-- Deploy-safe and idempotent: IF NOT EXISTS only. Nothing is dropped or deleted. Service role only (RLS on, no policy).

SELECT backup_before_migration('39-image-translations');

CREATE TABLE IF NOT EXISTS public.image_translations (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  asin         text        NOT NULL,
  locale       text        NOT NULL,
  slot         text,                         -- the slot in the market's set it would replace (PT01...), if known
  source_url   text        NOT NULL,
  status       text        NOT NULL DEFAULT 'read' CHECK (status IN ('read', 'no_text', 'over_photo', 'rendered', 'checked', 'problem', 'approved', 'rejected')),
  layout       jsonb       NOT NULL DEFAULT '{}'::jsonb,   -- Claude's reading: blocks with text, translation, box, colours, weight
  url          text,                                       -- the repainted image (listing-images store)
  check_result jsonb,                                      -- Claude's check of the repainted image
  note         text,
  cost_usd     numeric(10,4) NOT NULL DEFAULT 0,
  created_by   text,
  decided_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  decided_at   timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS image_translations_one ON public.image_translations (asin, locale, source_url);
ALTER TABLE public.image_translations ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
