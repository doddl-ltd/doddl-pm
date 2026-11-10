-- Migration: 27-b2b-outreach-mail
-- Description: B2B outreach mail (docs/b2b-campaigns/OUTREACH-MAIL.md; Jon 2026-11-10 "HubSpot does not exist, we use Klaviyo").
--
--   A) b2b_mailboxes        connected Microsoft 365 trade mailboxes (refresh token encrypted; never read by /api/db)
--   B) b2b_contacts         the address(es) per business; PM only, never returned to agents
--   C) b2b_suppressions     one do-not-contact list (e-mail and domain) for every campaign and mailbox
--   D) b2b_messages         one row per e-mail sent (or queued) from PM
--   E) b2b_message_events   sent, bounces, auto-replies, replies, opens, clicks, scanners, opt-outs
--   F) b2b_campaigns        mailbox_ids, track_opens, approve_daily, send_gaps
--   G) b2b_prospects        klaviyo_profile_id, contacts_checked_at, statuses warm / partner, contact {role, type, has_contact}
--   H) b2b_replies          message_id (fk b2b_messages)
--   I) notifications        b2b_alert (mailbox / campaign auto-paused)
--
-- Server-only like migration 26: anon / authenticated get nothing; the app reads through /api/db (GET) except
-- b2b_mailboxes.token_enc (the proxy never selects it) and b2b_contacts (not in the proxy at all; served by
-- /api/b2b/* to signed-in people only). Agents (/api/agent/*, MCP) never touch either.
--
-- Deploy-safe and idempotent: IF NOT EXISTS / DROP CONSTRAINT IF EXISTS / CREATE OR REPLACE. Nothing is dropped:
-- b2b_replies.hubspot_ref stays (unused from this build; destructive DDL is not allowed) and the contact CHECK still
-- accepts the old in_hubspot key so the code on main keeps working until this branch merges. No deletes on
-- projects / tasks / task_groups.

SELECT backup_before_migration('27-b2b-outreach-mail');

-- ═══════════════════════════════════════════════════════════════════════════
-- A) b2b_mailboxes
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.b2b_mailboxes (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  address            text        NOT NULL UNIQUE CHECK (address = lower(address) AND address ~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$'),
  display_name       text,
  signature_html     text,
  provider           text        NOT NULL DEFAULT 'm365' CHECK (provider IN ('m365')),
  ms_user_id         text,
  status             text        NOT NULL DEFAULT 'connecting'
                     CHECK (status IN ('connecting', 'warming', 'active', 'paused', 'error', 'disconnected')),
  status_reason      text,
  daily_cap          int         NOT NULL DEFAULT 50 CHECK (daily_cap BETWEEN 1 AND 100),
  warmup_started_on  date,
  send_days          int[]       NOT NULL DEFAULT '{1,2,3,4,5}' CHECK (send_days <@ ARRAY[1, 2, 3, 4, 5, 6, 7]),
  send_window        jsonb       NOT NULL DEFAULT '{"from":"09:00","to":"16:30","tz":"Europe/London"}'::jsonb,
  token_enc          text,
  token_updated_at   timestamptz,
  delta_link         text,
  last_polled_at     timestamptz,
  connected_by       text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.b2b_mailboxes IS
  'Connected Microsoft 365 trade mailboxes for B2B outreach. token_enc = AES-256-GCM refresh token (key B2B_MAIL_TOKEN_KEY); never selected by /api/db, never returned by any API. send_days: 1 = Monday .. 7 = Sunday.';
COMMENT ON COLUMN public.b2b_mailboxes.token_enc IS
  'Encrypted delegated refresh token. Read only by lib/b2bMail (server). Never returned.';

DROP TRIGGER IF EXISTS b2b_mailboxes_updated_at ON public.b2b_mailboxes;
CREATE TRIGGER b2b_mailboxes_updated_at
  BEFORE UPDATE ON public.b2b_mailboxes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- B) b2b_contacts (PM only)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.b2b_contacts (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id  uuid        NOT NULL REFERENCES public.b2b_prospects(id),
  email        text        NOT NULL CHECK (email = lower(email) AND email ~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$'),
  first_name   text,
  last_name    text,
  role         text,
  type         text        NOT NULL DEFAULT 'generic' CHECK (type IN ('generic', 'named')),
  status       text        NOT NULL DEFAULT 'suggested'
               CHECK (status IN ('suggested', 'ok', 'bounced', 'opted_out', 'invalid', 'rejected')),
  is_primary   boolean     NOT NULL DEFAULT false,
  source       text,
  added_by     text,
  checked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (prospect_id, email)
);
CREATE UNIQUE INDEX IF NOT EXISTS b2b_contacts_one_primary ON public.b2b_contacts (prospect_id) WHERE is_primary;
CREATE INDEX IF NOT EXISTS b2b_contacts_email ON public.b2b_contacts (email);

COMMENT ON TABLE public.b2b_contacts IS
  'Who we e-mail at each B2B prospect. PM only: never returned by /api/agent/* or MCP, not readable through /api/db. source = website:<url> | person:<email>. status suggested = found on the website, waiting for a person to accept.';

DROP TRIGGER IF EXISTS b2b_contacts_updated_at ON public.b2b_contacts;
CREATE TRIGGER b2b_contacts_updated_at
  BEFORE UPDATE ON public.b2b_contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- D) b2b_messages (before C, which points at it)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.b2b_messages (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id          uuid        NOT NULL REFERENCES public.b2b_campaigns(id),
  prospect_id          uuid        NOT NULL REFERENCES public.b2b_prospects(id),
  contact_id           uuid        REFERENCES public.b2b_contacts(id),
  mailbox_id           uuid        REFERENCES public.b2b_mailboxes(id),
  step                 int         NOT NULL CHECK (step BETWEEN 1 AND 3),
  subject              text,
  body_html            text,
  links                jsonb       NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(links) = 'array'),
  track_token_hash     text,
  opens_tracked        boolean     NOT NULL DEFAULT false,
  scheduled_for        timestamptz,
  sent_at              timestamptz,
  graph_id             text,
  internet_message_id  text,
  conversation_id      text,
  status               text        NOT NULL DEFAULT 'queued'
                       CHECK (status IN ('queued', 'sent', 'failed', 'bounced', 'replied', 'stopped')),
  error                text,
  pack_task_id         uuid        REFERENCES public.tasks(id),
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS b2b_messages_token ON public.b2b_messages (track_token_hash) WHERE track_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS b2b_messages_campaign ON public.b2b_messages (campaign_id, sent_at);
CREATE INDEX IF NOT EXISTS b2b_messages_prospect ON public.b2b_messages (prospect_id, step);
CREATE INDEX IF NOT EXISTS b2b_messages_mailbox ON public.b2b_messages (mailbox_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS b2b_messages_conversation ON public.b2b_messages (conversation_id) WHERE conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS b2b_messages_imid ON public.b2b_messages (internet_message_id) WHERE internet_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS b2b_messages_queued ON public.b2b_messages (mailbox_id, scheduled_for) WHERE status = 'queued';

COMMENT ON TABLE public.b2b_messages IS
  'One row per B2B e-mail (step 1..3) sent or queued by PM through Microsoft Graph. links: [{n, url}] the click redirect may go to (nothing else). track_token_hash = sha256 of the random 128-bit token in the message''s links. pack_task_id: the daily batch approval when the campaign approves each day''s batch.';

-- ═══════════════════════════════════════════════════════════════════════════
-- C) b2b_suppressions
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.b2b_suppressions (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email              text        CHECK (email IS NULL OR email = lower(email)),
  domain             text        CHECK (domain IS NULL OR domain = lower(domain)),
  reason             text        NOT NULL CHECK (reason IN ('optout', 'bounce', 'negative', 'manual', 'partner')),
  source_message_id  uuid        REFERENCES public.b2b_messages(id),
  created_by         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR domain IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS b2b_suppressions_email ON public.b2b_suppressions (email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS b2b_suppressions_domain ON public.b2b_suppressions (domain) WHERE domain IS NOT NULL AND email IS NULL;

COMMENT ON TABLE public.b2b_suppressions IS
  'One do-not-contact list for every B2B campaign and mailbox: an address, or a whole domain (email NULL). Checked on every send.';

-- ═══════════════════════════════════════════════════════════════════════════
-- E) b2b_message_events
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.b2b_message_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  uuid        NOT NULL REFERENCES public.b2b_messages(id),
  kind        text        NOT NULL CHECK (kind IN ('sent', 'bounce_hard', 'bounce_soft', 'auto_reply', 'reply', 'open', 'click', 'scanner', 'optout')),
  at          timestamptz NOT NULL DEFAULT now(),
  detail      jsonb       NOT NULL DEFAULT '{}'::jsonb
);
-- Opens / clicks are de-duplicated in code (same message, kind and link within 1 hour); this index serves that check.
CREATE INDEX IF NOT EXISTS b2b_message_events_dedupe ON public.b2b_message_events (message_id, kind, ((detail ->> 'n')), at DESC);
CREATE INDEX IF NOT EXISTS b2b_message_events_at ON public.b2b_message_events (at);
CREATE INDEX IF NOT EXISTS b2b_message_events_inbound ON public.b2b_message_events ((detail ->> 'inbound_id')) WHERE detail ? 'inbound_id';

COMMENT ON TABLE public.b2b_message_events IS
  'What happened to each B2B e-mail. detail: {n, url} for clicks, {code} for bounces, {reply_id, inbound_id, graph_id, mailbox_id} for replies. scanner = a link-scanner click, left out of reports.';

-- ═══════════════════════════════════════════════════════════════════════════
-- F) b2b_campaigns
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.b2b_campaigns ADD COLUMN IF NOT EXISTS mailbox_ids   uuid[]  NOT NULL DEFAULT '{}';
ALTER TABLE public.b2b_campaigns ADD COLUMN IF NOT EXISTS track_opens   boolean NOT NULL DEFAULT false;
ALTER TABLE public.b2b_campaigns ADD COLUMN IF NOT EXISTS approve_daily boolean NOT NULL DEFAULT false;
ALTER TABLE public.b2b_campaigns ADD COLUMN IF NOT EXISTS send_gaps     int[]   NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.b2b_campaigns.mailbox_ids IS 'Mailboxes chosen on the go-live approval; prospects are spread round-robin and keep their mailbox.';
COMMENT ON COLUMN public.b2b_campaigns.send_gaps IS 'Day of each e-mail from the approved words, e.g. {0,4,10}.';
COMMENT ON COLUMN public.b2b_campaigns.metrics IS
  '{found, contactable, emailed, delivered, bounced, opened (null when opens are not measured), clicked, replied, optouts, warm, partners} rolled up by PM; plus approved, contacts_missing, meetings, orders.';

-- ═══════════════════════════════════════════════════════════════════════════
-- G) b2b_prospects
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.b2b_prospects ADD COLUMN IF NOT EXISTS klaviyo_profile_id  text;
ALTER TABLE public.b2b_prospects ADD COLUMN IF NOT EXISTS contacts_checked_at timestamptz;

ALTER TABLE public.b2b_prospects DROP CONSTRAINT IF EXISTS b2b_prospects_status_check;
ALTER TABLE public.b2b_prospects ADD CONSTRAINT b2b_prospects_status_check
  CHECK (status IN ('sample', 'approved', 'rejected', 'found', 'queued', 'contacted', 'replied', 'warm', 'partner',
                    'opted_out', 'bounced', 'excluded'));

-- contact: {role, type, has_contact}. PM fills has_contact from b2b_contacts; HQ never sees an address.
-- The old in_hubspot key is still accepted (and ignored) so the code on main keeps working until this merges.
ALTER TABLE public.b2b_prospects DROP CONSTRAINT IF EXISTS b2b_prospects_contact_check;
UPDATE public.b2b_prospects
SET contact = (contact - 'in_hubspot') || jsonb_build_object('has_contact', false)
WHERE contact ? 'in_hubspot' OR NOT contact ? 'has_contact';
ALTER TABLE public.b2b_prospects ADD CONSTRAINT b2b_prospects_contact_check
  CHECK (contact - 'role' - 'type' - 'has_contact' - 'in_hubspot' = '{}'::jsonb
         AND coalesce(contact ->> 'type', 'none') IN ('named', 'generic', 'none'));
ALTER TABLE public.b2b_prospects ALTER COLUMN contact SET DEFAULT '{"type":"none","has_contact":false}'::jsonb;

COMMENT ON COLUMN public.b2b_prospects.contact IS
  '{role, type: named|generic|none, has_contact}. NO names, e-mails or phones. has_contact is set by PM from b2b_contacts (a usable primary contact exists).';

-- ═══════════════════════════════════════════════════════════════════════════
-- H) b2b_replies
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.b2b_replies ADD COLUMN IF NOT EXISTS message_id uuid REFERENCES public.b2b_messages(id);
CREATE INDEX IF NOT EXISTS b2b_replies_message ON public.b2b_replies (message_id) WHERE message_id IS NOT NULL;
COMMENT ON COLUMN public.b2b_replies.hubspot_ref IS 'Unused since migration 27 (HubSpot is not used); kept because columns are never dropped.';
COMMENT ON TABLE public.b2b_replies IS
  'Replies to B2B outreach, created by PM''s inbox poller (message_id = the e-mail they answered). summary: the reply itself, quoted history stripped. A person answers from the trade mailbox and marks it done; opt-outs, bounces, out-of-office and not-interested are status auto.';

-- ═══════════════════════════════════════════════════════════════════════════
-- I) notifications
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('mention', 'comment_on_owned', 'auto_assigned',
                  'approval_request', 'approval_reminder', 'approval_escalated', 'approval_comment', 'approval_moved', 'idea_reply',
                  'b2b_reply', 'b2b_contacts', 'b2b_alert'));

-- ═══════════════════════════════════════════════════════════════════════════
-- Access: server-only
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.b2b_mailboxes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.b2b_contacts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.b2b_suppressions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.b2b_messages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.b2b_message_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.b2b_mailboxes, public.b2b_contacts, public.b2b_suppressions, public.b2b_messages, public.b2b_message_events
  FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
