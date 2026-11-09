# B2B campaigns: the contract between doddl PM and doddl HQ

Jon signed off the B2B campaign designs on 2026-11-09 ("Looks right", then "Build this"). The boards are in `docs/b2b-campaigns/design/*.dc.html` and on canvas section 14 (https://claude.ai/artifact/6bRNxMdoidfY7GjqGi6LMr). Treat everything in them as SAMPLE data:
- `B2BCampaigns`: the list
- `B2BCreate`: the five-step create wizard, starting with the business type
- `B2BDefine`: the definition card
- `B2BSample`: the sample to approve
- `B2BFlow`: emails, flow and hand-offs

This builds on Approvals v2 (`docs/approvals-v2/CONTRACT.md`). Its approvals, clock, rules and renderers are reused, not copied. If a name here changes, change it in this file in the same commit. HQ keeps an identical copy at `docs/b2b-campaigns-contract.md`.

## The flow

1. **Create.** A person creates a campaign in PM (the wizard).
   - **Step 1 Business type:** pick one of 9 seeded examples, or a saved type, or describe it in your own words.
   - **Step 2 Goal and offer.**
   - **Step 3 Market and how many.**
   - **Step 4 Channels and rules.**
   - **Step 5 Check and send.**

   "Send for approval" creates a `b2b_definition` approval in the area `outreach`, so its approver comes from Who approves what. The campaign stage becomes `define_review`.
2. **Sample.** Once the definition is approved (stage `sampling`), HQ finds a sample of `sample_size` companies and posts them. PM creates a `b2b_sample` approval: one line per prospect, tick or reject, with a reason for each rejection. Stage `sample_review`.
3. **Learn and find the rest.** On that decision HQ turns the reject reasons into learned rules on the business type (Jon sees them on the card, and they are saved with the type). It then finds the rest, up to `volume` (stage `finding`), and drafts the emails and flow. PM creates a `b2b_sequence` approval. Stage `words_review`.
4. **Go live.** After the words are approved, HQ posts a `b2b_golive` approval: the full list, the first day's batch, send times and contacts still missing. Stage `golive_review`. Once approved, stage `live`.
   - Each later day's batch arrives as an Approvals v2 `pack` (`pack_kind: outreach`, max 25 lines, one per contact) under the existing outreach rail rules.
5. **Replies.** A reply stops the sequence for that company. HQ classifies it, drafts an answer where allowed and posts it to `b2b_replies`. The named person (`people.replies` / `people.calls` on the campaign) answers within its `due_at`.
   - Sending a reply is a person's action, always.
   - Opt-outs and bounces are handled by HQ with no person.

## Hard rules (already enforced in HQ's outreach rail; PM must not undo them)

- **Contacts.** Agents never see or write a person's name, e-mail or phone. PM shows a contact ROLE ("Manager"), the contact type (`named` / `generic` / `none`) and whether a contact exists in HubSpot. It never shows contact details that came from HQ.
- **Adding contacts.** People add contacts in HubSpot. A campaign with prospects that have no contact shows "contacts to add" as a task for the campaign owner, not as an error.
- **Sending.** Sending goes through HubSpot sequences from a separate outreach address. Klaviyo is never used for cold outreach: its rules allow only people who signed up.
- **Country rules.** These are code, not prompt (HQ `config/outreach.yaml` country_rules). PM shows them as text:
  - UK: companies and partnerships only (sole traders and childminders need consent).
  - Germany: first contact is LinkedIn, phone or post, never cold e-mail.
  - US: postal address and opt-out.
  - France and Ireland: as in the design.
- **Touches.** At most 3 per contact across all agents; no new enrolment within 30 days. One do-not-contact list covers every campaign.
- **Offers.** Copy may mention only the offers the approved definition lists (free sample set, trade price…). Prices come from the pricing sheet, and anything about price, discount, exclusivity or terms is flagged CHALLENGED on the card.
- **Research sources.** HQ researches only through its web-research tools: company sites, public registers, trade-show lists and Google Maps listings. LinkedIn is never scraped; a LinkedIn message is drafted for a person to send from their own profile.

## Database (migration `26-b2b-campaigns.sql`)

### b2b_business_types
- `id` uuid, `slug` unique, `name`, `description`, `line`.
- `kinds` jsonb `[{t, on}]`, `size`, `who_decides`.
- `must` text[], `nice` text[], `rule_out` text[].
- `sources`, `wants`, `contact_rules`.
- `learned_rules` jsonb `[{rule, from_reason, count, campaign_id, at}]`.
- `is_template` bool, `created_by`, `created_at`, `updated_at`.
- Seed the 9 examples from `B2BCreate`, with `is_template = true`: nurseries, distributors, independent shops, pharmacies, department stores, SEN, gifting, family hospitality, and "Something else", which carries an empty definition.

### b2b_campaigns
- `id` uuid, `name`.
- `business_type_id` (fk), `definition` jsonb (a snapshot of the type with the person's edits).
- `goal` jsonb `{id, target, by}`, with id one of: `trial`, `stock`, `calls`, `deal`, `refer`, `bulk`.
- `offers` text[], from: `sample`, `trade`, `starter`, `code`, `call`.
- `market` jsonb `{country, regions[], language}`.
- `volume` int, `sample_size` int, `pace` text.
- `channels` text[], from: `email`, `linkedin`, `phone`, `post`.
- `people` jsonb `{replies, calls}`, `approver`.
- `stage`, one of: `draft`, `define_review`, `sampling`, `sample_review`, `finding`, `words_review`, `golive_review`, `live`, `paused`, `done`, `cancelled`. Plus `stage_since`.
- `definition_task_id`, `sample_task_id`, `words_task_id`, `golive_task_id` (fks to tasks).
- `metrics` jsonb `{found, approved, contacts_missing, emailed, opened, replied, meetings, orders}`.
- `owner`, `created_by`, `created_at`, `updated_at`, `archived_at`.

### b2b_prospects
- `id` uuid, `campaign_id`, `hq_ref` (unique per campaign; HubSpot company id or HQ id), `name`, `place`.
- `details` jsonb (places, rating, size signal, website).
- `sources` jsonb `[{label, url}]`, `match` jsonb `[{t, ok}]`, `fit` int (0–100).
- `contact` jsonb `{role, type: named|generic|none, in_hubspot: bool}`. NO names, e-mails or phones.
- `status`, one of: `sample`, `approved`, `rejected`, `found`, `queued`, `contacted`, `replied`, `opted_out`, `bounced`, `excluded`.
- `reject_reason`, `excluded_reason`, `created_at`, `updated_at`.

### b2b_replies
- `id`, `campaign_id`, `prospect_id`.
- `kind`, one of: `positive`, `question`, `owner`, `ooo`, `negative`, `optout`, `bounce`.
- `summary` (no contact details), `draft`, `assigned_to`, `due_at`.
- `status`, one of: `needs_person`, `sent`, `closed`, `auto`.
- `hubspot_ref`, `created_at`, `closed_at`.

### Visibility
RLS and visibility are like the Approvals v2 tables: read through `/api/db` (GET), writes only through the API. Agents need new scopes: `b2b:read` and `b2b:write`, granted to the doddl-hq key.

## Artefact types (add to lib/artefactTypes.js; the card frame and decide endpoint are reused)

- **`b2b_definition`**
  - `campaign_id`, `name`, `definition` (as on `b2b_campaigns`), `goal`, `offers`, `market`, `volume`, `sample_size`, `channels`, `people`, `estimate` `{found, match, contact, after_rules}` (strings, may be `[n]`), `country_rules` text[].
  - Single decision (no lines). Approve moves the stage to `sampling`.
- **`b2b_sample`**
  - `campaign_id`.
  - `prospects[]` `{id, name, place, details, sources, match, contact, fit}`.
  - `excluded_count`, `excluded_note`.
  - Lines are the prospect ids: `approved` | `rejected`, with the reason in `line_decisions["<id>:reason"]`. Reasons: `too_small`, `chain_head_office`, `wrong_type`, `no_meals`, `other` (plus free text in `<id>:note`). A rejection needs a reason.
- **`b2b_sequence`**
  - `campaign_id`.
  - `emails[]` `{id, when, subject, body, step}`; `body` may contain `[token]` placeholders.
  - `flow[]` `{id, when, title, sub, then, person: bool}`.
  - `branches[]` `{say, what, who, fast}`.
  - `sending` `{via, pace, days, stops_when}`.
  - `checks[]`.
  - Lines are the email ids (approve / edit per email, edits in `"<id>:edit"` = `{subject?, body?}`).
- **`b2b_golive`**
  - `campaign_id`, `total`, `contacts_missing`.
  - `first_batch[]` `{id, name, place, contact_role}`.
  - `send_times`, `checks[]`.
  - Single decision.

## API

**People** (MSAL, like Approvals v2):
- `GET /api/b2b/campaigns` returns the list, with stage, metrics and what is waiting.
- `GET /api/b2b/campaigns/[id]` returns the detail: definition, prospects (paged), replies and linked approvals.
- `POST /api/b2b/campaigns` creates a draft.
- `PATCH /api/b2b/campaigns/[id]` edits a draft, pauses, resumes or cancels.
- `POST /api/b2b/campaigns/[id]/submit` creates the `b2b_definition` approval and sets the stage to `define_review`.
- `GET /api/b2b/business-types`.
- `POST /api/b2b/business-types` saves a type ("Save as a business type").
- `GET /api/b2b/replies?mine=1`.
- `PATCH /api/b2b/replies/[id]` with `{status, draft}`. The person marks it sent after sending it from HubSpot or the outreach inbox.

**Decisions:** the existing `POST /api/approvals/decide` is used. Deciding a b2b approval moves the campaign stage:
- definition approved: `sampling`
- sample decided: `finding`, with prospect statuses set from the lines
- sequence approved: unchanged; HQ posts go-live next
- go-live approved: `live`
- any send back or reject: the stage stays at its review step until HQ resubmits; reject on the definition means `cancelled`

**Agent** (doddl-hq key, scope `b2b:*`):
- `GET /api/agent/b2b/work` returns the campaigns whose stage needs HQ (`sampling`, `finding`, after words approval, `live`), with their approved definition and learned rules.
- `POST /api/agent/b2b/campaigns/[id]/sample` with `{prospects[], excluded_count, excluded_note}` stores the prospects and creates the `b2b_sample` approval.
- `POST /api/agent/b2b/campaigns/[id]/prospects` bulk-upserts prospects on `hq_ref`.
- `POST /api/agent/b2b/campaigns/[id]/sequence` creates the `b2b_sequence` approval.
- `POST /api/agent/b2b/campaigns/[id]/golive` creates the `b2b_golive` approval.
- `PATCH /api/agent/b2b/campaigns/[id]` updates `metrics` and some stages (`finding` → `words_review` happens through the sequence post).
- `POST /api/agent/b2b/replies` adds replies.
- `PATCH /api/agent/b2b/business-types/[id]` appends `learned_rules`.

The MCP tools mirror these.

## Screens

| Screen | What it contains |
|---|---|
| Sidebar | "B2B campaigns" under doddl HQ (desktop and phone menu) |
| Campaigns list | Board `B2BCampaigns`: tiles, campaign rows with the 7-step track and figures, templates linking into Create with that type chosen |
| Create wizard | Board `B2BCreate`: 5 steps, as drawn, saving drafts as you go; the market's country rules shown from a fixed table in PM that matches HQ's |
| Campaign detail | Approvals linked per stage, prospects table, "contacts to add", replies waiting with who and by when, pause/resume |
| Renderers | `b2b_definition` (board `B2BDefine`, with the step labels as fixed); `b2b_sample` (board `B2BSample`: reasons only on unticked rows; "What HQ learns" preview); `b2b_sequence` (board `B2BFlow`: 5-column flow, email preview, reply branches); `b2b_golive` |
| Phone | Every screen gets a phone layout via `useIsMobile`, in the style of the other v2 phone screens |

## As built: doddl PM (branch b2b-campaigns, 2026-11-09)

Additions and the shapes the sections above leave open. Nothing above was renamed. HQ: copy this section into `docs/b2b-campaigns-contract.md`.

**Database (migration 26, applied to staging only)**
- `market.country` is a code: `GB`, `FR`, `DE`, `IE`, `US`. The fixed country-rules table is `COUNTRIES` in `lib/b2b.js` (language, starting regions, who is left out, rules).
- Extra columns: `b2b_business_types.defaults` jsonb `{goal, offers, country, sample_size}` (what the wizard preselects for that type) and `position`; `b2b_campaigns.paused_from` (the stage Resume goes back to) and `estimate` jsonb `{found, match, contact, after_rules}` (set by HQ); `b2b_prospects.reject_note` (the free text for reason `other`); `b2b_replies.closed_by`.
- `b2b_prospects.contact` has a CHECK that refuses any key but `role`, `type`, `in_hubspot`. `b2b_replies` is unique on (`campaign_id`, `hubspot_ref`), so re-sending a reply is a no-op.
- Every B2B approval task lives in one seeded project, "B2B campaigns" (`10000000-0000-0000-0000-000000000b2b`). Area `outreach`; the campaign's `approver` (if set) is the approver, otherwise the area's.
- Notification types added: `b2b_reply` (a reply needs you), `b2b_contacts` (contacts to add).
- The template "Distributors" lists no LinkedIn source: LinkedIn is never scraped (hard rule), so it was left out of the seed.
- Reads go through `/api/db` (GET only) for the four tables; there is no per-person visibility on them (everyone at doddl sees every campaign).

**Lines and decisions**
- `b2b_sample` line ids are the prospects' `hq_ref`s (the artefact's `prospects[].id` = `hq_ref`).
- `/api/approvals/decide` accepts the line sub-keys `"<id>:reason"` and `"<id>:note"` (B2B sample only; refused elsewhere). With an approve, every `rejected` line needs a reason, `other` needs a note, and a reason may sit only on a rejected line. Send back and reject skip the reason rule.
- After a sample decision, prospects are set `approved` / `rejected` (+ `reject_reason`, `reject_note`) from the lines, and `metrics.approved` is the count. A sample rejected outright (every line unticked) sets the statuses too, but the stage stays at `sample_review` until HQ resubmits.
- Only the campaign's current card of that kind moves it, and only from its review stage (a late decision never moves a paused or cancelled campaign).
- A definition that is sent back or expires can be changed by a person and sent again (`POST .../submit`); the stage stays `define_review` meanwhile.
- `b2b_sequence`: `flow[]` items may also carry `body` (what the person does at that step); `sending` may carry `from`. Lines start ticked; an edit sets the line to `edited` with `"<id>:edit"` = `{subject?, body?}`.

**People API (as built)**
- `GET /api/b2b/campaigns` → `{ tiles: {waiting_for_you, waiting_note, replies_for_person, meetings, live, setup}, campaigns[] (each with track[7] {label, state: done|now|wait|todo, note, due_at}, next {text, tone}, nums[], waiting, replies_waiting), templates[] }`.
- `GET /api/b2b/campaigns/:id?page=&page_size=&status=` → `{ campaign, business_type, track, next, nums, approvals[], linked {definition, sample, words, golive}, prospects {rows, total, page, page_size, counts}, contacts_to_add {count, owner, rows}, replies[], country_rules[] }`.
- `PATCH /api/b2b/campaigns/:id` edits the draft (only while editable) or takes `{ action: pause | resume | cancel }` on its own.
- `GET /api/b2b/business-types` → `{ types[] (with campaigns, live, learned_count), people[] }`.
- `GET /api/b2b/replies?mine=1&status=needs_person|sent|closed|auto|all`; `PATCH /api/b2b/replies/:id` `{status: sent|closed|needs_person, draft}`.

**Agent API and MCP (as built)**
- `GET /api/agent/b2b/work` (b2b:read) → `{ campaigns: [{ id, name, stage, needs, decision_notes, definition, goal, offers, market, volume, sample_size, pace, channels, people, metrics, country_rules, business_type {id, slug, name, learned_rules}, words_edits, sample_approved[], sample_rejected[{hq_ref, reason, note}] }] }`. `needs` is one of `sample`, `resubmit_sample`, `find_and_words`, `resubmit_words`, `golive`, `resubmit_golive`, `run`.
- Posting is allowed from these stages only: sample from `sampling` (or `sample_review` once the last sample card was sent back / rejected / expired); sequence from `finding` (or `words_review` likewise); go-live from `words_review` once the words are approved (or `golive_review` likewise). A second post while a card is waiting is a 409.
- The posts return `{ campaign_id, stage, task }` (201). The sample post also returns `prospects {upserted, created, updated}`.
- The go-live post sets `metrics.contacts_missing` (and `metrics.found` = `total`) and, when contacts are missing, creates one PM task for the campaign owner in the B2B project (`external_ref` `b2b:<campaign_id>:contacts`) and notifies them.
- `PATCH /api/agent/b2b/campaigns/:id` takes `metrics` (whole numbers for the 8 keys, merged), `estimate`, and `stage: 'done'` from `live` only.
- `POST /api/agent/b2b/replies`: `positive`, `question` and `owner` need a person (`people.calls` for `owner`, else `people.replies`); due in 1 working day, `owner` the same day (next day after 15:00 UK). `ooo`, `negative`, `optout` and `bounce` are `auto` (HQ, no person), as in board B2BFlow. The prospect becomes `replied`, `opted_out` or `bounced`. Summaries with an e-mail address or phone number are refused; drafts may contain only doddl.com addresses.
- MCP tools: `b2b_work` (b2b:read); `b2b_post_sample`, `b2b_upsert_prospects`, `b2b_post_sequence`, `b2b_post_golive`, `b2b_update_campaign`, `b2b_add_replies`, `b2b_add_learned_rules` (b2b:write).

**Screens (as built)**
- The wizard does not have the board's "Sample budget", "Emails", "Sent as" or "Days and times" inputs: the contract has no field for them, and HQ proposes the emails, sender and send times on the `b2b_sequence` card. HQ's estimate shows once HQ sets `estimate`.
- The approval card's main button takes its label from the renderer: "Approve and find a sample", "Approve n, find the rest", "Approve emails and flow" / "Approve with my edits", "Go live".


## Area targeting (added 2026-11-09, Jon: "for nursery I just want to target UK only")

- `market` is `{country, regions[], places[], language}`. **Empty `regions` and `places` = the whole country.** Otherwise both are HARD filters: a company outside every chosen region or place is never in the sample, the full list or a batch. HQ leaves out a candidate whose location it cannot resolve and counts it in `excluded_note` as "location unclear".
- `regions` must come from the fixed list for the country in PM `lib/b2b.js` `COUNTRIES` (GB: 12 nations and English regions; FR: 13 regions; DE: 16 states; IE: 4 provinces; US: 50 states and DC). PM refuses any other value.
- `places` is free text (max 20): towns, cities or UK postcode areas such as "Leeds" or "BS".
- The wizard asks "The whole of the UK" (default) or "Only some regions or places". Cards, the list and the detail say "UK: the whole country" or "UK: only North West, Leeds".
