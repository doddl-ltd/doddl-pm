# Approvals v2: the contract between doddl PM and doddl HQ

Jon signed off the designs on 2026-11-06 ("This is brilliant, build all of it"). The design boards are in `docs/approvals-v2/design/*.dc.html`: a desktop and a phone version of each screen. The live canvas is https://claude.ai/artifact/6bRNxMdoidfY7GjqGi6LMr. Open the `.dc.html` files as text: the markup shows the layout and the `renderVals()` blocks show the data each screen needs. Names, numbers and copy in them are SAMPLE data, never fixtures to ship.

This file is the single source of truth for names. doddl PM (this repo) implements it, and doddl HQ (doddl-ltd/doddl-hq, branch feat/approvals-v2) codes against it. If you have to change a name, change it here in the same commit.

## Screens (board numbers from the canvas)

| # | Screen | Desktop board | Phone board |
|---|---|---|---|
| 1 | Approvals inbox: Waiting for me (grouped by area, escalated first), Waiting on others, Decided; overdue / due today / escalated tiles; the 24h-48h-72h clock | Main | InboxPhone |
| 2 | Approval card: live preview, what changes (before/after), why (with evidence source), expected effect and undo, checks; approve / with edits / send back / reject (reject reasons) | Card | CardPhone |
| 3 | Pack (batch) card: groups of lines, tick per line, running totals, "Approve n" | Batch | BatchPhone |
| 4 | Who approves what: per-area approver, backup at 48h, second approver, spend threshold, batch mode; edit panel; append-only change log | Approvers | ApproversPhone |
| 5 | Give HQ an idea: 6 questions, only the first required | Idea | IdeaPhone |
| 6 | Content calendar | Calendar | CalendarPhone |
| 7 | Teams card and the 08:00 summary | Teams | TeamsPhone |
| 8 | Creative studio: pipeline board brief → make → check → ready → scheduled → live, type filter, stuck list, "where each type is approved" table | Studio | StudioPhone |
| 9 | Ad review: placements (IG feed 4:5, Stories/Reels 9:16, FB feed 1:1, Marketplace, TikTok, Amazon Sponsored Brands), safe zones, variants, per-variant decision | AdReview | AdReviewPhone |
| 10 | Video review: player in 9:16/4:5/1:1, frames, beats, timeline comments, script vs cut, deliverables, checks | VideoReview | VideoReviewPhone |
| 11 | Social week pack: channel × day grid, phone preview, edit caption/tags/alt text, tick per post, balance across pillars | SocialReview | SocialReviewPhone |
| 12 | Email review: inbox preview, subject A/B, desktop/mobile/dark, audience, checks, every link, where it sits in the sequence, send test | EmailReview | EmailReviewPhone |
| 13 | Amazon listings: live vs should be live, matrix of listing × field; one listing field by field with an action per differing field | Listings, ListingDiff | ListingsPhone, ListingDiffPhone |

The sidebar gets, under "doddl HQ": Approvals (badge), Creative studio, Content calendar, Amazon listings and Give HQ an idea; and under Settings: Who approves what. On phones these go in the existing bottom nav and Menu drawer.

## Database (migration `25-approvals-v2.sql`, applied to staging only until Jon says so)

### approval_rules
One row per area.
- Columns:
  - `area` text pk (slug)
  - `label`
  - `what`
  - `approver` (a people name, nullable = "Not set")
  - `backup`
  - `second_approver` (nullable)
  - `spend_threshold_weekly` numeric (nullable)
  - `threshold_currency` text default 'GBP'
  - `threshold_also_needs` (nullable)
  - `batch_mode` (`single` | `off` | `weekly` | `daily` | `monthly` | `pack`)
  - `batch_day` (nullable)
  - `reply_by` time (nullable)
  - `max_pack` int (nullable)
  - `updated_by`
  - `updated_at`
  - `last_read_by` (agent id)
  - `last_read_at`
- Seed these areas. Their values are in the Approvers board and are Jon's agreed set-up: `amazon_ads`, `amazon_listings`, `paid_media`, `email`, `organic_social`, `comments_dms`, `website`, `content_calendar`, `outreach`, `app_recipes` (approver null, second Jon).

