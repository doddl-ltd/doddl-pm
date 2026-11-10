# B2B outreach mail: Microsoft 365 mailboxes, contacts, sending, tracking, Klaviyo hand-off

Jon, 2026-11-10: "HubSpot does not exist, we use Klaviyo"; "to use M365, I need to be able to connect it via the PM tool, the data for these contacts who our prospect sits in there first. When they become warm leads or we receive feedback to send over trade pack, they become active b2b partner leads and are moved into the Klaviyo database for interaction and storing. I need to be able to connect multiple emails in the PM tools as they need to come online. I also need reporting on emails sent, bounces, opens, clicks, replies etc."

This **replaces HubSpot everywhere in `CONTRACT.md`**: the B2B campaign flow (create → define → sample → words → go-live) is unchanged; what happens after go-live is now owned by doddl PM. HQ keeps an identical copy at `docs/b2b-outreach-mail.md`.

## The loop

```
HQ finds businesses ──► PM b2b_prospects (cold) ──► PM b2b_contacts (address per business)
                                                         │
                     go-live approved (pace, mailboxes)  ▼
PM sender ── Microsoft Graph, from a connected trade mailbox ──► email 1, 2, 3
                                                         │
PM inbox poller ◄── replies, bounces, auto-replies ──────┘   PM tracking ◄── clicks (+ opens if switched on), opt-outs
        │
        ├─ bounce / opt-out ──► suppression list, sequence stops (no person)
        └─ reply ──► b2b_replies, sequence stops, named person answers
                       │
                       └─ "Make partner lead" (warm / trade pack wanted) ──► Klaviyo profile on the "B2B partners" list
                                                                             prospect status `partner`; Klaviyo owns it from here
```

Who does what:
- **HQ (agents):** finds and screens businesses, learns from the sample, writes the words. It never sends, never reads mail, never sees an e-mail address.
- **doddl PM (plain code, no model):** holds contacts, sends, reads the mailboxes, tracks, reports, hands partners to Klaviyo.
- **People:** connect mailboxes, add named contacts, answer replies, click "Make partner lead".

## Hard rules (keep from CONTRACT.md, restated for mail)

- **Agents never see contact details.** `b2b_contacts` is never returned by any `/api/agent/*` route or MCP tool. Reply text reaching HQ (if ever) is redacted first. PM's own website extractor is deterministic code, not an agent.
- **Klaviyo is never used for cold e-mail** (its Acceptable Use Policy bans prospecting and scraped lists; a breach risks the consumer account). A business enters Klaviyo only after it has replied asking for more (trade pack, prices, samples), and that consent is recorded.
- **UK:** cold e-mail only to limited companies and LLPs (PECR). Sole traders, partnerships and childminders: no cold e-mail; they appear as "call or post first" for a person. **Germany:** never cold e-mail. **France:** professional relevance required (the definition). The prospect's `details.entity_type` decides; `unknown` is not sent in the UK.
- **Touches:** at most 3 e-mails per business per campaign; no business is e-mailed by two campaigns within 30 days; one suppression list (e-mail and domain) covers every campaign and every mailbox.
- **Every e-mail** carries: who we are (doddl Ltd, registered address), why they are getting it ("we found your nursery on its website"), a link to the privacy notice, and a one-click opt-out link. Replying "stop" also opts out.
- **Offers** only from the approved definition; words only as approved (merge fields `[company]`, `[place]`, `[first_name]` where a named contact exists, else a neutral greeting).

## Mailboxes (connect many, bring them online over time)

### Connecting
- Settings → **Outreach mailboxes** → "Connect a Microsoft 365 mailbox". PM admins only.
- OAuth 2.0 authorization code + PKCE against the doddl tenant (single-tenant Entra app "doddl PM outreach"), **delegated** scopes: `offline_access User.Read Mail.Send Mail.ReadWrite`. The person signs in **as the trade mailbox** (a licensed user mailbox; shared mailboxes cannot sign in).
- Redirect URI: `https://<pm host>/api/b2b/mailboxes/callback`. State + PKCE verifier in an httpOnly cookie, 10 min.
- The refresh token is stored encrypted (AES-256-GCM, key `B2B_MAIL_TOKEN_KEY` in Vercel env; never logged, never returned by any API). Access tokens are cached in memory only.
- If the tenant does not allow user consent for these scopes, a Global Admin grants admin consent once for the app. Jon is not a Global Admin; the PM screen says so plainly and links the admin-consent URL.
- Disconnect = delete the token, status `disconnected`, its queued messages move to the campaign's other mailboxes.

