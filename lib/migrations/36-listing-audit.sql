-- Migration: 36-listing-audit
-- Description: The daily master check (Jon 2026-11-16: "I want EVERY SINGLE attribute to match on every ASIN"; once
-- pushed, "map what is live on Amazon to what should be live ... if Amazon does not match, flag this agent to fix /
-- create case").
--
--   listing_audit   one row per listing (ASIN x marketplace), rewritten every day after HQ reads Amazon: every copy
--                   field, attribute and image slot compared with the master. items holds each difference with what to
--                   do about it (send it, translate it, change it in Seller Central, add it to the master, wait for
--                   Amazon, or a Seller Support case when Amazon has not applied what was sent).
--
-- Deploy-safe and idempotent: IF NOT EXISTS only. Nothing is dropped or deleted. Service role only (RLS on, no policy).

SELECT backup_before_migration('36-listing-audit');

CREATE TABLE IF NOT EXISTS public.listing_audit (
  asin         text        NOT NULL,
  marketplace  text        NOT NULL,
  master       text,                                -- the master's status when checked (seed, draft, approved) or null
  matches      integer     NOT NULL DEFAULT 0,      -- fields and attributes that match the master
  to_send      integer     NOT NULL DEFAULT 0,      -- differs, and sending the master fixes it
  translate    integer     NOT NULL DEFAULT 0,      -- differs, waiting on an approved translation
  manual       integer     NOT NULL DEFAULT 0,      -- differs, has to be changed in Seller Central
  extra        integer     NOT NULL DEFAULT 0,      -- on Amazon but not in the master
  waiting      integer     NOT NULL DEFAULT 0,      -- sent, inside Amazon's 72 hours
  problems     integer     NOT NULL DEFAULT 0,      -- sent, Amazon still shows something else: a case
  items        jsonb       NOT NULL DEFAULT '[]'::jsonb,
  case_id      uuid,                                -- the draft case raised for the problems, if any
  checked_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (asin, marketplace)
);
CREATE INDEX IF NOT EXISTS listing_audit_open ON public.listing_audit ((to_send + translate + manual + extra + problems));
ALTER TABLE public.listing_audit ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
