-- Migration: 34-listing-aplus
-- Description: A+ content built in PM (Jon 2026-11-12: "I want to be able to brief into the PM, the tool build new A+
-- pages for me, then build them on Amazon for every market").
--
--   listing_aplus   one A+ page per ASIN: Jon's brief, the modules in UK English (the source), the images it uses,
--                   a translation per non-English market (approved by a person = the language review), and per
--                   market what happened when it was sent: submitted (waiting for HQ) → in_approval (approval card)
--                   → sent (created on Amazon, waiting for Amazon's review) → live / rejected, or refused (HQ or
--                   Amazon's validation said no). Amazon's content reference key is kept per market.
--
-- Deploy-safe and idempotent: IF NOT EXISTS only. Nothing is dropped or deleted.

SELECT backup_before_migration('34-listing-aplus');

CREATE TABLE IF NOT EXISTS public.listing_aplus (
  asin         text PRIMARY KEY,
  name         text NOT NULL,
  brief        text NOT NULL DEFAULT '',
  modules      jsonb NOT NULL DEFAULT '[]'::jsonb,
  images       jsonb NOT NULL DEFAULT '[]'::jsonb,
  variants     jsonb NOT NULL DEFAULT '{}'::jsonb,
  sends        jsonb NOT NULL DEFAULT '{}'::jsonb,
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
  approved_by  text,
  approved_at  timestamptz,
  model        text,
  cost_usd     numeric,
  created_by   text,
  updated_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.listing_aplus ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
