-- Migration: 37-media-library
-- Description: The doddl image library in doddlHQ (Jon 2026-11-16: "we built a draw down from sharepoint, which housed
-- 17k images, you filed them all in folders. That image library"; "Yes, connect it").
--
--   media_connection  one row ('knowledge'): the Microsoft sign-in doddlHQ reads the library with (read-only, the
--                     refresh token encrypted with B2B_MAIL_TOKEN_KEY), who connected it, and the last sync.
--   media_library     one row per file in OneDrive "doddl HQ Knowledge/14 Media", from its imagery-index.csv: type folder,
--                     master SKU, path, channels it is cleared for, rights. Refreshed daily; files are never copied here.
--                     A file is copied once into the listing-images store only when it is used on Amazon.
--
-- Deploy-safe and idempotent: IF NOT EXISTS only. Nothing is dropped or deleted. Service role only (RLS on, no policy).

SELECT backup_before_migration('37-media-library');

CREATE TABLE IF NOT EXISTS public.media_connection (
  id             text        PRIMARY KEY DEFAULT 'knowledge' CHECK (id = 'knowledge'),
  account        text,
  token_enc      text,
  status         text        NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'error', 'disconnected')),
  status_reason  text,
  connected_by   text,
  connected_at   timestamptz,
  synced_at      timestamptz,
  synced_count   integer
);
ALTER TABLE public.media_connection ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.media_library (
  image_id          text        PRIMARY KEY,
  type              text        NOT NULL,
  master_sku        text,
  file_path         text        NOT NULL,
  name              text        NOT NULL,
  kind              text        NOT NULL DEFAULT 'image' CHECK (kind IN ('image', 'video', 'other')),
  channels_allowed  text,
  usage_rights      text,
  agent_use         text,
  notes             text,
  used_url          text,       -- the public copy in listing-images, once it has been used on Amazon
  synced_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS media_library_sku ON public.media_library (master_sku);
CREATE INDEX IF NOT EXISTS media_library_type ON public.media_library (type);
ALTER TABLE public.media_library ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
