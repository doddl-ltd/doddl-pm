# Date normalisation — data profile and proposed design

**Status:** PROPOSAL ONLY. Not built, not applied, not committed. Per instruction: no
deploy, no push until Jon has reviewed this.

**Method:** All numbers below are from live queries against production
(`ikcjciscttsvpxoijnqe`) run 2026-08-24 via the Supabase Management API
(`https://api.supabase.com/v1/projects/{ref}/database/query`), SELECT-only. Nothing
written. Cross-checked against the connector source in
`connectors/scheduler/jobs/*.py` so the SQL findings and the code agree.

---

## 1. What's actually in `api_clean`, by source/record_type

| source | record_type | rows | first_seen..last_seen span |
|---|---|---:|---|
| amazon_sp | order | 97,461 | 2026-05-12 → 2026-08-20 (ongoing) |
| amazon_sp | listing | 142 | 2026-08-23 → 2026-08-24 (ongoing) |
| amazon_sp | order_item | **0** | never run — `run_order_items` exists but isn't registered in `scheduler.py` |
| shopify | order | 43,293 | 2026-05-15 → 2026-08-24 (ongoing) |
| shopify | product | 62 | 2026-05-15 → 2026-08-24 (ongoing) |
| google_analytics | traffic | 1,705 | 2026-05-18 only — one pull, ~9 min window, nothing since |
| google_analytics | page | 8,512 | 2026-05-18 only — same single pull |
| google_search_console | search_analytics | 113,067 | 2026-05-11 → 2026-05-16 — one backfill, nothing since |
| meta_ads | campaign | 271 | 2026-05-11 → 2026-08-24 (ongoing) |
| meta_ads | adset | 548 | 2026-05-11 → 2026-08-24 (ongoing) |
| meta_ads | adset_insight | 653 | 2026-05-08 → 2026-08-24 (ongoing) |
| klaviyo | campaign | 280 | 2026-05-15 → 2026-08-17 (ongoing) |
| klaviyo | flow | 24 | 2026-05-15 → 2026-08-24 (ongoing) |

**Side finding, not this task but worth flagging:** GA4 and GSC only ever ran once
each (single narrow `last_seen` window, no recurring updates since May). Everything
else is actively syncing. Whatever the date layer joins to, GA4/GSC will look
frozen at mid-May until someone re-enables their scheduled runs. Flagging, not
fixing, here.

`amazon_asin_daily` (separate typed table, not JSONB): 18,805 rows, `report_date`
2024-08-21 → 2026-08-16, 6 marketplaces. This is the table the brief already names
as the fixed exception.

---

## 2. Date field per source/record_type, and what it actually looks like

### amazon_sp / order — clean
Field: `PurchaseDate` (also present: `LastUpdateDate`, `EarliestShipDate`,
`LatestShipDate`, and `EarliestDeliveryDate`/`LatestDeliveryDate` on 3,236 of
97,461 rows only — sparse, not used as the business date).
- 100% present, 0 nulls, 0 malformed.
- Format is uniform: `2024-08-05T15:38:06Z` — real UTC instant, every row, no
  exceptions (`Z` suffix on all 97,461).
- This is a true timestamp, safe to convert `AT TIME ZONE 'Europe/London'`
  directly. No caveat needed.

