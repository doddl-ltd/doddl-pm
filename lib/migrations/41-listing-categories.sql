-- Migration: 41-listing-categories
-- Description: Per-store categories and the master copy writer (Jon 2026-11-16: "Recommend browse nodes arent always the
-- same globally, how do we deal with this?"). Browse node IDs differ in every Amazon store, so the master never copies one
-- across; instead each store gets its own category, suggested by Claude from Amazon's own category names in that store
-- and approved by a person, then sent and checked live like any other piece.
--
--   listing_categories            the categories Amazon ranks each doddl ASIN in, per store (node id + name + rank, the
--                                 latest day), sent daily by the Hub from agg.amazon_sales_rank_all. Names the browse
--                                 nodes on each listing and gives the candidates for a store's category.
--   listing_masters.categories    per store: the chosen browse node { node, title, status suggested|approved, why, by, at }
--
-- Deploy-safe and idempotent: IF NOT EXISTS only. Nothing is dropped or deleted. Service role only (RLS on, no policy).

SELECT backup_before_migration('41-listing-categories');

CREATE TABLE IF NOT EXISTS public.listing_categories (
  marketplace  text        NOT NULL,
  asin         text        NOT NULL,
  node         text        NOT NULL,
  title        text,
  sales_rank   bigint,
  read_on      date,
  received_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (marketplace, asin, node)
);
ALTER TABLE public.listing_categories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.listing_categories FROM anon, authenticated;

ALTER TABLE public.listing_masters ADD COLUMN IF NOT EXISTS categories jsonb;

NOTIFY pgrst, 'reload schema';