### Warm-up and pace
- A new mailbox starts `warming`. Daily allowance by week since `warmup_started_on`: week 1 = 10, week 2 = 20, week 3 = 30, week 4+ = `daily_cap` (default 50, max 100). After week 4 it becomes `active`.
- Send window: `send_days` (default Mon–Fri) and `send_window` (default 09:00–16:30 Europe/London), spaced 3–9 minutes apart at random so sends never burst.
- Follow-ups count toward the allowance.
- A campaign chooses one or more mailboxes at go-live (`b2b_campaigns.mailbox_ids`); prospects are spread round-robin and a business always gets all its e-mails from the same mailbox, as replies in the same thread.

### Health (auto-pause, alert the campaign owner)
- Hard-bounce rate > 5% over the mailbox's last 100 sends, or 3 hard bounces in a day → mailbox `paused` (reason stored).
- Opt-outs + negative replies > 5% over a campaign's last 100 sends → campaign sending paused.
- Graph 401 on refresh → mailbox `error` ("reconnect"). Nothing is sent from a paused, errored or disconnected mailbox.

## Contacts (prospect data sits in PM first)

- When a prospect becomes `approved` or `found`, PM's extractor fetches the business's own website (home page + `/contact`, `/contact-us`, `/about`; robots.txt honoured; 5 s timeout; 2 pages per second max) and takes e-mail addresses on the business's own domain.
  - Role addresses (`info@ office@ hello@ enquiries@ admin@ contact@ manager@ nursery@ bookings@ …`) are saved as `generic`, `source = website:<url>`, `status = ok`.
  - Personal-looking addresses are saved as `suggested` and listed under "contacts to add" for a person to accept or reject; they are not mailed until accepted.
- People can add, edit or remove contacts on the campaign's prospect row (name, role, e-mail). Source `person:<email>`.
- One contact per business is the mail target (`is_primary`).
- Checks before a contact can be mailed: syntax, MX record exists, not suppressed, not a Klaviyo partner already, domain not owned by an existing customer/partner.

## Sending (PM cron `/api/cron/b2b-send`, every 10 min)

For each mailbox that is `warming`/`active`, inside its window, with allowance left today:
1. Follow-ups first: step N+1 is due when step N was sent ≥ the approved gap (`b2b_sequence.emails[].when`, e.g. day 0 / 4 / 10), and nothing has happened since (no reply, bounce, opt-out, suppression, campaign not paused).
2. Then new businesses for live campaigns that use this mailbox, best `fit` first, passing every hard rule.
3. Send via Graph: `POST /me/messages` (draft, gets `id`, `internetMessageId`, `conversationId`) then `POST /me/messages/{id}/send`. Follow-ups use `POST /me/messages/{firstId}/createReply`, set the body, send, so they thread.
4. Body: the approved words with merge fields filled, the mailbox's signature, the compliance footer; links rewritten for click tracking; open pixel only if the campaign has opens switched on.
5. Graph does not allow a `List-Unsubscribe` header; opt-out is the footer link and "reply stop".
6. Store a `b2b_messages` row per e-mail and a `sent` event. A failed send is retried once next run, then `failed` with the error shown on the campaign.

Daily batch approvals are replaced: **the go-live approval approves the words, the mailboxes and the pace**; PM then sends within that pace. A campaign can switch on "Approve each day's batch" (then the old Approvals v2 `pack` is created each morning instead).

## Inbox (PM cron `/api/cron/b2b-inbox`, every 10 min)

