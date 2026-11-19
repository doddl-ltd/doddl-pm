-- Migration: 43-listing-families
-- Description: Amazon listings by family (Jon 2026-11-19: "build everything & replace what we had in Doddl HQ", from the
-- agreed canvas: one family per product, a master signed off in UK English, colours, images by master/colour slot,
-- countries, the parent in each store mapped to one family code, a clean-up list, rank + reviews daily, evidence).
--
--   listing_families          one row per family: family_code (P-<NAME>, doddlHQ only, never sent to Amazon), name,
--                             theme, sign-off by Jon and Laura, the image slot map, own keywords added by hand.
--   listing_family_members    every ASIN in every store that belongs to the family, with its role there.
--   listing_family_parents    the parent listing in each store (ASIN + seller SKU as they are today: map only).
--   listing_cleanup           the family problems found across stores and how each is fixed (in place / join /
--                             relink), its wave, whether it needs Jon's decision, and its status.
--   listing_reviews_daily     stars and review count per ASIN per store per day (written by the Hub's capture).
--   listing_evidence          dated snapshots (screenshot key in storage + values read) daily and before/after changes.
--
-- The family rows are derived from listing_products by lib/pm/families.js (Refresh on the listings page); nothing in
-- this migration writes rows. Deploy-safe and idempotent: IF NOT EXISTS only. Nothing is dropped or deleted.
-- Service role only (RLS on, no policy), like the other listing tables.

SELECT backup_before_migration('43-listing-families');

CREATE TABLE IF NOT EXISTS public.listing_families (
  family_code    text        PRIMARY KEY,
  name           text        NOT NULL,
  theme          text,
  lead_asin      text,
  signoff        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  slot_map       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  own_keywords   jsonb       NOT NULL DEFAULT '[]'::jsonb,
  derived_at     timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.listing_family_members (
  family_code    text        NOT NULL,
  asin           text        NOT NULL,
  marketplace    text        NOT NULL,
  role           text        NOT NULL,
  sku            text,
  colour         text,
  parent_asin    text,
  is_pack        boolean     NOT NULL DEFAULT false,
  derived_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (asin, marketplace)
);
CREATE INDEX IF NOT EXISTS listing_family_members_code ON public.listing_family_members (family_code);

CREATE TABLE IF NOT EXISTS public.listing_family_parents (
  family_code    text        NOT NULL,
  marketplace    text        NOT NULL,
  parent_asin    text        NOT NULL,
  parent_sku     text,
  children       integer     NOT NULL DEFAULT 0,
  status         text        NOT NULL DEFAULT 'mapped',
  derived_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (family_code, marketplace, parent_asin)
);

CREATE TABLE IF NOT EXISTS public.listing_cleanup (
  family_code     text        NOT NULL,
  marketplace     text        NOT NULL,
  problem_key     text        NOT NULL,
  problem         text        NOT NULL,
  fix_kind        text        NOT NULL,
  fix             text,
  wave            integer     NOT NULL DEFAULT 1,
  decision_needed text,
  status          text        NOT NULL DEFAULT 'open',
  note            text,
  derived_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text,
  PRIMARY KEY (family_code, marketplace, problem_key)
);

CREATE TABLE IF NOT EXISTS public.listing_reviews_daily (
  asin            text        NOT NULL,
  marketplace     text        NOT NULL,
  date            date        NOT NULL,
  rating          numeric(3,2),
  reviews         integer,
  source          text        NOT NULL DEFAULT 'page',
  status          text        NOT NULL DEFAULT 'ok',
  screenshot_key  text,
  received_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (asin, marketplace, date)
);

CREATE TABLE IF NOT EXISTS public.listing_evidence (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  asin            text        NOT NULL,
  marketplace     text        NOT NULL,
  taken_at        timestamptz NOT NULL DEFAULT now(),
  reason          text        NOT NULL DEFAULT 'daily',
  change_ref      text,
  "values"        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  screenshot_key  text,
  created_by      text
);
CREATE INDEX IF NOT EXISTS listing_evidence_asin ON public.listing_evidence (asin, marketplace, taken_at DESC);

ALTER TABLE public.listing_families        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listing_family_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listing_family_parents  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listing_cleanup         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listing_reviews_daily   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listing_evidence        ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.listing_families IS 'Amazon listing families (migration 43): family_code is doddlHQ-only; each store keeps its own parent SKU (listing_family_parents).';
COMMENT ON TABLE public.listing_evidence IS 'Dated evidence per ASIN per store: screenshot_key in storage + values read (stars, reviews, rank, parent, colours). Never edited once written.';
