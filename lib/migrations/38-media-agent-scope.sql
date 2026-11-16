-- Migration: 38-media-agent-scope
-- Description: Doddl HQ's agents may use the image library (Jon 2026-11-16: "I want the user to select the images for
-- the listings, but the A+ content and wider social organic and ads etc can use this image pool to create content").
-- doddl-hq gains media:read (/api/agent/media: search the library, and get a public link to an original for a channel
-- the file is cleared for). Listing images stay a person's choice: no agent route sets master listing images.
--
-- Deploy-safe and idempotent. Nothing is dropped or deleted.

SELECT backup_before_migration('38-media-agent-scope');

UPDATE public.agent_keys
SET scopes = (SELECT array_agg(DISTINCT s ORDER BY s) FROM unnest(scopes || ARRAY['media:read']) s)
WHERE agent_id = 'doddl-hq' AND revoked_at IS NULL
  AND NOT (scopes @> ARRAY['media:read']);

NOTIFY pgrst, 'reload schema';