### approval_rules_log
Append-only: a trigger blocks update and delete.
- Columns: `id`, `area`, `changed_by`, `change` text, `reason` text, `before` jsonb, `after` jsonb, `at`.
- Only Jon (people.name = 'Jon', or a role flag) may change rules. Enforce it in the API.

### tasks: new nullable columns
- `approval_area` (fk approval_rules.area)
- `expires_at`
- `reminded_at`
- `escalated_to`
- `escalated_at`
- `decision_edits` jsonb (the approver's edits, keyed as the artefact is)
- `line_decisions` jsonb (`{ "<line_id>": "approved" | "rejected" | "edited" | "push" | "keep" }` plus optional `"<line_id>:edit"` values)
- `reject_reason` (`timing` | `off_brand` | `evidence` | `other`)

The decision lock trigger must cover `decision_edits`, `line_decisions` and `reject_reason` too.

**Decision values** (extend the CHECK constraint):
- `approved`
- `approved_with_edits`
- `partially_approved` (a pack where some lines were approved)
- `revision_requested`
- `rejected`
- `expired` (by `system`, at 72h)

### approval_votes
For two-approver areas.
- Columns: `task_id`, `voter`, `vote` (same values as decision, minus `expired`), `notes`, `edits` jsonb, `lines` jsonb, `at`. Unique on (`task_id`, `voter`).
- The task's `decision` is written only when every required voter has voted. Any reject or send-back decides at once.

### approval_comments
- Columns: `id`, `task_id`, `author`, `body`, `anchor` jsonb, `resolved` bool, `created_at`.
- `anchor` takes one of these shapes:
  - `{kind:'time', t:'0:03'}`
  - `{kind:'point', placement, x, y}` (0–1)
  - `{kind:'field', field}`
  - `{kind:'line', line_id}`
- Agents can read comments, and add them as `agent:<id>`.

### content_items (the studio and calendar)
- Columns:
  - `id` uuid
  - `external_ref` text unique (agents upsert on it)
  - `type` (`ad` | `video` | `social` | `email` | `listing` | `amazon_ads` | `website` | `outreach` | `recipe`)
  - `title`
  - `markets` text[]
  - `channel`
  - `stage` (`brief` | `make` | `check` | `ready` | `scheduled` | `live` | `done` | `dropped`)
  - `owner` (agent id or person)
  - `approver`
  - `approval_task_id` (fk tasks)
  - `status_text`
  - `status_tone` (`ok` | `warn` | `bad` | `info` | `muted`)
  - `format`
  - `thumb_url`
  - `stage_since`
  - `stage_sla_hours`
  - `scheduled_at`
  - `live_at`
  - `results` jsonb (e.g. `{day3:{…}, day7:{…}}`)
  - `brief` jsonb
  - `updated_at`
- "Stuck" means `now - stage_since > stage_sla_hours`.
- The calendar reads rows with `scheduled_at` or `live_at`.

### ideas
- Columns:
  - `id`
  - `text` (required)
  - `persona`
  - `age_stages` text[]
  - `channels` text[]
  - `markets` text[]
  - `timing`
  - `offer`
  - `must_include`
  - `must_avoid`
  - `measure`
  - `created_by`
  - `status` (`new` | `picked_up` | `briefed` | `declined`)
  - `hq_reply`
  - `brief_ref`
  - `created_at`

### Amazon listings
- **listing_products:** `asin`, `marketplace`, `sku`, `product`, `colour`, `parent_asin`, `listing_status`, `buy_box`, `should_source` text, `checked_at`. PK (`asin`, `marketplace`).
- **listing_fields:** `asin`, `marketplace`, `field`, `position` int, `limit_text`, `should` jsonb, `should_meta`, `live` jsonb, `live_meta`, `status` (`match` | `drift` | `proposed` | `in_flight` | `problem` | `na`), `note`, `checked_at`. PK (`asin`, `marketplace`, `field`).
  - The fields are: Title, Bullet 1–5, Description, Search terms, Images, A+ content, Price, Variations, Category, Age range, Safety documents, Buy Box.
  - For Images, `live` and `should` are arrays of `{slot, label, url, px}`.
- **listing_events:** `id`, `asin`, `marketplace`, `at`, `text`, `kind` (`amazon_change` | `our_change` | `check` | `suppressed`).

**RLS.** Everything goes through the `/api/db` proxy and its visibility rules, like the existing tables. No anon access. Agents write through `/api/agent/*` only.

## Artefact types (lib/artefactTypes.js)

The existing types stay. Five new types have per-field validation. Media URLs are optional everywhere: when a URL is missing, the UI shows the labelled placeholder from the designs. Every type may carry these keys:
- `checks: [{result:'pass'|'check'|'fix', text}]`
- `why` (text)
- `evidence: [{text, source}]`
- `expected_effect`
- `undo`
- `after_yes: [text]`

- **`ad_creative`**
  - Top level: `platform` (`meta` | `tiktok` | `amazon_sb`), `campaign`, `ad_set`, `audience`, `placements`, `budget_text`, `dates_text`, `landing_url`, `utm`.
  - `variants[]` (required, at least 1), each with:
    - `id`, `name`, `primary_text`, `headline`, `description`, `cta`, `overlay`
    - `image: {label, url, path, rights}`
    - `video_task_id`
    - `checks[]`, `why`
  - `running_now[]` of `{name, spend, ctr, cpa, note}`.
  - Line ids are the variant ids.
- **`video`**
  - Top level: `title`, `duration_s`, `version`, `previous_versions[]` of `{version, outcome, note}`, `runs_on[]`, `used_by[]`.
  - `files: {'9:16':url,'4:5':url,'1:1':url}`.
  - `frames[]` of `{t, beat, shot, text, voice, thumb_url}`.
  - `beats[]` of `{label, start_s, end_s}`.
  - `script[]` of `{t, beat, brief, on_screen, words, source}`.
  - `deliverables[]` of `{label, status:'ready'|'missing', note}`.
  - `checks[]`.
  - Outcomes: approved (paid and organic), `approved_with_edits` with `decision_edits.scope = 'organic'` for "organic only", `revision_requested`, `rejected`.
- **`social_pack`**
  - Top level: `week_start` (YYYY-MM-DD).
  - `posts[]` (required), each with:
    - `id`, `channel`, `day` (YYYY-MM-DD), `time`, `title`, `pillar`, `format`, `age_stage`
    - `image: {label, url, source}`
    - `caption`, `hashtags`, `alt_text`, `first_comment`, `product_tag`
    - `checks[]`
  - Line ids are the post ids. Edits are stored as `line_decisions["<id>:edit"] = {caption?, hashtags?, alt_text?, first_comment?, time?}`.
  - `pillars_note`.
- **`email`**
  - Top level: `kind` (`campaign` | `flow`), `klaviyo_id`, `send_at`, `from`, `preview_text`, `html_url` or `html`, `smart_sending`.
  - `subjects[]` of `{id, text, split}`.
  - `audience: {segment, size, excluded}`.
  - `links[]` of `{where, url, utm, ok}`.
  - `sequence[]` of `{label, when, current}`.
  - `checks[]`.
  - "Send a test" calls the HQ action `email.send_test` through an `inbox_items` request; it is a stub until HQ wires it.
- **`listing_change`**
  - Top level: `asin`, `sku`, `marketplace`, `product`.
  - `fields[]` of `{field, limit_text, live, live_meta, should, should_meta, status}`.
  - `images: {live:[], should:[]}`.
  - `keywords[]` of `{term, live, should}`.
  - `history[]` of `{at, text}`.
  - `checks[]`.
  - Line ids are the field names. Line decisions are `push` | `keep` | `edit` (the edit text goes in `"<field>:edit"`).
- **`pack`**
  - Top level: `pack_kind` (`amazon_ads` | `paid_media` | `replies` | `outreach` | `listings`), `currency_totals` (bool).
  - `groups[]` of `{name, lines[]}`, each line with:
    - `id`, `target`, `before`, `after`, `limit`, `limit_tone`, `why`
    - `weekly_delta: {currency, amount}`
    - `detail`
  - HQ's existing `deploy_plan` approvals keep working unchanged.

## API

Every UI write goes through MSAL-verified routes. The actor is the signed-in person.

**Decisions and comments**
- `POST /api/approvals/decide`, with body:
  - `task_id`
  - `outcome`
  - `notes`
  - `edits`
  - `lines`
  - `reject_reason`

  This records a vote, or the decision. It validates that the actor is the approver, the escalated backup, or the second approver. `partially_approved` is derived when `lines` has both approved and rejected entries.
- `POST /api/approvals/comment`, and `PATCH` to resolve a comment.

**Who approves what**
- `GET /api/approvals/rules` returns the rules and the log.
- `PUT /api/approvals/rules/:area` takes the changes plus a reason; Jon only. It optionally moves waiting cards to the new approver.

**Ideas, studio and listings**
- `POST /api/ideas` and `GET /api/ideas`.
- `GET /api/studio`, `GET /api/calendar?from&to`, `GET /api/listings`, `GET /api/listings/:asin/:marketplace`. These are reads; the proxy-based reads are fine too.

**Agent API** (agent keys, new scopes):

| Endpoint | Scope | What it does |
|---|---|---|
| `POST /api/agent/artefacts` | approvals:write (existing) | Accepts the new types and the optional `approval_area` and `expires_at`. The approver defaults from `approval_rules`. |
| `GET /api/agent/decisions/:task_id` | tasks:read | Adds `decision_edits`, `line_decisions`, `reject_reason` and `votes`. |
| `GET /api/agent/approval-rules` | tasks:read | Stamps `last_read_by` and `last_read_at`. |
| `PUT /api/agent/content-items` | content:write | Bulk upsert on `external_ref`. Moving `stage` resets `stage_since`. |
| `POST /api/agent/listings/snapshot` | listings:write | `{products[], fields[], events[]}` bulk upsert. |
| `GET /api/agent/ideas?status=new` | ideas:read | Lists new ideas. |
| `PATCH /api/agent/ideas/:id` | ideas:write | Sets `status`, `hq_reply` and `brief_ref`. |
| `GET /api/agent/comments/:task_id` and `POST` | tasks:read (GET), approvals:write (POST) | Reads and adds approval comments. |

MCP tools mirror these: `get_approval_rules`, `upsert_content_items`, `post_listing_snapshot`, `list_ideas`, `reply_idea`, `add_approval_comment`, plus `list_approval_comments`. `submit_for_approval` takes `approval_area`, `expires_at` and `weekly_spend`; `get_decision` returns the same body as the decisions endpoint.

## The clock (cron `/api/cron/approval-clock`, hourly)

The clock starts at `created_at`; `expires_at` defaults to created + 72h.
- **At 24h without a decision:** remind the approver by in-app notification and the Teams card. Set `reminded_at`.
- **At 48h:** escalate to the area's backup. Set `escalated_to` and `escalated_at`, give the backup visibility, and notify them. The original approver can still answer.
- **At 72h:** set `decision='expired'`, `decision_by='system'`. HQ re-checks before asking again.

A daily pack with `reply_by` expires at its reply-by time instead.

## Teams (board 7)

- An approval card is posted to Teams for each new approval.
- The 08:00 UK summary goes to each approver: waiting, due today, overdue, escalated.
- Delivery is through an incoming webhook URL in the env `TEAMS_APPROVALS_WEBHOOK_URL`. Jon loads it himself; never ask for it in chat.
- With no URL set, it is a no-op that logs "teams: not configured".
- The cards link to the approval in doddl PM. Approving inside Teams is NOT in v2.

## Rules for builders

- doddl PM: work on branch `approvals-v2` (worktree `Documents/doddl-pm-approvals`). Never push to main. Push the branch, then merge into `staging` when green. Migrations are applied to the STAGING Supabase only.
- No secrets in chat, logs or URLs.
- Keep the existing approvals (deploy_plan, pr_link and the others) working.
- Use the house look: Nunito, indigo `#3D157D`, ink `#190e3e`, and the existing components and inline-style conventions. Below 768px, use the phone layout via `useIsMobile`.
- Accessibility as in the designs: real buttons and labels, 44px touch targets.
- doddl HQ: build-ahead rules (PR #36). New producers and the listing watcher get fixture adapters and default-off flags, with acceptance items marked `PENDING:`. Live writes stay off.

## As built: backend (branch approvals-v2, 2026-11-06)

Additions to the names above. Nothing above was renamed.

**Database (migration 25, applied to staging)**
- `people.approval_admin` (bool, Jon = true) is the role flag for changing rules.
- `approval_rules` also has `spend_applies` (the area moves money, so it can have a spend threshold), `batchable` (false = always single), `note` (why it is always single) and `position` (display order). The seed: Amazon ads weekly pack and Paid media weekly pack (spend applies, threshold not set); Amazon listings and Website always single; Email off; Organic social weekly on `wed`; Comments and DMs daily, `reply_by` 17:00; Content calendar monthly; Outreach pack, `max_pack` 25; App recipes approver null, backup Laura, second Jon. The log starts with one set-up row.
- `tasks.approvers` text[]: everyone who must approve, snapshotted at submit: [approver, second_approver, threshold_also_needs (only when the pack's weekly spend is over the threshold)]. The escalated backup can answer for the first. Null = a pre-v2 approval: anyone signed in may decide, as before.
- `approval_votes` also has `id`, `role` (`approver` | `second` | `backup` | `any`) and `reject_reason`. Votes are immutable.
- `approval_comments` also has `resolved_by`, `resolved_at`. `content_items` also has `created_at`. `ideas` also has `replied_by`, `replied_at`, `updated_at`. `listing_events` is unique on (asin, marketplace, at, text), so re-sending an event is a no-op.
- Visibility: the approvers and the escalated backup always see the approval (even in a private project); votes and comments follow their task. The new tables are readable through `/api/db` (GET only); `/api/db` refuses writes to the v2 task columns, the new decision values, and any decision on a task with an approvers list.
- Notification types added: `approval_request`, `approval_reminder`, `approval_escalated`, `approval_comment`, `approval_moved`, `idea_reply`.
- The doddl-hq key gets `content:write`, `listings:write`, `ideas:read`, `ideas:write` (where the key exists; it is not on staging yet).

**Decisions**
- Line values accepted: `approved`, `rejected`, `edited`, `push`, `keep`, `edit`. `approved`/`edited`/`edit`/`push` count as yes, `rejected`/`keep` as no.
- `partially_approved` when lines have both; an "approve" where every line is no becomes `rejected`; an `approved` vote carrying edits becomes `approved_with_edits`.
- `rejected` needs a `reject_reason` (or notes, then the reason is `other`); `revision_requested` needs notes.
- Two approvers: the decision waits for every approver; any send-back or rejection decides at once. Line decisions merge: a line goes ahead only if nobody said no. `decision_by` lists the voters ("Laura, Jon").
- Approved, approved_with_edits and partially_approved set the task to done (as the old panel did).

**Extra UI routes** (MSAL ID token, like /api/db)
- `GET /api/approvals`: the signed-in person's inbox `{ tiles: {waiting, overdue, due_today, escalated}, badge, mine[], others[], decided[], rules[] }`. Rows carry `due_at` (created + 24h, or the expiry if sooner), `overdue`, `waiting_on`, `votes`, `escalated_to_me`.
- `GET /api/approvals?task_id=`: one approval with `votes`, `waiting_on`, `comments`, `rule`, `due_at`.
- `GET /api/approvals/comment?task_id=`: its comments.
- Deep link for Teams cards: `/?view=approvals&task=<id>` (the UI should open it). Base URL from `PUBLIC_BASE_URL`, default https://doddl-pm.vercel.app.

**Clock and Teams**
- The clock runs at minute 7 of every hour on approvals that have `expires_at`, which every submission now gets. Approvals submitted before v2 have none and never expire.
- The 08:00 summary is `/api/cron/approval-summary`, scheduled at 07:00 and 08:00 UTC; only the run at 08:00 UK time posts (BST-proof). One card per approver to the same webhook.