- Per mailbox, Graph delta query on the Inbox (`/me/mailFolders/inbox/messages/delta`), delta link stored.
- Match to a sent message by `conversationId`, then `In-Reply-To`/`References` against `internetMessageId`.
- **Bounce** (from `postmaster`/`mailer-daemon`/`MicrosoftExchange…`, or an NDR body): parse the status code; `5.x.x` = hard (contact `bounced`, suppression), `4.x.x` = soft (retry once after 24 h, then hard).
- **Auto-reply** (`Auto-Submitted: auto-replied`, `X-Autoreply`, subject "Automatic reply"/"Out of office"): event `auto_reply`; the sequence pauses 7 days, then carries on.
- **Reply:** rule classifier (ported from HQ `src/b2b-campaigns/replies.ts`): `positive`, `question`, `owner` (wrong person, gives another), `negative`, `optout`. The sequence stops for that business. A `b2b_replies` row is created with a summary (quoted history stripped), assigned to `people.replies`, `due_at` = next working day 17:00.
- Opt-out words ("unsubscribe", "remove me", "stop") → suppression, no person needed (row created as `auto`).
- The person answers from the trade mailbox itself (Outlook) and marks the reply done in PM. A "Draft in Outlook" button may create a Graph draft reply for them; PM never sends a reply on its own.

## Tracking

- **Clicks:** each link → `https://<pm host>/api/t/c/<token>/<n>`; redirect (302) only to the URL stored on that message (no open redirect). Clicks within 60 s of sending, `HEAD` requests and known link-scanner user agents are recorded as `scanner` and left out of reports.
- **Opens:** 1×1 pixel `https://<pm host>/api/t/o/<token>.gif`, **off by default, switch per campaign.** Reasons shown on the switch: the UK ICO's guidance treats e-mail tracking pixels as needing consent under PECR; Apple Mail Privacy Protection makes opens unreliable; pixels hurt cold-mail delivery. When off, reports say "not measured", never 0.
- **Opt-out:** `https://<pm host>/api/t/u/<token>`: GET shows a confirm page, POST (one click) suppresses the address (and, by checkbox, the whole business), stops all sequences. No sign-in, no tracking on that page.
- Tokens are random 128-bit, stored hashed; they reveal nothing.

## Warm lead → partner (Klaviyo)

- Prospect statuses gain `warm` and `partner` (after `replied`).
- On a reply card, "Make partner lead" (classifier pre-selects it on `positive`) asks for: what they want (trade pack / prices / samples / call), and the contact's name if known. Then PM:
  1. Creates or updates the Klaviyo profile (main doddl account): email, first/last name, organization = business name, location, and properties `doddl_record_type = "b2b_partner"`, `doddl_b2b_campaign`, `doddl_b2b_business_type`, `doddl_b2b_partner_status = "trade_pack_requested"` (etc.), `doddl_b2b_consent = "replied to doddl trade e-mail on <date> asking for <what>"`, `doddl_pm_prospect_id`.
  2. Subscribes it to the **"B2B partners"** list (email marketing consent, with `consented_at`), created once by a script.
  3. Sets the prospect `partner` with `klaviyo_profile_id`; PM stops all sending to it.
- Klaviyo then owns the relationship (trade pack flow, nurture). PM keeps the prospect row and the history.
- Consumer separation inside the one Klaviyo account: a script audits every consumer flow, list and segment and adds `doddl_record_type is not "b2b_partner"` where a partner could fall in; the B2B list never feeds consumer flows. Partners count toward Klaviyo billable profiles (plan 10k, about 9.2k used in Oct): the reports show the count.

## Database (migration `27-b2b-outreach-mail.sql`)

