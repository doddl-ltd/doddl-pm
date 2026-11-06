-- Migration: 25-approvals-v2
-- Description: Approvals v2 (docs/approvals-v2/CONTRACT.md; Jon signed off the designs 2026-11-06).
--
--   A) approval_rules       who approves what, one row per area, seeded with Jon's agreed set-up
--   B) approval_rules_log   append-only change log
--   C) tasks                approval_area, approvers, the 24-48-72h clock, edits, line decisions,
--                           reject reason; wider decision CHECK; decision lock covers the new columns
--   D) approval_votes       one vote per person (two-approver areas)
--   E) approval_comments    anchored review comments
--   F) content_items        the creative studio and the content calendar
--   G) ideas                "Give HQ an idea"
--   H) listing_products / listing_fields / listing_events   Amazon listings, live vs should-be
--   I) who sees what        approvers and the escalated backup always see the approval (extends 23)
--   J) notifications        approval notification types
--   K) agent key scopes     content:write, listings:write, ideas:read, ideas:write for doddl-hq
--
-- Server-only like every PM table (17-pm-lockdown): anon / authenticated get nothing; the app reads through
-- /api/db and writes through /api/approvals/*, agents through /api/agent/*.
--
-- Additive and idempotent: IF NOT EXISTS / CREATE OR REPLACE / ON CONFLICT DO NOTHING. Re-applying never
-- overwrites a rule Jon has since changed. No deletes on projects / tasks / task_groups.

-- ═══════════════════════════════════════════════════════════════════════════
-- A) approval_rules
-- ═══════════════════════════════════════════════════════════════════════════

-- Who may change the rules (Jon, plus anyone given the flag later).
ALTER TABLE public.people ADD COLUMN IF NOT EXISTS approval_admin boolean NOT NULL DEFAULT false;
UPDATE public.people SET approval_admin = true WHERE name = 'Jon' AND NOT approval_admin;
COMMENT ON COLUMN public.people.approval_admin IS 'May change "Who approves what" (approval_rules). Jon.';

CREATE TABLE IF NOT EXISTS public.approval_rules (
  area                   text        PRIMARY KEY CHECK (area ~ '^[a-z][a-z0-9_]*$'),
  label                  text        NOT NULL,
  what                   text,
  approver               text        REFERENCES public.people(name) ON UPDATE CASCADE ON DELETE SET NULL,
  backup                 text        REFERENCES public.people(name) ON UPDATE CASCADE ON DELETE SET NULL,
  second_approver        text        REFERENCES public.people(name) ON UPDATE CASCADE ON DELETE SET NULL,
  spend_threshold_weekly numeric     CHECK (spend_threshold_weekly IS NULL OR spend_threshold_weekly >= 0),
  threshold_currency     text        NOT NULL DEFAULT 'GBP' CHECK (threshold_currency ~ '^[A-Z]{3}$'),
  threshold_also_needs   text        REFERENCES public.people(name) ON UPDATE CASCADE ON DELETE SET NULL,
  batch_mode             text        NOT NULL DEFAULT 'single'
                         CHECK (batch_mode IN ('single', 'off', 'weekly', 'daily', 'monthly', 'pack')),
  batch_day              text        CHECK (batch_day IS NULL OR batch_day IN ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')),
  reply_by               time,
  max_pack               int         CHECK (max_pack IS NULL OR max_pack > 0),
  spend_applies          boolean     NOT NULL DEFAULT false,
  batchable              boolean     NOT NULL DEFAULT true,
  note                   text,
  position               int         NOT NULL DEFAULT 0,
  updated_by             text,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  last_read_by           text,
  last_read_at           timestamptz
);

COMMENT ON TABLE public.approval_rules IS
  'Who approves what (board 4). approver null = "Not set". backup takes over at 48h. second_approver must also approve. spend_applies: the area moves money, so a weekly spend threshold can be set; above it threshold_also_needs must approve too. batchable=false areas are always single cards (note says why). Changed by people with approval_admin via PUT /api/approvals/rules/:area only; every change is in approval_rules_log.';

INSERT INTO public.approval_rules
  (area, label, what, approver, backup, second_approver, batch_mode, batch_day, reply_by, max_pack, spend_applies, batchable, note, position, updated_by)
VALUES
  ('amazon_ads',       'Amazon ads',             'Budgets, bids, keywords',                         'Jon',   'Chris', NULL,  'weekly',  NULL,  NULL,    NULL, true,  true,  NULL, 1,  'migration 25'),
  ('amazon_listings',  'Amazon listings',        'Title, bullets, images, A+',                      'Jon',   'Laura', NULL,  'single',  NULL,  NULL,    NULL, false, false, 'Always single: one product per card.', 2, 'migration 25'),
  ('paid_media',       'Paid social and search', 'Budget moves, new ads, pauses',                   'Jon',   'Chris', NULL,  'weekly',  NULL,  NULL,    NULL, true,  true,  NULL, 3,  'migration 25'),
  ('email',            'Email (Klaviyo)',        'Sends, schedules, flow changes',                  'Laura', 'Jon',   NULL,  'off',     NULL,  NULL,    NULL, false, true,  NULL, 4,  'migration 25'),
  ('organic_social',   'Organic social',         'Posts, captions, images',                         'Laura', 'Cat',   NULL,  'weekly',  'wed', NULL,    NULL, false, true,  NULL, 5,  'migration 25'),
  ('comments_dms',     'Comments and DMs',       'Every reply, every day · urgent issues single',   'Laura', 'Cathy', NULL,  'daily',   NULL,  '17:00', NULL, false, true,  NULL, 6,  'migration 25'),
  ('website',          'Website',                'Theme and page changes',                          'Jon',   'Laura', NULL,  'single',  NULL,  NULL,    NULL, false, false, 'Always single: one change set per card, with its preview.', 7, 'migration 25'),
  ('content_calendar', 'Content calendar',       'The month''s briefs',                             'Laura', 'Jon',   NULL,  'monthly', NULL,  NULL,    NULL, false, true,  NULL, 8,  'migration 25'),
  ('outreach',         'B2B, PR and creators',   'Outreach, pitches, briefs',                       'Jon',   'Laura', NULL,  'pack',    NULL,  NULL,    25,   false, true,  NULL, 9,  'migration 25'),
  ('app_recipes',      'App recipes',            'Recipes and feeding guides',                      NULL,    'Laura', 'Jon', 'off',     NULL,  NULL,    NULL, false, true,  NULL, 10, 'migration 25')
ON CONFLICT (area) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- B) approval_rules_log — append-only
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.approval_rules_log (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  area        text        REFERENCES public.approval_rules(area) ON UPDATE CASCADE,
  changed_by  text        NOT NULL,
  change      text        NOT NULL,
  reason      text,
  before      jsonb,
  after       jsonb,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS approval_rules_log_at ON public.approval_rules_log (at DESC);

CREATE OR REPLACE FUNCTION public.approval_rules_log_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'approval_rules_log is append-only' USING ERRCODE = 'P0001';
END $$;

DROP TRIGGER IF EXISTS approval_rules_log_append_only ON public.approval_rules_log;
CREATE TRIGGER approval_rules_log_append_only
  BEFORE UPDATE OR DELETE ON public.approval_rules_log
  FOR EACH ROW EXECUTE FUNCTION public.approval_rules_log_append_only();

INSERT INTO public.approval_rules_log (area, changed_by, change, reason)
SELECT NULL, 'system', 'Who approves what set up from the agreed workflow', 'Approvals v2 sign-off, 6 Nov 2026 (migration 25)'
WHERE NOT EXISTS (SELECT 1 FROM public.approval_rules_log);

-- ═══════════════════════════════════════════════════════════════════════════
-- C) tasks
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS approval_area  text REFERENCES public.approval_rules(area) ON UPDATE CASCADE;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS approvers      text[];
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS expires_at     timestamptz;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS reminded_at    timestamptz;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS escalated_to   text REFERENCES public.people(name) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS escalated_at   timestamptz;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS decision_edits jsonb;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS line_decisions jsonb;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS reject_reason  text;

ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_reject_reason_check;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_reject_reason_check
  CHECK (reject_reason IS NULL OR reject_reason IN ('timing', 'off_brand', 'evidence', 'other'));

ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_decision_check;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_decision_check
  CHECK (decision IS NULL OR decision IN ('approved', 'approved_with_edits', 'partially_approved', 'revision_requested', 'rejected', 'expired'));

COMMENT ON COLUMN public.tasks.approval_area  IS 'Approvals v2 area (approval_rules.area).';
COMMENT ON COLUMN public.tasks.approvers      IS 'Everyone who must approve, snapshotted from approval_rules at submit: [approver, second_approver?, threshold_also_needs?]. The escalated backup can answer for approvers[1] (the first). Null = a pre-v2 approval (anyone may decide, as before).';
COMMENT ON COLUMN public.tasks.expires_at     IS 'created_at + 72h, a daily pack''s reply-by time, or what the agent asked for. At this time the clock sets decision = expired.';
COMMENT ON COLUMN public.tasks.line_decisions IS '{"<line_id>": "approved"|"rejected"|"edited"|"push"|"keep"|"edit", "<line_id>:edit": <edited value>}';

CREATE INDEX IF NOT EXISTS tasks_open_approvals ON public.tasks (expires_at)
  WHERE task_type = 'approval' AND decision IS NULL AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS tasks_approval_area ON public.tasks (approval_area) WHERE approval_area IS NOT NULL;

-- Decision lock (16-pm-hardening E) now covers the v2 decision columns too.
CREATE OR REPLACE FUNCTION public.tasks_decision_lock()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.decision IS NOT NULL AND (
       NEW.decision       IS DISTINCT FROM OLD.decision
    OR NEW.decision_by    IS DISTINCT FROM OLD.decision_by
    OR NEW.decision_at    IS DISTINCT FROM OLD.decision_at
    OR NEW.decision_notes IS DISTINCT FROM OLD.decision_notes
    OR NEW.decision_edits IS DISTINCT FROM OLD.decision_edits
    OR NEW.line_decisions IS DISTINCT FROM OLD.line_decisions
    OR NEW.reject_reason  IS DISTINCT FROM OLD.reject_reason
    OR NEW.artefact       IS DISTINCT FROM OLD.artefact
    OR NEW.artefact_type  IS DISTINCT FROM OLD.artefact_type
    OR NEW.staging_url    IS DISTINCT FROM OLD.staging_url) THEN
    RAISE EXCEPTION 'Task % has a recorded decision (%). The decision and its artefact are immutable; submit a revision as a new approval task.',
      OLD.id, OLD.decision USING ERRCODE = 'P0001';
  END IF;
  IF NEW.decision IS NOT NULL AND OLD.decision IS NULL THEN
    IF NEW.decision_by IS NULL OR btrim(NEW.decision_by) = '' THEN
      RAISE EXCEPTION 'decision_by is required when recording a decision' USING ERRCODE = '23502';
    END IF;
    NEW.decision_at := coalesce(NEW.decision_at, now());
  END IF;
  RETURN NEW;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- D) approval_votes
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.approval_votes (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id        uuid        NOT NULL REFERENCES public.tasks(id),
  voter          text        NOT NULL,
  role           text        NOT NULL DEFAULT 'approver' CHECK (role IN ('approver', 'second', 'backup', 'any')),
  vote           text        NOT NULL CHECK (vote IN ('approved', 'approved_with_edits', 'partially_approved', 'revision_requested', 'rejected')),
  notes          text,
  edits          jsonb,
  lines          jsonb,
  reject_reason  text        CHECK (reject_reason IS NULL OR reject_reason IN ('timing', 'off_brand', 'evidence', 'other')),
  at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, voter)
);
CREATE INDEX IF NOT EXISTS approval_votes_task ON public.approval_votes (task_id);

-- A vote is a record of what someone decided: it never changes.
CREATE OR REPLACE FUNCTION public.approval_votes_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'approval_votes are immutable' USING ERRCODE = 'P0001';
END $$;

DROP TRIGGER IF EXISTS approval_votes_immutable ON public.approval_votes;
CREATE TRIGGER approval_votes_immutable
  BEFORE UPDATE OR DELETE ON public.approval_votes
  FOR EACH ROW EXECUTE FUNCTION public.approval_votes_immutable();

-- ═══════════════════════════════════════════════════════════════════════════
-- E) approval_comments
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.approval_comments (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      uuid        NOT NULL REFERENCES public.tasks(id),
  author       text        NOT NULL,
  body         text        NOT NULL CHECK (btrim(body) <> ''),
  anchor       jsonb       CHECK (anchor IS NULL OR anchor ->> 'kind' IN ('time', 'point', 'field', 'line')),
  resolved     boolean     NOT NULL DEFAULT false,
  resolved_by  text,
  resolved_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS approval_comments_task ON public.approval_comments (task_id, created_at);

COMMENT ON COLUMN public.approval_comments.anchor IS
  '{kind:"time", t:"0:03"} | {kind:"point", placement, x, y} (0-1) | {kind:"field", field} | {kind:"line", line_id}';

-- ═══════════════════════════════════════════════════════════════════════════
-- F) content_items
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.content_items (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  external_ref     text        NOT NULL UNIQUE,
  type             text        NOT NULL CHECK (type IN ('ad', 'video', 'social', 'email', 'listing', 'amazon_ads', 'website', 'outreach', 'recipe')),
  title            text        NOT NULL,
  markets          text[]      NOT NULL DEFAULT '{}',
  channel          text,
  stage            text        NOT NULL DEFAULT 'brief' CHECK (stage IN ('brief', 'make', 'check', 'ready', 'scheduled', 'live', 'done', 'dropped')),
  owner            text,
  approver         text,
  approval_task_id uuid        REFERENCES public.tasks(id),
  status_text      text,
  status_tone      text        CHECK (status_tone IS NULL OR status_tone IN ('ok', 'warn', 'bad', 'info', 'muted')),
  format           text,
  thumb_url        text,
  stage_since      timestamptz NOT NULL DEFAULT now(),
  stage_sla_hours  numeric     CHECK (stage_sla_hours IS NULL OR stage_sla_hours > 0),
  scheduled_at     timestamptz,
  live_at          timestamptz,
  results          jsonb,
  brief            jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_items_stage ON public.content_items (stage);
CREATE INDEX IF NOT EXISTS content_items_scheduled ON public.content_items (scheduled_at) WHERE scheduled_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS content_items_live ON public.content_items (live_at) WHERE live_at IS NOT NULL;

COMMENT ON TABLE public.content_items IS
  'Creative studio + content calendar. Agents upsert on external_ref (PUT /api/agent/content-items). Stuck = now - stage_since > stage_sla_hours.';

-- Moving stage resets stage_since (unless the writer set it explicitly); updated_at always moves.
CREATE OR REPLACE FUNCTION public.content_items_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.stage IS DISTINCT FROM OLD.stage AND NEW.stage_since IS NOT DISTINCT FROM OLD.stage_since THEN
    NEW.stage_since := now();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS content_items_touch ON public.content_items;
CREATE TRIGGER content_items_touch
  BEFORE UPDATE ON public.content_items
  FOR EACH ROW EXECUTE FUNCTION public.content_items_touch();

-- ═══════════════════════════════════════════════════════════════════════════
-- G) ideas
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.ideas (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  text          text        NOT NULL CHECK (btrim(text) <> ''),
  persona       text,
  age_stages    text[]      NOT NULL DEFAULT '{}',
  channels      text[]      NOT NULL DEFAULT '{}',
  markets       text[]      NOT NULL DEFAULT '{}',
  timing        text,
  offer         text,
  must_include  text,
  must_avoid    text,
  measure       text,
  created_by    text        NOT NULL,
  status        text        NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'picked_up', 'briefed', 'declined')),
  hq_reply      text,
  brief_ref     text,
  replied_by    text,
  replied_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ideas_status ON public.ideas (status, created_at DESC);

DROP TRIGGER IF EXISTS ideas_updated_at ON public.ideas;
CREATE TRIGGER ideas_updated_at
  BEFORE UPDATE ON public.ideas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- H) Amazon listings
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.listing_products (
  asin            text        NOT NULL,
  marketplace     text        NOT NULL,
  sku             text,
  product         text,
  colour          text,
  parent_asin     text,
  listing_status  text,
  buy_box         text,
  should_source   text,
  checked_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (asin, marketplace)
);

CREATE TABLE IF NOT EXISTS public.listing_fields (
  asin         text        NOT NULL,
  marketplace  text        NOT NULL,
  field        text        NOT NULL,
  position     int,
  limit_text   text,
  should       jsonb,
  should_meta  text,
  live         jsonb,
  live_meta    text,
  status       text        NOT NULL DEFAULT 'match' CHECK (status IN ('match', 'drift', 'proposed', 'in_flight', 'problem', 'na')),
  note         text,
  checked_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (asin, marketplace, field),
  FOREIGN KEY (asin, marketplace) REFERENCES public.listing_products(asin, marketplace)
);

CREATE TABLE IF NOT EXISTS public.listing_events (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  asin         text        NOT NULL,
  marketplace  text        NOT NULL,
  at           timestamptz NOT NULL DEFAULT now(),
  text         text        NOT NULL,
  kind         text        NOT NULL CHECK (kind IN ('amazon_change', 'our_change', 'check', 'suppressed')),
  UNIQUE (asin, marketplace, at, text),
  FOREIGN KEY (asin, marketplace) REFERENCES public.listing_products(asin, marketplace)
);
CREATE INDEX IF NOT EXISTS listing_events_listing ON public.listing_events (asin, marketplace, at DESC);

COMMENT ON TABLE public.listing_fields IS
  'One row per listing field: Title, Bullet 1-5, Description, Search terms, Images, A+ content, Price, Variations, Category, Age range, Safety documents, Buy Box. Images: live/should are arrays of {slot, label, url, px}.';

-- ═══════════════════════════════════════════════════════════════════════════
-- I) who sees what (extends 23-pm-visibility)
-- ═══════════════════════════════════════════════════════════════════════════
-- Everyone who must approve, and the backup once escalated, always sees the approval (like the assignee).

CREATE OR REPLACE FUNCTION public.pm_task_approver(approvers text[], escalated_to text, viewer text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT viewer IS NOT NULL AND (public.pm_in(approvers, viewer) OR lower(btrim(coalesce(escalated_to, ''))) = lower(btrim(viewer)))
$$;

CREATE OR REPLACE FUNCTION public.pm_visible(r public.tasks) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT public.pm_task_row_visible(r.assigned_to, r.visible_to, r.project_id, v) OR public.pm_task_approver(r.approvers, r.escalated_to, v)
  FROM (SELECT public.pm_viewer() AS v) s
$$;

CREATE OR REPLACE FUNCTION public.pm_task_visible(t_id uuid, viewer text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT viewer IS NULL OR EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = t_id AND (public.pm_task_row_visible(t.assigned_to, t.visible_to, t.project_id, viewer)
                           OR public.pm_task_approver(t.approvers, t.escalated_to, viewer)))
$$;

CREATE OR REPLACE FUNCTION public.pm_visible(r public.approval_votes) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT public.pm_task_visible(r.task_id, public.pm_viewer())
$$;

CREATE OR REPLACE FUNCTION public.pm_visible(r public.approval_comments) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT public.pm_task_visible(r.task_id, public.pm_viewer())
$$;

REVOKE ALL ON FUNCTION public.pm_task_approver(text[], text, text), public.pm_visible(public.approval_votes),
  public.pm_visible(public.approval_comments)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pm_task_approver(text[], text, text), public.pm_visible(public.approval_votes),
  public.pm_visible(public.approval_comments), public.pm_visible(public.tasks), public.pm_task_visible(uuid, text)
  TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- J) notifications
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('mention', 'comment_on_owned', 'auto_assigned',
                  'approval_request', 'approval_reminder', 'approval_escalated', 'approval_comment', 'approval_moved', 'idea_reply'));

-- ═══════════════════════════════════════════════════════════════════════════
-- K) agent key scopes (doddl-hq; a no-op where its key is not loaded)
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE public.agent_keys
SET scopes = (SELECT array_agg(DISTINCT s ORDER BY s) FROM unnest(scopes || ARRAY['content:write', 'listings:write', 'ideas:read', 'ideas:write']) s)
WHERE agent_id = 'doddl-hq' AND revoked_at IS NULL
  AND NOT (scopes @> ARRAY['content:write', 'listings:write', 'ideas:read', 'ideas:write']);

COMMENT ON TABLE public.agent_keys IS
  'sha256(key) only. Plaintext keys live in Key Vault doddl-kv-prod as pm-agent-key-<agent_id>. Scopes: tasks:read, tasks:write, inbox:write, inbox:triage, approvals:write, content:write, listings:write, ideas:read, ideas:write.';

-- ═══════════════════════════════════════════════════════════════════════════
-- Access: server-only
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.approval_rules     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_rules_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_votes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_comments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ideas              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listing_products   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listing_fields     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listing_events     ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.approval_rules, public.approval_rules_log, public.approval_votes, public.approval_comments,
              public.content_items, public.ideas, public.listing_products, public.listing_fields, public.listing_events
  FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
