-- Migration: 40-listing-rollout
-- Description: Amazon rollout (Jon 2026-11-16): "local keywords should be found by the agent using the brand analytics
-- tool. Master images should defined, then the agent should pull to the UK, US, CA for english, and then the agent should
-- take the images and create translated versions for each other market. I need to see what is created and what needs to
-- be pushed to Amazon - only when the image is LIVE on amazon should this be complete."
--
--   listing_keywords          Brand Analytics search terms per (store, ASIN): the store's searches on which that ASIN
--                             was shown (last 3 months), sent daily by the Hub (agg.amazon_asin_keywords) through
--                             /api/agent/listings/keywords. asin '*' = the store's biggest searches across doddl's ASINs.
--   listing_masters.rollout   the listing agent's run for one master: started (who, when), budget and spend in USD,
--                             last run and its note. The agent (cron /api/cron/listing-agent) only works on approved
--                             masters whose rollout was started by a person.
--   agent scope keywords:write  for the Hub's doddl PM key (doddl-hq / claude-agents): writes listing_keywords only.
--
-- Deploy-safe and idempotent: IF NOT EXISTS only. Nothing is dropped or deleted. Service role only (RLS on, no policy).

SELECT backup_before_migration('40-listing-rollout');

CREATE TABLE IF NOT EXISTS public.listing_keywords (
  marketplace       text        NOT NULL,
  asin              text        NOT NULL,
  search_query      text        NOT NULL,
  query_volume      bigint,
  asin_impressions  bigint,
  asin_clicks       bigint,
  asin_purchases    bigint,
  is_brand_term     boolean     NOT NULL DEFAULT false,
  period_from       date,
  period_to         date,
  received_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (marketplace, asin, search_query)
);
ALTER TABLE public.listing_keywords ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.listing_keywords FROM anon, authenticated;

ALTER TABLE public.listing_masters ADD COLUMN IF NOT EXISTS rollout jsonb;

UPDATE public.agent_keys
SET scopes = (SELECT array_agg(DISTINCT s ORDER BY s) FROM unnest(scopes || ARRAY['keywords:write']) s)
WHERE agent_id IN ('doddl-hq', 'claude-agents') AND revoked_at IS NULL
  AND NOT (scopes @> ARRAY['keywords:write']);

NOTIFY pgrst, 'reload schema';
