-- Migration: 26-b2b-campaigns
-- Description: B2B campaigns (docs/b2b-campaigns/CONTRACT.md; Jon signed off the designs 2026-11-09, "Build this").
--
--   A) b2b_business_types   the kinds of business we talk to, seeded with the 9 examples (is_template)
--   B) b2b_campaigns        one kind of business, one place, one goal; its stage and linked approvals
--   C) b2b_prospects        the businesses HQ found (contact ROLE and type only: never names, e-mails or phones)
--   D) b2b_replies          replies HQ classified; the named person answers by due_at
--   E) the B2B project      every B2B approval task lives in one project
--   F) notifications        b2b_reply, b2b_contacts
--   G) agent key scopes     b2b:read, b2b:write for doddl-hq
--
-- Server-only like every PM table (17-pm-lockdown): anon / authenticated get nothing; the app reads through
-- /api/db (GET) and writes through /api/b2b/*, agents through /api/agent/b2b/*.
--
-- Additive and idempotent: IF NOT EXISTS / CREATE OR REPLACE / ON CONFLICT DO NOTHING. Re-applying never
-- overwrites a business type someone has changed. No deletes on projects / tasks / task_groups.

-- ═══════════════════════════════════════════════════════════════════════════
-- A) b2b_business_types
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.b2b_business_types (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           text        NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9_-]*$'),
  name           text        NOT NULL CHECK (btrim(name) <> ''),
  description    text,
  line           text,
  kinds          jsonb       NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(kinds) = 'array'),
  size           text,
  who_decides    text,
  must           text[]      NOT NULL DEFAULT '{}',
  nice           text[]      NOT NULL DEFAULT '{}',
  rule_out       text[]      NOT NULL DEFAULT '{}',
  sources        text,
  wants          text,
  contact_rules  text,
  defaults       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  learned_rules  jsonb       NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(learned_rules) = 'array'),
  is_template    boolean     NOT NULL DEFAULT false,
  position       int         NOT NULL DEFAULT 100,
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.b2b_business_types IS
  'Kinds of business for B2B campaigns. kinds: [{t, on}]. defaults: {goal, offers, country, sample_size} the wizard preselects. learned_rules: [{rule, from_reason, count, campaign_id, at}] appended by HQ from sample reject reasons. is_template = one of the 9 seeded examples.';

DROP TRIGGER IF EXISTS b2b_business_types_updated_at ON public.b2b_business_types;
CREATE TRIGGER b2b_business_types_updated_at
  BEFORE UPDATE ON public.b2b_business_types
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

INSERT INTO public.b2b_business_types
  (slug, name, description, line, kinds, size, who_decides, must, nice, rule_out, sources, wants, contact_rules, defaults, is_template, position, created_by)
VALUES
  ('nurseries', 'Nurseries and early years', 'Day nurseries and pre-schools feeding babies and toddlers every day.',
   'Day nurseries and pre-schools that care for and feed children under 2',
   '[{"t":"Day nurseries","on":true},{"t":"Pre-schools","on":true},{"t":"Nursery groups (2 to 10 sites)","on":true},{"t":"Childminders","on":false}]',
   '20 or more registered places', 'Owner, manager or nursery cook',
   ARRAY['Takes children under 2', 'Serves meals on site', 'Registered and open'],
   ARRAY['Rated Good or Outstanding', 'Mentions weaning or healthy eating', 'Active on social media'],
   ARRAY['Childminder or sole trader', 'National chain head office', 'Already a customer'],
   'Childcare registers (Ofsted, Care Inspectorate, CIW), nursery websites, Google Maps',
   'A free set to try, then a bulk price per set',
   'Companies and partnerships only; sole traders need consent first. Opt-out in every email.',
   '{"goal":"trial","offers":["sample","trade"],"country":"GB","sample_size":25}', true, 1, 'migration 26'),
  ('distributors', 'Distributors and wholesalers', 'Firms that take brands into shops and pharmacies in a country we don’t sell to directly.',
   'Distributors of baby, nursery or feeding products that supply pharmacies and baby retailers',
   '[{"t":"Baby and nursery distributors","on":true},{"t":"Pharmacy wholesalers","on":true},{"t":"Gift and homeware distributors","on":true},{"t":"Supermarket suppliers","on":false}]',
   'More than 5 staff; carries at least 3 brands', 'Purchasing or brand director; managing director at smaller firms',
   ARRAY['Sells to pharmacies or baby shops', 'Carries feeding or tableware brands', 'Trading 2 years or more'],
   ARRAY['Exhibits at baby trade shows', 'Covers neighbouring countries', 'Premium or design-led brands'],
   ARRAY['Supermarkets only', 'Distributes a direct competitor', 'Marketplace sellers only'],
   'National company registers, trade-show exhibitor lists, distributor websites',
   'An intro call, margins and a sample box',
   'Business email, relevant to their job, opt-out in every message; written in their language.',
   '{"goal":"calls","offers":["call","sample"],"country":"FR","sample_size":15}', true, 2, 'migration 26'),
  ('independent_shops', 'Independent baby and gift shops', 'Boutiques that choose their own brands and like a story to tell.',
   'Independent shops selling baby, toddler or gift products',
   '[{"t":"Baby boutiques","on":true},{"t":"Toy shops","on":true},{"t":"Gift shops","on":true},{"t":"Garden centres with a baby range","on":true}]',
   '1 to 5 shops', 'Owner or buyer',
   ARRAY['Sells baby or toddler products', 'Has a physical shop'],
   ARRAY['Stocks premium brands', 'Has an online shop too', 'Strong Instagram'],
   ARRAY['Already a stockist', 'Discount stores'],
   'Google Maps, shop websites, Instagram, trade directories',
   'Wholesale terms and a starter pack',
   'Companies only by email; sole traders by phone or with consent.',
   '{"goal":"stock","offers":["starter","trade"],"country":"GB","sample_size":20}', true, 3, 'migration 26'),
  ('pharmacies', 'Pharmacies', 'Independent pharmacies and small chains with a baby aisle.',
   'Pharmacies with a baby and child section',
   '[{"t":"Independent pharmacies","on":true},{"t":"Small pharmacy groups","on":true},{"t":"Large chains","on":false}]',
   'Any; groups of up to 20', 'Pharmacy owner or category buyer',
   ARRAY['Has a baby section'],
   ARRAY['Stocks feeding brands', 'Family-focused location'],
   ARRAY['Hospital pharmacies'],
   'Pharmacy registers, Google Maps, group websites',
   'Reliable supply through their usual wholesaler',
   'Often reached via a distributor rather than direct.',
   '{"goal":"stock","offers":["trade","starter"],"country":"FR","sample_size":20}', true, 4, 'migration 26'),
  ('department_stores', 'Department stores and retail buyers', 'National and regional stores with a baby or gift department.',
   'Department stores and retailers with baby or gift departments',
   '[{"t":"Department stores","on":true},{"t":"National baby retailers","on":true},{"t":"Online baby retailers","on":true}]',
   'Regional or national', 'Category buyer for baby, nursery or gifts',
   ARRAY['Has a baby or gift department'],
   ARRAY['Stocks premium baby brands', 'Has a seasonal gift range'],
   ARRAY['Already stocks doddl'],
   'Store websites, trade press',
   'A range story, margins and launch support',
   'Named buyers by email or LinkedIn; one follow-up.',
   '{"goal":"calls","offers":["call","starter"],"country":"GB","sample_size":10}', true, 5, 'migration 26'),
  ('sen', 'SEN schools, therapists and charities', 'People who support children who find feeding harder.',
   'SEN schools, occupational therapists and charities supporting children with feeding needs',
   '[{"t":"Occupational therapists","on":true},{"t":"SEN schools","on":true},{"t":"Charities","on":true},{"t":"Feeding clinics","on":true}]',
   'Any', 'Lead therapist, head teacher or charity lead',
   ARRAY['Works with children'],
   ARRAY['Mentions feeding or fine motor skills', 'Runs parent sessions'],
   ARRAY['Adults only'],
   'Professional directories, school lists, charity registers',
   'Samples for their families and a discount code to share',
   'Careful, plain wording; no health claims beyond the approved register.',
   '{"goal":"refer","offers":["sample","code"],"country":"GB","sample_size":20}', true, 6, 'migration 26'),
  ('gifting', 'Corporate gifting and baby boxes', 'Companies that send gifts to new parents, staff or clients.',
   'Gift box, subscription and corporate gifting companies with a new-baby range',
   '[{"t":"Baby box companies","on":true},{"t":"Corporate gifting firms","on":true},{"t":"Subscription boxes","on":true}]',
   'Any', 'Founder or buyer',
   ARRAY['Sells new-baby or toddler gifts'],
   ARRAY['Premium positioning', 'Ships nationally'],
   ARRAY['Discount boxes'],
   'Websites, Instagram, gifting directories',
   'Bulk price and branded inserts',
   'Companies only by email.',
   '{"goal":"bulk","offers":["trade","sample"],"country":"GB","sample_size":15}', true, 7, 'migration 26'),
  ('family_hospitality', 'Family hotels and cafés', 'Places that feed young families away from home.',
   'Family-friendly hotels, holiday parks and cafés with a kids’ menu',
   '[{"t":"Family hotels","on":true},{"t":"Holiday parks","on":true},{"t":"Cafés and restaurants","on":true}]',
   'Any', 'Owner, general manager or head chef',
   ARRAY['Serves food to young children'],
   ARRAY['Markets itself as family-friendly', 'Kids’ menu online'],
   ARRAY['Adults-only venues'],
   'Google Maps, booking sites, venue websites',
   'Sets for high chairs and a bulk price',
   'Companies only by email.',
   '{"goal":"bulk","offers":["sample","trade"],"country":"GB","sample_size":20}', true, 8, 'migration 26'),
  ('something_else', 'Something else', 'Describe it in your own words and HQ drafts a definition for you to check.',
   NULL, '[]', NULL, NULL, '{}', '{}', '{}', NULL, NULL, NULL,
   '{"goal":"calls","offers":["call"],"country":"GB","sample_size":20}', true, 9, 'migration 26')
ON CONFLICT (slug) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- B) b2b_campaigns
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.b2b_campaigns (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text,
  business_type_id    uuid        REFERENCES public.b2b_business_types(id),
  definition          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  goal                jsonb       NOT NULL DEFAULT '{}'::jsonb
                      CHECK (goal ->> 'id' IS NULL OR goal ->> 'id' IN ('trial', 'stock', 'calls', 'deal', 'refer', 'bulk')),
  offers              text[]      NOT NULL DEFAULT '{}'
                      CHECK (offers <@ ARRAY['sample', 'trade', 'starter', 'code', 'call']),
  market              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  volume              int         CHECK (volume IS NULL OR volume > 0),
  sample_size         int         CHECK (sample_size IS NULL OR sample_size > 0),
  pace                text,
  channels            text[]      NOT NULL DEFAULT '{}'
                      CHECK (channels <@ ARRAY['email', 'linkedin', 'phone', 'post']),
  people              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  approver            text        REFERENCES public.people(name) ON UPDATE CASCADE ON DELETE SET NULL,
  stage               text        NOT NULL DEFAULT 'draft'
                      CHECK (stage IN ('draft', 'define_review', 'sampling', 'sample_review', 'finding', 'words_review',
                                       'golive_review', 'live', 'paused', 'done', 'cancelled')),
  stage_since         timestamptz NOT NULL DEFAULT now(),
  paused_from         text,
  definition_task_id  uuid        REFERENCES public.tasks(id),
  sample_task_id      uuid        REFERENCES public.tasks(id),
  words_task_id       uuid        REFERENCES public.tasks(id),
  golive_task_id      uuid        REFERENCES public.tasks(id),
  metrics             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  estimate            jsonb,
  owner               text,
  created_by          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  archived_at         timestamptz
);
CREATE INDEX IF NOT EXISTS b2b_campaigns_stage ON public.b2b_campaigns (stage) WHERE archived_at IS NULL;

COMMENT ON TABLE public.b2b_campaigns IS
  'One kind of business, in one place, for one goal. definition: snapshot of the business type with the person''s edits. goal {id, target, by}; market {country (GB|FR|DE|IE|US), regions[], language}; people {replies, calls}; metrics {found, approved, contacts_missing, emailed, opened, replied, meetings, orders}. Stage moves through /api/b2b/*, the decide hook and /api/agent/b2b/*; paused_from is the stage to resume to.';

-- Moving stage resets stage_since; updated_at always moves.
CREATE OR REPLACE FUNCTION public.b2b_campaigns_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    NEW.stage_since := now();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS b2b_campaigns_touch ON public.b2b_campaigns;
CREATE TRIGGER b2b_campaigns_touch
  BEFORE UPDATE ON public.b2b_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.b2b_campaigns_touch();

-- ═══════════════════════════════════════════════════════════════════════════
-- C) b2b_prospects
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.b2b_prospects (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id      uuid        NOT NULL REFERENCES public.b2b_campaigns(id),
  hq_ref           text        NOT NULL CHECK (btrim(hq_ref) <> ''),
  name             text        NOT NULL,
  place            text,
  details          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  sources          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  match            jsonb       NOT NULL DEFAULT '[]'::jsonb,
  fit              int         CHECK (fit IS NULL OR fit BETWEEN 0 AND 100),
  contact          jsonb       NOT NULL DEFAULT '{"type":"none","in_hubspot":false}'::jsonb
                   CHECK (contact - 'role' - 'type' - 'in_hubspot' = '{}'::jsonb
                          AND coalesce(contact ->> 'type', 'none') IN ('named', 'generic', 'none')),
  status           text        NOT NULL DEFAULT 'found'
                   CHECK (status IN ('sample', 'approved', 'rejected', 'found', 'queued', 'contacted', 'replied',
                                     'opted_out', 'bounced', 'excluded')),
  reject_reason    text,
  reject_note      text,
  excluded_reason  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, hq_ref)
);
CREATE INDEX IF NOT EXISTS b2b_prospects_campaign ON public.b2b_prospects (campaign_id, status);

COMMENT ON COLUMN public.b2b_prospects.contact IS
  '{role, type: named|generic|none, in_hubspot}. NO names, e-mails or phones: the CHECK refuses any other key. People add contact details in HubSpot.';

DROP TRIGGER IF EXISTS b2b_prospects_updated_at ON public.b2b_prospects;
CREATE TRIGGER b2b_prospects_updated_at
  BEFORE UPDATE ON public.b2b_prospects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- D) b2b_replies
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.b2b_replies (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  uuid        NOT NULL REFERENCES public.b2b_campaigns(id),
  prospect_id  uuid        REFERENCES public.b2b_prospects(id),
  kind         text        NOT NULL CHECK (kind IN ('positive', 'question', 'owner', 'ooo', 'negative', 'optout', 'bounce')),
  summary      text,
  draft        text,
  assigned_to  text        REFERENCES public.people(name) ON UPDATE CASCADE ON DELETE SET NULL,
  due_at       timestamptz,
  status       text        NOT NULL DEFAULT 'needs_person' CHECK (status IN ('needs_person', 'sent', 'closed', 'auto')),
  hubspot_ref  text,
  closed_by    text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  closed_at    timestamptz
);
CREATE INDEX IF NOT EXISTS b2b_replies_open ON public.b2b_replies (assigned_to, due_at) WHERE status = 'needs_person';
CREATE INDEX IF NOT EXISTS b2b_replies_campaign ON public.b2b_replies (campaign_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS b2b_replies_hubspot_ref ON public.b2b_replies (campaign_id, hubspot_ref) WHERE hubspot_ref IS NOT NULL;

COMMENT ON TABLE public.b2b_replies IS
  'Replies to B2B outreach. summary has no contact details. A person sends the answer (HubSpot or the outreach inbox) and marks it sent; opt-outs, bounces, out-of-office and not-interested are status auto (HQ, no person).';

-- ═══════════════════════════════════════════════════════════════════════════
-- E) the B2B project (every B2B approval task lives here)
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO public.projects (id, name, description, status, priority, owner)
VALUES ('10000000-0000-0000-0000-000000000b2b', 'B2B campaigns',
        'Approvals and to-dos for B2B campaigns (definition, sample, emails and flow, go-live, contacts to add). Managed from doddl HQ → B2B campaigns.',
        'active', 'medium', 'Jon')
ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- F) notifications
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('mention', 'comment_on_owned', 'auto_assigned',
                  'approval_request', 'approval_reminder', 'approval_escalated', 'approval_comment', 'approval_moved', 'idea_reply',
                  'b2b_reply', 'b2b_contacts'));

-- ═══════════════════════════════════════════════════════════════════════════
-- G) agent key scopes (doddl-hq; a no-op where its key is not loaded)
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE public.agent_keys
SET scopes = (SELECT array_agg(DISTINCT s ORDER BY s) FROM unnest(scopes || ARRAY['b2b:read', 'b2b:write']) s)
WHERE agent_id = 'doddl-hq' AND revoked_at IS NULL
  AND NOT (scopes @> ARRAY['b2b:read', 'b2b:write']);

COMMENT ON TABLE public.agent_keys IS
  'sha256(key) only. Plaintext keys live in Key Vault doddl-kv-prod as pm-agent-key-<agent_id>. Scopes: tasks:read, tasks:write, inbox:write, inbox:triage, approvals:write, content:write, listings:write, ideas:read, ideas:write, b2b:read, b2b:write.';

-- ═══════════════════════════════════════════════════════════════════════════
-- Access: server-only
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.b2b_business_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.b2b_campaigns      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.b2b_prospects      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.b2b_replies        ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.b2b_business_types, public.b2b_campaigns, public.b2b_prospects, public.b2b_replies
  FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