- `b2b_mailboxes`: `id`, `address` unique, `display_name`, `signature_html`, `provider` ('m365'), `ms_user_id`, `status` (`connecting|warming|active|paused|error|disconnected`), `status_reason`, `daily_cap` int default 50, `warmup_started_on` date, `send_days` int[] default {1,2,3,4,5}, `send_window` jsonb default `{"from":"09:00","to":"16:30","tz":"Europe/London"}`, `token_enc` bytea/text (never selected by `/api/db`), `token_updated_at`, `delta_link`, `last_polled_at`, `connected_by`, `created_at`, `updated_at`.
- `b2b_contacts`: `id`, `prospect_id` fk, `email` (lower-case), `first_name`, `last_name`, `role`, `type` (`generic|named`), `status` (`suggested|ok|bounced|opted_out|invalid|rejected`), `is_primary`, `source`, `added_by`, `checked_at`, `created_at`, `updated_at`. Unique (`prospect_id`, `email`).
- `b2b_suppressions`: `id`, `email` nullable, `domain` nullable, `reason` (`optout|bounce|negative|manual|partner`), `source_message_id`, `created_by`, `created_at`. Checked on every send.
- `b2b_messages`: `id`, `campaign_id`, `prospect_id`, `contact_id`, `mailbox_id`, `step` int, `subject`, `body_html`, `links` jsonb, `track_token_hash`, `opens_tracked` bool, `scheduled_for`, `sent_at`, `graph_id`, `internet_message_id`, `conversation_id`, `status` (`queued|sent|failed|bounced|replied|stopped`), `error`, `created_at`.
- `b2b_message_events`: `id`, `message_id`, `kind` (`sent|bounce_hard|bounce_soft|auto_reply|reply|open|click|scanner|optout`), `at`, `detail` jsonb (link n / url, NDR code, reply id), unique-ish dedupe on (`message_id`,`kind`,`detail->>n`) for opens/clicks within 1 h.
- `b2b_campaigns`: add `mailbox_ids` uuid[], `track_opens` bool default false, `approve_daily` bool default false, `send_gaps` int[] (days, from the approved words).
- `b2b_prospects`: add `klaviyo_profile_id`, statuses `warm`, `partner`; `contact` jsonb becomes `{role, type, has_contact}` (`in_hubspot` dropped; PM fills it, HQ never sees the address).
- `b2b_replies`: `hubspot_ref` → `message_id` (fk `b2b_messages`).
- RLS like migration 26: reads through `/api/db` except `b2b_mailboxes.token_enc` and every `b2b_contacts` column for agent keys; writes only through the API.

## Reporting

- **Campaign → Report tab** and **B2B → Outreach report** (all campaigns), by day / week / whole campaign, filter by mailbox:
  - Sent (by step), delivered (= sent − bounced), hard / soft bounces and rate, opens (unique; "not measured" when off), clicks (unique, scanners excluded) and click rate, replies by kind and reply rate, auto-replies, opt-outs and rate, warm leads, partners (into Klaviyo), still to send, contacts missing.
  - Funnel: found → contactable → e-mailed → replied → warm → partner.
- **Mailbox health** (Settings → Outreach mailboxes): status, warm-up week, today's allowance / sent, 7-day sends, bounce rate, reply rate, last poll, reason if paused.
- `b2b_campaigns.metrics` stays as the summary HQ and the list read: `{found, contactable, emailed, delivered, bounced, opened|null, clicked, replied, optouts, warm, partners}`.
- Each Monday 08:00 the approvals summary includes a B2B line per live campaign.

## HQ changes (PR on doddl-hq)

- Remove HubSpot from `src/b2b-campaigns/*`: no `findCompanies`, no sequence, no enrolment proposal, no reply reading.
- De-duplication: `GET /api/agent/b2b/known-domains?domains=…` (PM answers which domains are already prospects in another live campaign, partners or suppressed: domain + reason only).
- HQ posts prospects with `details.website`, `details.entity_type`; PM finds the contacts.
- The `live` stage needs nothing from HQ except metrics; the reply classifier lives in PM.
- `docs/b2b-outreach-mail.md` = this file.

## Not in this build
- Buying the trade domain and its DNS (SPF, DKIM, DMARC): set up by Claude once Jon picks the name (domain cost needs his OK).
- LinkedIn and phone channels stay as tasks for people.

## As built: doddl PM (branch b2b-outreach-mail, 2026-11-10)

Nothing above was renamed. Where the build differs or adds, it says so here. HQ: copy this section into `docs/b2b-outreach-mail.md`.

