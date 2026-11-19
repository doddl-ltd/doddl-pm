-- Migration: 44-page-capture
-- Description: Amazon page capture (stars, review count, full-page screenshot) from Chrome on Jon's PC, daily for every
--              child ASIN in UK, DE, FR, US and before/after each parent-child change (Jon, 19 Nov 2026: Chrome
--              instead of Keepa or a cloud browser, which Amazon's robot check blocks).
--   - private storage bucket listing-evidence (screenshots; viewed through short-lived signed links only)
--   - agent key doddl-page-capture, scope evidence:write, for POST /api/agent/listings/capture
-- Idempotent.

SELECT public.backup_before_migration('44-page-capture');

INSERT INTO storage.buckets (id, name, public)
VALUES ('listing-evidence', 'listing-evidence', false)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.listing_reviews_daily IS 'Stars and review count per ASIN per store per day (migration 43), written by the Chrome page capture through /api/agent/listings/capture (migration 44).';

-- Key: plaintext in Key Vault doddl-hq-kv as pm-agent-key-doddl-page-capture (doddl-kv-prod's firewall blocks this PC) and DPAPI-encrypted for Jon's Windows account on the capture PC.
INSERT INTO public.agent_keys (agent_id, key_hash, key_prefix, scopes, label)
VALUES ('doddl-page-capture', '7a426c14f03ce92e5fd769aeb4d49136a79ad2dcedf2c76ebd9d4cf9d348bbd3', 'dpm_iymp', ARRAY['evidence:write'], 'Amazon page capture (Chrome on Jon''s PC)')
ON CONFLICT (key_hash) DO NOTHING;
