-- Migration: 47-rank-history
-- Description: Daily sales-rank history (Jon, 23 Nov 2026: "Yes, keep history" for the family Rank & reviews grid).
--              listing_categories keeps only the latest read (the Hub replaces it daily); listing_rank_daily keeps one
--              row per store, ASIN, category and day, written alongside it by saveCategories (lib/pm/categories.js).
--              Seeded from today's listing_categories. Idempotent.

SELECT public.backup_before_migration('47-rank-history');

CREATE TABLE IF NOT EXISTS public.listing_rank_daily (
  marketplace  text        NOT NULL,
  asin         text        NOT NULL,
  node         text        NOT NULL,
  date         date        NOT NULL,
  title        text,
  sales_rank   bigint,
  received_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (marketplace, asin, node, date)
);
CREATE INDEX IF NOT EXISTS listing_rank_daily_asin_date ON public.listing_rank_daily (asin, date DESC);
ALTER TABLE public.listing_rank_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.listing_rank_daily FROM anon, authenticated;

INSERT INTO public.listing_rank_daily (marketplace, asin, node, date, title, sales_rank)
SELECT marketplace, asin, node, COALESCE(read_on, (received_at AT TIME ZONE 'Europe/London')::date), title, sales_rank
FROM public.listing_categories
WHERE sales_rank IS NOT NULL
ON CONFLICT (marketplace, asin, node, date) DO NOTHING;

COMMENT ON TABLE public.listing_rank_daily IS 'Sales rank per store, ASIN, category and day (migration 47), kept forever; written with each daily listing_categories send.';

NOTIFY pgrst, 'reload schema';