**Database (migration `27-b2b-outreach-mail.sql`, not applied yet)**
- Tables and columns as in "Database", plus `b2b_messages.pack_task_id` (the daily batch approval, for "Approve each day's batch") and `b2b_prospects.contacts_checked_at` (the website extractor's "done" mark).
- Deploy-safe: nothing is dropped or renamed. `b2b_replies.hubspot_ref` stays (unused; new code writes `message_id`; HQ's `POST /api/agent/b2b/replies` now takes `ref`, kept in that legacy column for de-duplication). The `contact` CHECK accepts `{role, type, has_contact}` and still tolerates the old `in_hubspot` key so main keeps working until merge; existing rows are converted to `has_contact: false`. A later migration can tighten it.
- Notification type `b2b_alert` (mailbox / campaign auto-paused). One primary contact per business (partial unique index). Suppressions unique per address and per domain.
- `/api/db`: `b2b_mailboxes` is read with a forced safe column list (never `token_enc` or `delta_link`); `b2b_messages`, `b2b_message_events`, `b2b_suppressions` are readable; `b2b_contacts` is not in the proxy at all (served only by `/api/b2b/*` to signed-in people). Agents reach none of them; a test scans every agent route and MCP for it.

**Files**
- Pure rules: `lib/b2bMail/rules.js` (warm-up, window, pace, hard rules, follow-ups, approved words, merge fields + footer, links, scanners, bounce / auto-reply / reply classification ported from HQ `replies.ts`, health, report), `lib/b2bMail/crypto.js` (AES-256-GCM, tokens, PKCE), `lib/b2bMail/graph.js` (OAuth + Graph), `lib/b2bMail/extract.js` (website extractor, robots.txt, MX), `lib/b2bMail/klaviyo.js`.
- Server: `lib/pm/b2bMail.js` (mailboxes, contacts, sender, inbox, tracking, partner, report, metrics roll-up), `lib/pm/b2bKnown.js` (agent de-duplication).
- People API: `GET /api/b2b/mailboxes`, `POST /api/b2b/mailboxes/connect`, `GET /api/b2b/mailboxes/callback`, `PATCH /api/b2b/mailboxes/:id`; `GET|POST /api/b2b/prospects/:id/contacts`; `PATCH|DELETE /api/b2b/contacts/:id` (DELETE = reject); `GET /api/b2b/campaigns/:id/contacts`; `PATCH /api/b2b/campaigns/:id {track_opens?, approve_daily?}` (any stage but done / cancelled); `POST /api/b2b/replies/:id/partner`; `POST /api/b2b/replies/:id/draft` ("Draft in Outlook", never sends); `GET /api/b2b/report?campaign_id=&mailbox_id=&by=day|week|all`.
- Agent: `GET /api/agent/b2b/known-domains?domains=a,b` (b2b:read, max 50) → `{ domains: [{domain, reason}] }`, reason `prospect_in_live_campaign | partner | suppressed`; MCP `b2b_known_domains`. The go-live post ignores HQ's `contacts_missing` (null is fine), `mailboxes` and `send_gaps`: PM fills all three.
- Crons (`vercel.json`, CRON_SECRET): `/api/cron/b2b-send` every 10 min, `/api/cron/b2b-inbox` at :05, :15 …, `/api/cron/b2b-contacts` at :03, :13 … (12 businesses a run).
- Public (no sign-in; the app has no middleware): `/api/t/c/:token/:n`, `/api/t/o/:token.gif`, `/api/t/u/:token`.
- Screens: Settings → Outreach mailboxes (`components/b2b/MailboxesView.jsx`), B2B → Outreach report and the campaign Report tab (`OutreachReport.jsx`), contacts editor, contacts to add and Make partner lead (`ContactsKit.jsx`), Sending switches on the campaign, the go-live card's mailbox picker (`B2BGoliveReview.jsx`). Desktop and phone.
- Script: `scripts/b2b-klaviyo-setup.mjs` (dry run by default; `--apply` only creates the "B2B partners" list; segment and flow changes are printed for a person, never made).
- Tests: `test/b2bMail.test.mjs` plus the updated `test/b2b.test.mjs`.

**Decisions the spec left open (Claude defaults)**
- **Go-live:** the approver ticks mailboxes on the card; they travel as decision edits `{ mailbox_ids, pace? }` and `/api/approvals/decide` refuses a go-live approval without at least one. The decision records as `approved_with_edits`; the card says "Live" instead of the brand-checker text.
- **Pace inside a 10-minute cron:** each run sends the remaining allowance divided by the runs left in the window, rounded at random, at most 3 a run, 20–50 s apart, and skips a mailbox that sent in the last 3 minutes. Over a day this lands on the allowance with irregular spacing (the spec's 3–9 minutes on average).
- **Footer:** `REGISTERED_ADDRESS` and `COMPANY_NUMBER` in `lib/b2bMail/rules.js` are TO CONFIRM, and the sender sends nothing until both are set (the cron answers `paused`). `PRIVACY_URL` = `https://doddl.com/policies/privacy-policy` (TO CONFIRM). "Why you got this" reads "We found <business> on its website".
- **Hard rules in code:** UK only `company | limited_company | ltd | plc | llp` (`partnership`, `sole_trader`, `childminder`, `charity`, `unknown` get no e-mail); Germany none; Ireland no sole traders or childminders; France no extra gate. "Domain owned by an existing customer/partner" = partner suppressions by domain only (PM has no customer list).
- **Tokens:** the stored `body_html` holds a placeholder, not the token; each send makes a fresh token and stores only its sha256, so the database never holds a working link.
- **Opt-out page:** a GET never opts out (link scanners follow links); the one-click POST does. Replying "stop" also opts out.
- **Health:** the >5 % rate rules need at least 20 sends; 3 hard bounces in a day pauses at any volume.
- **Replies:** `positive` → prospect `warm`; `negative` and `optout` are `auto` and suppressed (the address only); others `replied`. Due the next working day 17:00 UK. Summaries have e-mails and phone numbers redacted.
- **Soft bounce:** one retry of the same e-mail 24 h later; a second soft bounce counts as hard. A failed Graph send is retried once (5 minutes later), then `failed`.
- **Disconnect:** queued first e-mails move to the campaign's other mailboxes; follow-ups for businesses first mailed from that mailbox stop (a new sender mid-thread breaks threading). Reconnecting the same address resumes them.
- **Approve each day's batch:** once a UK day, inside a mailbox window, PM creates an outreach `pack` (max 25 lines, one per business's first e-mail); approved lines send within the pace, rejected or expired ones stop. Follow-ups carry on without a pack.
- **Inbox:** unrelated mail is skipped unread (only conversation matches, NDR-looking mail and "Re:" subjects are opened). The first sync starts from the mailbox's connect date.

**Env vars (Vercel; PM reads them and names any that are missing)**
- `B2B_MAIL_CLIENT_ID`, `B2B_MAIL_CLIENT_SECRET`, `B2B_MAIL_TENANT_ID` (falls back to `NEXT_PUBLIC_AZURE_TENANT_ID`), `B2B_MAIL_TOKEN_KEY` (32 bytes, base64 or hex), `B2B_PUBLIC_BASE_URL` (the PM host; the Entra app needs the redirect URI `<it>/api/b2b/mailboxes/callback`). Set on production and preview, admin consent granted (2026-11-10).
- `KLAVIYO_API_KEY`, `B2B_KLAVIYO_LIST_ID` (from the setup script): not set yet; "Make partner lead" answers 503 naming them until they are.
- Existing: `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`.

**Left to do**
- Apply migration 27 (staging, then production) before this branch merges.
- Confirm the registered office and company number (and the privacy URL) in `lib/b2bMail/rules.js`; nothing sends until then.
- Run `scripts/b2b-klaviyo-setup.mjs` (dry run, then `--apply`), set `B2B_KLAVIYO_LIST_ID`, and apply the printed segment and flow filters in Klaviyo.
- The Monday 08:00 approvals summary does not carry a B2B line per live campaign yet.
- Not exercised against live Microsoft Graph or Klaviyo; the first real connect and a test send to an internal address are the acceptance step.