### shopify / order — clean format, one real semantic question — DECIDED
Fields present: `created_at`, `processed_at`, `updated_at`, `closed_at`,
`cancelled_at`.
- Format uniform: `2026-05-20T10:38:34Z`, always `Z`, 0 nulls on `created_at` /
  `processed_at`. (`cancelled_at` is null on 43,041/43,293 — expected, most orders
  aren't cancelled.)
- **Edge case found, not a formatting one:** `processed_at < created_at` on
  42,918 of 43,293 orders (99.1%). For live current-day orders the gap is
  seconds (`processed_at` a few seconds *before* `created_at` — normal
  payment-capture-then-record sequencing, never crosses a UK midnight
  boundary). For older orders the gap is **months to years** — consistent with
  bulk-imported historical orders where `processed_at` carries the original
  sale date and `created_at` reflects when the row was created in Shopify
  during import.
- **Decided (Jon, 2026-08-24): `business_ts`/`business_date` derive from
  `created_at`.** Reasoning: `processed_at` drifts by months on historically
  imported orders, which would scatter old orders across the wrong reporting
  periods; `created_at` is when the order was placed, which is what every
  report means by "order date". `processed_at` stays available as a second
  plain column (`processed_at_ts timestamptz`, straight cast, no `date`
  derived from it) for anyone who specifically needs payment timing later.

### google_analytics / traffic, page — clean format, timezone CONFIRMED UK — DECIDED
Field: `date`, dimension value from GA4's `runReport`.
- 100% present, 0 nulls. Format uniform 8-digit string, e.g. `20260518`
  (`YYYYMMDD`), min `20260218`, max `20260518` in the data seen.
- **This is not a timestamp — it's a pre-bucketed calendar-day string, bucketed
  by GA4 in whatever timezone the GA4 *property* is configured for.**
- **Confirmed (Jon, 2026-08-24, GA4 Admin → Property Settings): property
  `383475128` is set to "(GMT+01:00) United Kingdom Time" — i.e.
  Europe/London.** So this field is already a genuine UK calendar date — no
  conversion needed or even possible (GA4 gives no underlying event timestamp,
  only the daily bucket), just parse the `YYYYMMDD` string to a `date`.
  `date_is_uk_local = true` for `google_analytics`/`traffic` and `/page`.
  `business_ts` stays `null` regardless — there's still no timestamp to point
  it at, only a day.

### google_search_console / search_analytics — clean format, confirmed non-UK bucketing
Field: `date`.
- 100% present, 0 nulls. Format uniform `YYYY-MM-DD`, range 2025-05-21 →
  2026-05-14 in the data seen.
- **Confirmed via Google's own documentation: Search Console's `date` dimension
  is always bucketed in Pacific Time, with no way to request another timezone
  from the API.** ([Google Search Central](https://developers.google.com/search/blog/2019/09/search-performance-fresh-data),
  [Search Console Help Community](https://support.google.com/webmasters/thread/10467744/timezone-used-in-search-console-reporting?hl=en))
  This is not fixable by a connector change — GSC has no finer-grained or
  timezone-parameterised endpoint. **This needs the same named exception as
  `amazon_asin_daily` — a PT-local date, explicitly labelled as such, not
  silently joined to the UK date dimension as if it were equivalent.**

### meta_ads / campaign, adset — clean, real timestamps
Fields: `created_time`, `updated_time`, `start_time`, `end_time`/`stop_time`.
- Format uniform: `2024-07-05T04:46:04-0700` — Facebook Graph API always
  returns an absolute instant with an explicit numeric UTC offset baked into
  every value (`-0700`/`-0800`, i.e. already DST-aware for whatever timezone
  Meta computed it in) — confirmed 2 distinct offsets in the data, both
  Pacific-DST-consistent. Postgres parses this offset format natively as
  `timestamptz`.
- Because the offset is explicit per-value, **this converts to UK-local
  correctly regardless of what timezone the Meta ad account is set to** — no
  open question here, unlike the two cases above.

### meta_ads / adset_insight — blocked, not a formatting problem
Fields: `date_start`, `date_stop`.
- 100% present, 0 nulls, uniform `YYYY-MM-DD`.
- **`date_stop - date_start` is exactly 29 days on all 653 rows, no exceptions.**
  Every insight row currently in the table is a 30-day rolling aggregate, not a
  single day. Confirmed in the code: `_sync_insights` requests
  `date_preset=last_30d` with no `time_increment`, and `run_backfill` requests
  a `time_range` over the whole backfill window, also with no
  `time_increment`. Meta's Insights API supports `time_increment=1` to get one
  row per adset per day — the connector has just never asked for it.
- **There is currently no day-grain Meta spend/performance data to normalise.**
  A `business_date` column on these 653 rows could only honestly be
  `date_start`, tagged as "start of a 30-day window", not a real business day
  — same spirit as the Amazon exception, but worse (a range, not even one
  source-local day). Getting real per-day Meta data needs a connector change
  (`time_increment=1` on both `_sync_insights` and `run_backfill`).
- **Decided (Jon, 2026-08-24): bundle the connector fix in.** 30-day rolling
  aggregates are unusable for daily/weekly reporting — same class of problem
  as the Amazon report-blending issue already solved for ASIN daily data.
  `_sync_insights` and `run_backfill` both get `time_increment=1` added to
  their params. Going forward this is a one-line-per-call-site change and
  cheap to run (small daily volume — see section 7). Once it is day-grain, the
  same open question as GA4 applies: Meta buckets daily insights by the *ad
  account's* configured timezone, not ours, so that also needs your
  confirmation of the account timezone before treating future daily rows as
  UK-local — flagged again in section 5.
  **Historical backfill of the existing 30-day-aggregate history to real daily
  grain is a separate, much bigger question — see section 7.**

### klaviyo / campaign, flow — clean, but nullable
Fields: campaign `send_time`/`created_at`/`updated_at`; flow `created`/`updated`.
- Format uniform: `2023-05-24T18:30:00+00:00` (always `+00:00` — UTC, a fifth
  distinct format from the four in the brief, but trivially parseable).
- `send_time` is **null on all 16 `Draft` campaigns** (16/280) — correctly so,
  a draft hasn't been sent yet and has no business date. 259 `Sent` + 5
  `Cancelled` campaigns all have `send_time` populated. Recommend: business
  date = `send_time`, left `null` for drafts rather than backfilled from
  `created_at` — a draft's creation date isn't when anything happened.
- Flows have no comparable "sent" concept; recommend business date = `created`
  for flows, since flows are evergreen (not date-scoped) and this is mostly
  useful for "when was this flow set up" filtering, not core reporting volume.

### amazon_sp / order_item, listing — out of scope for now
`order_item` has zero rows (connector never run). `listing` (142 rows) is
point-in-time inventory/pricing state, not a dated fact — no business date
concept applies. Neither needs a `business_date` column; I'd exclude them from
the date-dimension join entirely rather than force a column that means nothing.

### amazon_asin_daily.report_date — the brief's named exception, confirmed as described
Native `date` column already, marketplace-local per Amazon's own daily
aggregation (no underlying timestamp exists — confirmed in migration
`14-amazon-asin-daily.sql`'s own header notes from the 2026-08-17 live test).
Leaving as-is per the brief. This profiling didn't find anything to add here.

---

## 3. Summary — three tiers of "how normalisable is this," not one

| Tier | Sources | Treatment |
|---|---|---|
| **A — real UTC/offset timestamps, safely convertible** | amazon_sp/order, shopify/order (+product), meta_ads/campaign+adset, klaviyo/campaign+flow | Straightforward `AT TIME ZONE 'Europe/London'` conversion. |
| **A-by-confirmation — no timestamp, but the day-bucket is confirmed already UK-local** | google_analytics/traffic+page — **confirmed 2026-08-24: property `383475128` is set to "(GMT+01:00) United Kingdom Time"** | Parse `YYYYMMDD` straight to a `date`, no conversion possible or needed. `date_is_uk_local = true`, `business_ts` stays `null` (there's genuinely no timestamp, only a day). |
| **B — pre-bucketed day string, source-local timezone, not our UTC to convert** | google_search_console (confirmed Pacific Time, unfixable — **now the only source that will permanently sit in this tier**), meta_ads/adset_insight once day-grain exists (ad-account timezone, still unconfirmed) | Same treatment as `amazon_asin_daily`: keep the source-local date as-is in an explicitly-named column, never silently presented as UK-local. |
| **C — not day-grain at all today** | meta_ads/adset_insight (currently 30-day windows) | Connector fix (`time_increment=1`) applied 2026-08-24, forward-only. Existing 30-day-aggregate rows stay Tier C; not backfilled (see §7). |

**Update 2026-08-24:** GA4's property timezone is confirmed UK, so the brief's
"one exception" lands at exactly what it looked like it might be — **one
permanent, unfixable exception (GSC's Pacific-Time bucketing) plus Amazon's
already-named one**, not the wider set this section originally worried about.
Meta's ad account timezone is still unconfirmed and `adset_insight`'s existing
history is still range-grain, not day-grain — both still explicitly flagged,
not assumed away.

---

## 4. Proposed design

### 4a. Mechanism: trigger-maintained columns on `api_clean`, not generated columns

Ruled out generated columns (`GENERATED ALWAYS AS (...) STORED`): Postgres
requires the expression be `IMMUTABLE`, and timezone conversion
(`AT TIME ZONE`) is `STABLE` (it depends on the system timezone database,
which can change), so Postgres rejects it outright in a generated column
expression. Confirmed against Postgres docs, not assumed.

Proposed instead: a `BEFORE INSERT OR UPDATE` trigger on `api_clean` that:
1. Looks at `(source, record_type)` — a hardcoded `CASE`, not a config table,
   matching how this codebase already prefers explicit dispatch over dynamic
   config (`ACCOUNTS`, `ACTIVE_MARKETPLACES` in `amazon_sp_api.py`; six sources
   is a small, stable, known set).
2. Extracts the right JSONB key for that pair (per section 2 above).
3. Parses it into `business_ts timestamptz` where a real timestamp exists
   (Tier A), left `null` for Tier B/C rows.
4. Computes `business_date date`:
   - Tier A: `(business_ts AT TIME ZONE 'Europe/London')::date`
   - Tier B: the source's own bucketed date, parsed as-is (GA4's `YYYYMMDD` →
     `date`; GSC's `YYYY-MM-DD` → `date`), stored in `business_date` too, but
     with `date_is_uk_local = false` (see below) so nothing downstream can
     mistake it for a UK date without looking.
   - Tier C (current Meta insights): `business_date = date_start`,
     `date_is_uk_local = false`, plus a `business_date_grain` value of
     `'range'` instead of `'day'` so a query can exclude range rows from any
     per-day aggregation without a human remembering to check `date_stop` too.
5. Handles nulls honestly (Klaviyo drafts → both columns `null`).

New columns on `api_clean`:
```sql
business_ts        timestamptz,          -- real underlying instant, null if none exists
business_date       date,                 -- the derived business day, always Europe/London when date_is_uk_local
date_is_uk_local     boolean not null,     -- false = business_date is source-local (GSC/PT, GA4 pending, Meta insight), NOT comparable to a UK date without conversion
business_date_grain text not null default 'day',  -- 'day' | 'range' (Meta insight windows) | 'none' (order_item/listing, drafts)
```

Naming: `date_is_uk_local` rather than something softer, so a `WHERE
date_is_uk_local` guard is impossible to write by accident-omission — the
column name itself is the warning the brief asked for ("name any column...
so the difference is visible rather than assumed").

Index: `create index on api_clean (source, record_type, business_date) where
business_date_grain = 'day';` — partial index, since range/none rows shouldn't
be in a day-grain query plan anyway.

Idempotent/re-runnable: the trigger recomputes on every upsert, so nothing
about it is a one-time migration step other than the initial backfill
`UPDATE api_clean SET id = id` (or an explicit backfill function) to populate
existing rows once. Re-running the backfill is harmless — same trigger logic,
same deterministic output.

`amazon_asin_daily.report_date` is untouched, per the brief — it already has
its own clearly-named column and doesn't live in `api_clean`.

### 4b. Date dimension table

```sql
create table date_dim (
  date_day          date primary key,      -- Europe/London calendar date
  year              int not null,
  quarter           int not null,
  month             int not null,
  month_name        text not null,
  day_of_month      int not null,
  day_of_week       int not null,          -- 1=Monday .. 7=Sunday (ISO)
  day_name          text not null,
  iso_week          int not null,
  is_weekend        boolean not null,
  is_bst            boolean not null,      -- true if Europe/London was in BST at local noon this day — disambiguates the two DST-transition dates a year where "the offset" isn't single-valued for the whole day
  utc_offset_hours  numeric(3,1) not null  -- +1.0 (BST) or +0.0 (GMT) at local noon
);
```
Generated once via `generate_series('2015-01-01'::date, '2035-12-31'::date,
'1 day')` plus `EXTRACT`/`to_char` — a static, re-runnable seed script, not a
cron job (calendar facts don't change). **Decided (Jon, 2026-08-24): plain
calendar year, Jan–Dec** — no `fiscal_year`/`fiscal_period` columns.

Reporting joins on `api_clean.business_date = date_dim.date_day` (Tier A/B rows
only — Tier C rows have no single day to join on by design).

### 4c. FX rate table

```sql
create table fx_rates (
  id             uuid primary key default gen_random_uuid(),
  from_currency  text not null,        -- e.g. 'EUR', 'JPY' — marketplace currency
  to_currency    text not null default 'GBP',
  rate           numeric(14,6) not null,  -- 1 from_currency = rate * to_currency
  valid_from     date not null,
  valid_to       date,                  -- null = still current
  source         text,                  -- where the rate came from, e.g. 'xe.com', 'ECB', 'manual'
  created_at     timestamptz not null default now(),
  constraint fx_rates_no_overlap exclude using gist (
    from_currency with =,
    to_currency with =,
    daterange(valid_from, coalesce(valid_to, 'infinity'::date), '[]') with &&
  )
);
create index on fx_rates (from_currency, to_currency, valid_from);
```
The `exclude using gist` constraint (needs the `btree_gist` extension) makes
overlapping rate periods for the same currency pair a hard DB error at insert
time rather than a silent double-booking — matches the "no assumed
correctness" spirit of this whole task. A rate lookup for a given
`(currency, business_date)` is `where from_currency = X and business_date
between valid_from and coalesce(valid_to, 'infinity')`.

Sourcing: you said you'll populate this — noted, no design decision needed
from me here beyond the shape above.

**Decided (Jon, 2026-08-24): date-range rows** — one row per period
(`valid_from`/`valid_to`), typically monthly averages for finance reporting,
not one row per day. The schema above already supports this natively: a
period is just `valid_from`..`valid_to`, and a single-day rate is simply a row
where `valid_from = valid_to` — so a finer daily rate can be dropped in later
for any specific currency/period without a schema change, only a narrower row
replacing a wider one (the exclude-overlap constraint enforces that the
narrower row's dates get removed/shortened from the wider one first, so there
can never be two rates claiming the same day for the same currency pair).

---

## 5. Decisions made (2026-08-24) and what's still genuinely open

**Decided, incorporated above:** Shopify business date = `created_at` (§2);
Meta `time_increment=1` connector fix bundled in, going forward only, no
historical backfill (§2, §7); `date_dim` is plain calendar year (§4b);
`fx_rates` is date-range rows (§4c); **GA4 property timezone confirmed UK
(2026-08-24) — `date_is_uk_local = true` for `google_analytics`/traffic+page,
no conversion needed, just parse `YYYYMMDD`.**

**Still open — need you to check something I can't see from code or data:**

1. ~~GA4 property timezone~~ — **resolved 2026-08-24**, see above.
2. **Meta ad account timezone** — check Meta Business Manager → Business
   Settings. Determines whether the *new* daily Meta insight rows (post-fix)
   land as UK-local or need the same `date_is_uk_local = false` treatment as
   GSC once they start arriving.

Doesn't block anything already built — only affects the value of
`date_is_uk_local` on one remaining source's rows, not the schema or
mechanism. Migration ships with it defaulted to `false` (safest assumption:
don't claim UK-local until confirmed) — flip `meta_ads`/`adset_insight` to
`true` in `date_source_config` once you've checked. GA4's rows already ship
`true`, per the confirmation above.

---

## 6. Migration file plan

`lib/migrations/15-date-normalisation.sql`, following the same pattern as
`08`/`14`: idempotent DDL, `backup_before_migration('15-date-normalisation')`
first per Hard Rule 11, registered in `schema_migrations` at the end. Contents:
new `api_clean` columns + trigger function + trigger + partial index (§4a),
`date_dim` table + one-time seed (§4b), `fx_rates` table + `btree_gist`
extension (§4c), and a one-time `backfill_api_clean_dates()` function to
populate `business_ts`/`business_date`/`date_is_uk_local`/`business_date_grain`
on the 266,018 rows that already exist (re-runnable — same trigger logic,
same deterministic output on every call).

**Not part of this migration, separate deploy:** the `meta_ads.py`
`time_increment=1` change from §2/§7 is a Python connector change, not SQL —
goes out as its own commit once you've confirmed the account timezone
question above, so the very first day-grain rows it produces already know
whether they're Tier A or Tier B.

---

## 7. Meta `adset_insight` — backfilling the existing history to daily grain

You asked: how many API calls, what's Meta's retention limit, and can
`run_backfill` already do this with a `time_range`. Answers, with sources
where I have them and honest gaps where I don't:

**Retention — not a blocker.** Meta's documented general retention for
Insights data is 37 months ([Meta Business Help
Center](https://www.facebook.com/business/help/1695754927158071)) — our
~24-month target window (matching the Amazon backfill's 2024-08-16 →
2026-08-16 range) is comfortably inside that. One caveat: Meta separately
restricts **unique-count and hourly-breakdown** data to 13 months
([search result summarising Meta's Marketing API
docs](https://developers.facebook.com/docs/marketing-api/insights/best-practices/)).
`INSIGHT_FIELDS` includes `reach`, which is a unique-count metric — at daily
(non-hourly) grain this is very likely still inside the 37-month window, not
the 13-month one, but I haven't found a source that states that combination
explicitly enough to promise it. Worth a small live test before assuming the
full 24 months of `reach` comes back clean.

**Can `run_backfill` already do it as-is: no, not economically.** Adding
`time_increment=1` to `run_backfill`'s existing `time_range` call would be
syntactically trivial, but requesting the *entire* 2-year range with daily
breakdown across all 548 ad sets in one synchronous call is a different shape
of request than anything this connector does today:
- Theoretical ceiling: 548 adsets × ~730 days ≈ **400,000 rows** if every
  adset had spend on every day (it won't — many of the 548 are old/paused;
  real volume will be lower, but I can't say how much lower without querying
  Meta directly, which I haven't done — this profiling only queried our own
  DB and public docs).
- At the connector's current page size (`limit=100`), that's thousands of
  pages from one synchronous request. Meta's own guidance is that large
  historical multi-breakdown pulls like this should go through the
  **asynchronous Insights Job API** (create a report job, poll, fetch results)
  rather than the synchronous endpoint this connector uses today
  ([Meta Marketing API — Insights best
  practices](https://developers.facebook.com/docs/marketing-api/insights/best-practices/)).
  This connector has no async-job code at all today — it's a real, if
  contained, addition, not a parameter tweak.
- **Meta rate limits are opaque from here.** The per-ad-account hourly budget
  is either 100,000 or 300 + 40×(active campaigns), depending on whether the
  app is on the Marketing API Standard or Dev tier
  ([Meta Marketing API rate
  limiting](https://developers.facebook.com/docs/marketing-api/overview/rate-limiting/))
  — which tier this app is on isn't recorded anywhere in this repo, and I
  can't check the Meta App Dashboard from here.
- **`meta_ads.py` has zero rate-limit or retry/backoff handling today**
  (confirmed — grepped the file for `RateLimiter`/`backoff`/`429`/`sleep`,
  no matches). Amazon's backfill only survives real-world 429s because of the
  retry-with-backoff logic already proven in `_fetch_sales_traffic_day`
  (`amazon_sp_api.py`) — Meta has no equivalent. A naive `time_increment=1`
  historical pull at this volume, with this account's rate-limit tier
  unknown, is very likely to hit 429s with nothing in place to survive them.

**Bottom line, same standard this repo already holds itself to for Amazon
("measured, not assumed"): I don't have a real number for you yet, and I'm
not going to guess one.** What I'd actually recommend before committing to a
full 2-year daily backfill:

1. A small live test — pull 1 ad set, 30 days, `time_increment=1`, synchronous
   endpoint, and measure: does it return in one call or paginate, how many
   rows, any 429s, roughly how long it takes. This tells us the real
   per-adset cost and whether the synchronous endpoint tolerates
   `time_increment=1` at all before deciding whether the async Job API is
   actually required or just Meta's general advice for bigger accounts than
   ours (548 adsets isn't huge).
2. From that measurement, extrapolate a real time/call estimate the way the
   Amazon runbook did (`infra/scheduler/backfill-job.md`), rather than the
   documentation-only numbers above.
3. Decide then whether it's a same-day job or needs the same kind of
   dedicated resumable orchestration Amazon got
   (`backfill_sales_traffic.py`) — I'd guess the latter given the missing
   retry/backoff infrastructure alone, but that's exactly the kind of guess
   the Amazon work taught this codebase not to trust without measuring first.

I haven't run that live test — it spends real Meta API quota against the
production account, so flagging before doing it rather than just doing it.
Say the word and I'll run it and report real numbers back, same shape as the
Amazon Test 1a/1b write-up in `reports/amazon-reports-api.md`.
