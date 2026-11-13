-- Migration: 35-requests
-- Description: The requests hub (Jon 2026-11-13: "one front door ... simple, structured and stage based ... permanent as
-- well as ad hoc"; mockup https://claude.ai/artifact/TiwHcEZ7MxAtdwvxV1apJy, "Yes, build it").
--
--   requests   every ask in one table: a type (report, presentation, campaign, page, product, amazon, content, ip, pm,
--              other), one-off or ongoing, the form's answers, and its stage:
--                suggested → asked → plan_approval → in_progress → output_approval → live (one-off) / running (ongoing)
--                → closed;  parked and declined at any point.
--              The plan, the finished work, the question thread and the history are kept on the row. Ongoing work
--              keeps running with an owner, a cadence and a review date (Standing work), and is paused or retired there.
--              A change to a running item is a new request pointing at it (parent_id).
--   agent key  doddl-hq gains requests:read and requests:write (it scopes, asks, reports made work and results).
--
-- Deploy-safe and idempotent: IF NOT EXISTS only. Nothing is dropped or deleted.

SELECT backup_before_migration('35-requests');

CREATE TABLE IF NOT EXISTS public.requests (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind           text        NOT NULL CHECK (kind IN ('report', 'presentation', 'campaign', 'page', 'product', 'amazon', 'content', 'ip', 'pm', 'other')),
  mode           text        NOT NULL DEFAULT 'one' CHECK (mode IN ('one', 'on')),
  title          text        NOT NULL CHECK (btrim(title) <> ''),
  fields         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  stage          text        NOT NULL DEFAULT 'asked' CHECK (stage IN ('suggested', 'asked', 'plan_approval', 'in_progress', 'output_approval', 'live', 'running', 'closed', 'parked', 'declined')),
  parked_from    text,
  parked_note    text,
  asked_by       text        NOT NULL,
  suggested_from text,
  agent          text,
  plan           jsonb       NOT NULL DEFAULT '[]'::jsonb,
  output         jsonb,
  results        text,
  thread         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  log            jsonb       NOT NULL DEFAULT '[]'::jsonb,
  owner          text,
  cadence        text,
  review_every   text,
  next_review    date,
  lives_in       text,
  health         text,
  health_note    text,
  cost_month     text,
  paused         boolean     NOT NULL DEFAULT false,
  parent_id      uuid        REFERENCES public.requests(id),
  due_at         timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS requests_stage ON public.requests (stage, updated_at DESC);
ALTER TABLE public.requests ENABLE ROW LEVEL SECURITY;

UPDATE public.agent_keys
SET scopes = (SELECT array_agg(DISTINCT s ORDER BY s) FROM unnest(scopes || ARRAY['requests:read', 'requests:write']) s)
WHERE agent_id = 'doddl-hq' AND revoked_at IS NULL
  AND NOT (scopes @> ARRAY['requests:read', 'requests:write']);

NOTIFY pgrst, 'reload schema';
