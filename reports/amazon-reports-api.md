# Amazon SP-API Reports API — Extension

**Date:** 2026-08-17 (revised same day — see Revision history)
**Author:** Claude Code (build + local test only — no production deploy, no git push, no `az`, nothing registered in `scheduler.py`)
**Repo:** `C:\Users\JonFawcett\Documents\doddl-pm`
**File changed:** `connectors/scheduler/jobs/amazon_sp_api.py` (append only — see "What was NOT touched" below)

## Revision history

| Rev | Change |
|---|---|
| 1 | Initial build: Reports API client, 3a/3b/3c entry points, dry-run CLI |
| 2 | Three fixes: (1) `run_listings()` ID format corrected to underscore-separated, matching `_sync_listings` exactly — one row per real listing, no more duplicate-by-format; (2) confirmed staying synchronous, no change; (3) `_ORDER_ITEMS_CHUNK_DAYS`/`_SALES_TRAFFIC_RETENTION_DAYS` moved to configurable module-level constants, `_create_report_adaptive` added so a rejected date range is halved and retried instead of silently truncating, sales/traffic empty results near the retention boundary now log "possible retention limit" explicitly. Also added: `_TokenHolder`, refreshing the LWA access token before each report request once it is over 45 minutes old — a real bug for long backfills (~1h token TTL), not hypothetical. |
| 3 | Three fixes from a patch brief with confirmed (not guessed) knowledge of the Sales & Traffic report's behaviour: (1) rewrote sales_traffic entirely — `salesAndTrafficByAsin` is aggregated across the whole requested range, so `dataStartTime == dataEndTime` is mandatory, not a design choice under uncertainty as rev 2 assumed; split into `run_sales_traffic_nightly()` (yesterday, all marketplaces) and `run_sales_traffic_backfill()` (one marketplace, resumable, gap-tracked), storing to new tables `amazon_asin_daily`/`amazon_asin_daily_status` instead of `api_clean`; (2) `_TokenHolder` rewritten to track the LWA token's real `expires_in` instead of assumed elapsed time since load, and now raises `AccountSkipped` on refresh failure instead of silently continuing on a stale token; (3) fixed `_sync_listings`'s `'unknown'` SKU fallback, which silently collapsed every SKU-less item into one overwriting row — this touches code the original brief marked "do not modify," now explicitly requested. Two deviations flagged and kept: stayed synchronous (already agreed rev 2); kept the existing rate-limiter (`ReportsRateLimiters`, verified against Amazon's real spec) instead of adding the brief's proposed separate `_throttle()`/`_CREATE_REPORT_MIN_INTERVAL_S` mechanism, since it would duplicate already-correct infrastructure. |
| 4 | Nine fixes, the most serious being a real correctness bug: (1) `asinGranularity` reverted `SKU` to `CHILD` (confirmed by Jon); dropped `sku` column entirely from `amazon_asin_daily` (was always-null under CHILD, a future PK-collision risk left in place); added `browser_sessions`/`mobile_app_sessions`; `unit_session_pct` widened to `numeric(6,3)` (can exceed 100%). (2) Retention cutoff no longer blocks a request — reverted to interpretation-only, since a wrong 730-day guess was silently truncating the backfill and writing gap rows that looked like real findings. (3) **The serious one**: `_fetch_sales_traffic_day` used to call `_mark_fetched` (status 'ok') unconditionally, even when parsing produced zero rows — so a genuinely empty day and a day where the field-name assumptions were simply wrong were indistinguishable, both reported as success, and `resume=True` would then skip re-fetching the broken ones forever. Fixed: a missing/malformed `salesAndTrafficByAsin` key, or entries present but none yielding a row, now marks a new status 'parse_failed' with a specific reason and logs the actual top-level keys — never 'ok'. (4) `write_raw` now stores the complete parsed response body (nested under "report", alongside the existing status/date fields), not just `{"processingStatus", "date"}` — so a wrong field-name assumption can be re-transformed from `api_raw` later without re-fetching at 1/60s. (5) Removed the `childAsin or parentAsin` fallback — a parent-level entry is now skipped, logged, and counted (never written as a same-shaped row that would double-count in a SUM); the skip count is aggregated and logged once at the end of both entry points. (6) Added an `attempts` column to `amazon_asin_daily_status`; `resume=True` now also skips (and separately logs as "needs manual investigation") any day that has hit `_MAX_ATTEMPTS` (3) without succeeding, instead of retrying a permanent failure forever at 1/60s. (7) Added `ACTIVE_MARKETPLACES` (filter only, `ACCOUNTS` untouched) so `run_sales_traffic_nightly` doesn't burn 19 `createReport` calls/night on markets with no sales — **left empty on purpose, real marketplace_id values not supplied this session, see below**; `run_sales_traffic_nightly` refuses to run while it's empty rather than guessing. (8) Downgraded the module comment's "CONFIRMED" claim about response-blending to "believed, pending first live run" — it was never actually observed. (9) Checked for anywhere splitting the `{marketplace_id}_{sku}` composite key back apart (SKUs can contain underscores) — confirmed via grep, nothing in the file does this, no change needed.

## Why

`getOrders` returns order headers only — 91,786 production `api_clean` rows with `record_type='order'` and no ASIN, SKU, quantity, or item price (verified against production earlier this session — see the single-row `SELECT` in this conversation). No sessions/pageviews/conversion data exists at all. This adds SP-API Reports API support for three report types to close both gaps, without touching the existing Orders API path.

## What was added

All in `connectors/scheduler/jobs/amazon_sp_api.py`, appended after the existing `run_backfill()` — nothing above that point was edited except two import lines (added `csv`, `gzip`, `io`, `json`, and `date` from `datetime`; nothing existing removed). Confirmed via `git diff`: the diff starts exactly at the import block and at the line after `run_backfill()`'s last statement, plus unrelated NA/NA-2 account-merge changes that were already uncommitted in the working tree **before** this session started (visible in the same diff, not something this session did).

| Piece | What it does |
|---|---|
| `ReportsRateLimiters` | Per-account create/poll/document `_RateLimiter` triplet — reuses the existing `_RateLimiter` class unchanged |
| `_create_report` / `_poll_report` / `_download_report_document` | POST → poll → GET document → download, matching the spec |
| `_decode_report_bytes` | Tries `utf-8-sig`, `utf-8`, `cp1252` in order |
| `_parse_tsv` | `csv.DictReader` off the file's own header row — no hardcoded column positions |
| `run_report_sync` | The one reusable helper — create/poll/download/parse, returns `(parsed, columns, status_body)`, branches on `report_format="tsv"|"json"` |
| `_chunk_date_range` | Splits a date range into contiguous, non-overlapping windows of at most N days |
| `_looks_like_range_too_wide` *(rev 2)* | Heuristic: is an `httpx.HTTPStatusError` a 400 whose body mentions date/range/too-wide-type wording? Explicitly flagged as unconfirmed against a real Amazon error body — see below |
| `_create_report_adaptive` *(rev 2)* | Wraps `run_report_sync` for one date-range chunk: on a "too wide" rejection, halves the chunk and retries each half (recursing to `min_days`), logging the accepted width; also calls `token_holder.ensure_fresh()` before each request |
| `_TokenHolder` *(rev 2)* | Tracks one account's LWA access token; `ensure_fresh(client)` refreshes it in place (via the existing `_load_account_token`) once it is over 45 minutes old |
| `_run_reports_for_all_accounts` | Shared per-account orchestration (parallel across accounts, sequential per marketplace within an account); *(rev 2)* now builds one `_TokenHolder` per account and passes it to every `per_marketplace` call |
| `run_listings()` | 3a — `GET_MERCHANT_LISTINGS_ALL_DATA`, one call per marketplace, all 19 marketplaces |
| `run_order_items(start_date, end_date)` | 3b — `GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL`, chunked |
| `run_sales_traffic(start_date, end_date)` | 3c — `GET_SALES_AND_TRAFFIC_REPORT`, JSON format, chunked to 1 day |
| `dry_run_report()` + `if __name__ == "__main__"` CLI | Step 5 — create/poll/download/parse one real report and print a preview, no DB writes |

None of `run_listings`, `run_order_items`, `run_sales_traffic` are registered in `scheduler.py`. Scheduling is explicitly your call, per the brief.

## Deviation from the brief, flagged

**The brief asked for an async report helper. This is synchronous**, using the same `httpx.Client` + `time.sleep` backoff pattern already used everywhere else in this file (see the existing 429 handling in `_get`). Reasoning: the rest of the file is fully synchronous, using `ThreadPoolExecutor` for cross-account parallelism, not `asyncio`. Report polling is inherently sequential per report regardless of sync/async (create → wait → poll → wait → download), so `asyncio` would buy nothing here except a second, inconsistent concurrency model living alongside the thread-pool one already in `run()`/`run_backfill()`. Cross-account and (via the same mechanism) cross-marketplace-report parallelism is achieved the same way the existing code already achieves it — one thread per account. If you actually want `asyncio` here (e.g. because a future caller needs to run report requests concurrently with something else that's already async), say so and I'll redo it — flagging now rather than silently deciding against an explicit instruction.

## Amazon request/retention limits found — and what wasn't found

**Rate limits — verified, source-quoted.** Confirmed from the official SP-API OpenAPI model (`github.com/amzn/selling-partner-api-models`, `reports-api-model/reports_2021-06-30.json`, fetched via `raw.githubusercontent.com` this session):

| Operation | Rate | Burst |
|---|---|---|
| `createReport` | 0.0167 req/s (1 per 60s) | 15 |
| `getReport` (poll) | 2 req/s | 15 |
| `getReportDocument` | 0.0167 req/s (1 per 60s) | 15 |

Also confirmed from the same source: `processingStatus` is one of `CANCELLED`, `DONE`, `FATAL`, `IN_PROGRESS`, `IN_QUEUE`; `createReportSpecification` takes `reportType` (required), `marketplaceIds` (required, 1–25), `dataStartTime`/`dataEndTime` (optional ISO 8601), `reportOptions` (optional key-value).

**Date-range/retention limits — NOT verified. Could not reach the docs, could not test live.** Both avenues the brief suggested were tried and both failed:

- **Docs:** `https://developer-docs.amazon.com/sp-api/docs/...` returns a 301 to `https://developer-docs.amazon/sp-api/docs/...` — note no `.com`, not a resolvable hostname. This happened for every path tried (order-reports, analytics-reports, the API reference), including with a trailing slash. I did not follow it — a redirect target with no TLD isn't a legitimate destination to fetch. Tried two fallbacks: the archived GitHub docs mirror (confirms the content moved to that same unreachable site, nothing more) and the Wayback Machine (blocked entirely in this environment, both URLs). I flagged this to you rather than guessing silently.
- **Live testing:** blocked by the same broken local Key Vault access recorded in `reports/scheduler-deploy-prep.md` ("Known local-tooling issue — WON'T FIX"). This affects the Amazon LWA credentials too, not just Supabase — `get_secret`/`get_secrets` in `connectors/lib/secrets.py` is the same Key Vault path for both, and there's no local `.env.local` fallback for Amazon secrets the way there is for Supabase.

So, per your instruction not to fake a test or mark it passing, here's exactly what the code assumes and why, clearly marked as assumptions in the code itself (see the comments directly above each constant, now grouped together near the top of the Reports API section, not scattered next to their functions):

| Constant | Value | Status | Basis |
|---|---|---|---|
| `_ORDER_ITEMS_CHUNK_DAYS` | 30 (starting point only, rev 2) | **Unverified, but self-correcting at runtime** | Commonly cited limit for `BY_ORDER_DATE` flat-file order reports from prior SP-API experience — not confirmed this session. `run_order_items` no longer trusts this blindly: `_create_report_adaptive` halves and retries any chunk Amazon rejects as too wide, and logs the width that actually got accepted |
| `_SALES_TRAFFIC_RETENTION_DAYS` | 730 (~2 years) | **Unverified** | Commonly cited retention for Sales and Traffic Business Reports — not confirmed this session. Only used to flag an empty result as a possible retention hit in the log (rev 2) — never to block a request |
| `_SALES_TRAFFIC_CHUNK_DAYS` | 1 (forced) | **Deliberate design choice, not a guess** | See below — unchanged this revision |

**Rev 2 — no longer silently truncating.** Previously these were hardcoded and a wrong guess would fail without explanation or worse, silently produce less data than requested. Now: `run_order_items` starts at 30 days but adapts — if Amazon returns a 400 that looks date/range-related (`_looks_like_range_too_wide`, keyword-matched against the error body — flagged as a heuristic, not confirmed against a real error body), it halves the chunk and retries, recursing down to a 1-day floor, and logs `amazon_sp: <report_type> accepted width=N day(s)` once something succeeds. That log line is now the actual answer to "what's the real limit" — a fact discovered at runtime, not a guess. `run_sales_traffic` logs `possible retention limit` explicitly whenever a request for a date before the assumed retention cutoff returns zero rows, instead of a silent, indistinguishable-from-normal empty result.

**Caveat on the heuristic:** `_looks_like_range_too_wide` cannot be verified without a real Amazon 400 response, which was not available this session (see below). If Amazon's actual wording does not contain any of the keywords it checks for (`date`, `range`, `too large`, `too wide`, `exceed`, `period`, `interval`), a genuine "too wide" rejection would NOT be recognized as one, and would instead propagate as a hard failure for that chunk (logged via the existing per-marketplace exception handler in `_run_reports_for_all_accounts`) rather than being halved. That is a safe failure mode — it stops and tells you, it does not silently drop data — but it means the halving might not kick in on the first real attempt if Amazon's wording differs from what is guessed here. Worth checking the actual error body the first time this runs for real.

**What to do about the still-unverified retention number:** either check the current `developer-docs.amazon.com` page yourself (your browser won't hit the same broken redirect this session did — it may well be a transient issue on this tool's end, not the real site), or watch for the `possible retention limit` log line once you actually run a wide `run_sales_traffic` backfill. Either becomes a real, cheap fact — right now it's genuinely unknown.

## Token refresh — added, not part of the original three fixes but flagged as a real bug

LWA access tokens are ~1h TTL (already documented in `_get_access_token`'s existing docstring — established fact, not new). Before this fix, `_run_reports_for_all_accounts` fetched one token per account at the very start of `run_order_items`/`run_sales_traffic` and reused it for every marketplace and every date chunk for the rest of that run. A wide backfill (many marketplaces × many chunks, each involving a `createReport` + poll-to-DONE + download cycle) can easily exceed an hour, at which point every subsequent report request would have started failing on an expired token partway through a run — a real failure mode for exactly the kind of backfill this extension exists to support, not a hypothetical edge case.

Fix: `_TokenHolder` (one per account, built in `_run_reports_for_all_accounts`) tracks how long its token has been held. `ensure_fresh(client)` is called at the top of `_create_report_adaptive` (i.e. before every report request, including every halving retry) and in `run_listings`'s single-report path. Once the token is over `_TOKEN_REFRESH_AFTER_SECONDS` (45 minutes) old, it re-fetches via the existing `_load_account_token` (same refresh-token-plus-fallback lookup already used at startup — no new Key Vault interaction pattern introduced) and updates `client.headers["x-amz-access-token"]` in place, so every subsequent request on that `httpx.Client` uses the new token automatically.

## Why `_SALES_TRAFFIC_CHUNK_DAYS` is forced to 1, specifically

This wasn't a limit I looked for and failed to find — it's a correctness decision under uncertainty. `source_record_id = f"{marketplace_id}:{child_asin}:{date}"` needs to know, for certain, which calendar day each `salesAndTrafficByAsin` entry belongs to. With `dataStartTime`/`dataEndTime` spanning multiple days and `dateGranularity=DAY`, I could not confirm (docs unreachable, no live test) whether Amazon's response tags each ASIN entry with its own date, or returns one total aggregated across the whole requested range. Requesting exactly one calendar day per report makes the question moot — the date in `source_record_id` is always the day that was asked for, never inferred from the response body. The real cost: `createReport` is rate-limited to 1 per 60 seconds, so backfilling N days × M marketplaces means N×M createReport calls, minimum N×M minutes just in that one rate limit before polling/download time. For 19 marketplaces × 30 days that's a minimum of 570 createReport calls — roughly 9.5 hours just in create-report spacing, before any poll/download time or the fact each report also takes real processing time on Amazon's side. Worth knowing before you decide how much history to actually backfill with this entry point.

## `source_record_id` schemes and why they don't collide

Confirmed from `connectors/lib/db.py`: the `api_clean` unique constraint is `(source, record_type, source_record_id)` — the full three-part tuple, not `source_record_id` alone.

- **`listing`** (3a): **`f"{marketplace_id}_{seller_sku}"`** — corrected at rev 2 to underscore-separated, now byte-for-byte the same format as the *existing* Listings-Items-API-sourced rows written by `_sync_listings` (`f"{marketplace_id}_{item.get('sku', 'unknown')}"`, untouched, still runs in `run()`). Same `record_type='listing'` too, so both sources now upsert into the exact same `api_clean` row per real listing — one row, not two — with whichever source ran most recently winning via `resolution=merge-duplicates`. The rev-1 colon-separated format was wrong; it produced a duplicate row per listing instead of unifying with the existing data.
- **`order_item`** (3b): `f"{amazon_order_id}:{seller_sku}"`. Cannot collide with the existing `record_type='order'` rows **regardless of the ID string chosen**, because `record_type` differs and is part of the same composite key. The colon join with `seller_sku` is doing a different job than collision-avoidance with `order` rows: it's what keeps multiple line items *within the same order* from colliding with each other, since one order can have several SKUs.
- **`sales_traffic`** (3c): `f"{marketplace_id}:{child_asin}:{date}"`. New `record_type`, no existing rows to collide with at all.

## What still needs testing against live credentials

Nothing in this file has been executed against live Amazon or Supabase. What's tested vs. not:

**Tested, locally, with synthetic data (real assertions, output shown, not fabricated):**
- `_chunk_date_range` — 30-day and 1-day chunking, contiguous/no-gap/no-overlap, single-day range, reversed-range error
- `_decode_report_bytes` — cp1252 (curly apostrophe), UTF-8 (accented character), UTF-8-with-BOM (BOM correctly stripped)
- `_parse_tsv` — parses via header row, confirmed no hardcoded column assumption, empty-input handling
- gzip round-trip (the same `gzip.decompress` call `_download_report_document` makes)
- *(rev 2)* `_create_report_adaptive` against a fake client that rejects any request over 2 days as "too wide": confirmed it retries the full 4-day range first, halves on rejection, both halves land at width 2, together cover the original range with no gap or overlap, and each half's rows are correctly parsed
- *(rev 2)* `_create_report_adaptive` against a fake client that accepts the full range immediately: confirmed exactly one `createReport` call, no unnecessary halving
- *(rev 2)* `_looks_like_range_too_wide`: confirmed it returns `True` for a 400 whose body mentions "date range", `False` for a 400 about an unrelated field (`marketplaceIds`), and `False` for a non-400 (403) — the false-positive and false-negative cases were checked, not just the happy path
- *(rev 2)* `_TokenHolder.ensure_fresh`: confirmed it does NOT refresh a token under 45 minutes old, DOES refresh (exactly once) a token artificially aged past 45 minutes, updates `client.headers` and `.token` in place, and does not refresh again immediately after
- `python -m py_compile` on the whole file — no syntax errors
- `git diff` review — confirms the edit is a clean append plus two import lines, nothing else touched

**Not tested — blocked, per your instruction not to fake it:**
- Any actual `createReport` / `getReport` / `getReportDocument` call against Amazon — needs LWA credentials from Key Vault, unreachable locally (documented WON'T FIX)
- Whether real Amazon TSV output actually matches the assumed column names (`seller-sku`, `amazon-order-id`, `sku`, etc.) — these are from memory/documentation convention, not observed on a real response
- Whether `GET_SALES_AND_TRAFFIC_REPORT`'s real JSON shape actually has a top-level `salesAndTrafficByAsin` array with `childAsin`/`salesByAsin`/`trafficByAsin` keys as assumed
- The two unverified date-range/retention constants above
- Whether requesting `GET_MERCHANT_LISTINGS_ALL_DATA` with a single `marketplaceIds` entry is actually necessary (vs. Amazon accepting/returning per-marketplace data for a combined multi-marketplace request) — assumed necessary because the flat file has no marketplace-id column of its own, consistent with how `_sync_listings`/`_sync_inventory` already handle this same problem for the Listings Items API, but not confirmed for this specific report type
- End-to-end row counts, timing, and whether the 30-minute poll timeout (`_REPORT_POLL_MAX_WAIT_S`) is generous enough for a real large listings/order report

## How to invoke the dry run, once Key Vault access works

```bash
cd connectors
python -m scheduler.jobs.amazon_sp_api listings --account EU --marketplace A1F83G8C2ARO7P
python -m scheduler.jobs.amazon_sp_api order_items --account EU --marketplace A1F83G8C2ARO7P --start 2026-07-01 --end 2026-07-07
python -m scheduler.jobs.amazon_sp_api sales_traffic --account EU --marketplace A1F83G8C2ARO7P --start 2026-07-01
```

(Run as a module — `-m scheduler.jobs.amazon_sp_api` from inside `connectors/` — so the `connectors.lib.*` absolute imports at the top of the file resolve; running the file directly as a script would break those imports.)

`--account` defaults to `EU`, `--marketplace` defaults to that account's first configured marketplace if omitted. Requires `AZURE_KEYVAULT_URI` set in the environment (per `connectors/lib/secrets.py`) and working Azure auth — i.e. the same access that's currently broken locally per `reports/scheduler-deploy-prep.md`. I could not run these myself this session.

## New storage, and what it needs before it works for real

`run_sales_traffic_nightly`/`run_sales_traffic_backfill` write to two **new** tables, not `api_clean`: `amazon_asin_daily` (one row per marketplace/ASIN/day — no `sku` column as of rev 4, see below) and `amazon_asin_daily_status` (per marketplace/day, `status='ok'|'gap'|'parse_failed'` + reason + `attempts` — makes `resume=True`, gap visibility, and giving up on permanent failures all possible). Migration written to `lib/migrations/14-amazon-asin-daily.sql`, following the existing `12-apscheduler-jobs-table.sql` pattern (RLS + authenticated-read policy + `schema_migrations` registration; no `backup_before_migration` call, matching that same precedent, since it creates new tables with no existing row data at risk). **Not committed to git, not applied** — per Hard Rule 3, applying it requires the file committed first, and this session stayed in build-and-test mode throughout. `run_sales_traffic_backfill`'s `resume=True` path and both entry points' writes will fail with an HTTP error against a real Supabase project until this migration is applied.

Also added to `connectors/lib/db.py`, purely additive: `upsert_table(table, records, on_conflict)` and `select_rows(table, select=, filters=, order=, limit=)` — generic PostgREST helpers parameterized by table name, used by the new sales_traffic status/data functions. `upsert_clean`/`upsert_clean_batch`/`write_raw`/`last_pull_ts` untouched.

## Rev 4 — one thing needs an answer before this is usable: ACTIVE_MARKETPLACES

Fix 7 added `ACTIVE_MARKETPLACES: set[str]` near the top of the Reports API section, meant to hold the `marketplace_id` values doddl actually sells in (five, per Jon). **Left empty** — I don't have the real five IDs and guessing wrong here is a genuine correctness risk (silently drop real sales data, or silently waste `createReport` quota on dead markets), not a style choice. `run_sales_traffic_nightly` checks for this and refuses to run (logs an error, returns) rather than silently doing nothing or falling back to all 19. **This needs an answer from Jon before `run_sales_traffic_nightly` can be used at all** — fill in the five `marketplace_id` values (see the `ACCOUNTS` dict earlier in the file for the full list of 19 to choose from) at the `ACTIVE_MARKETPLACES` definition. `run_sales_traffic_backfill` is unaffected — it always takes an explicit single `marketplace_id` argument; it just logs a warning if that marketplace isn't in `ACTIVE_MARKETPLACES` once filled in.

**What's still unverified, specifically (unchanged in kind since rev 3, narrower in scope after rev 4's fixes):**
- `_parse_sales_traffic_asin`'s field names (`salesAndTrafficByAsin`, `childAsin`, nested `salesByAsin`/`trafficByAsin`/`browserSessions`/`mobileAppSessions` shapes) — not observed on a real response. If wrong, the day is now marked `parse_failed` (not silently `ok`, fixed at rev 4) and the full response is preserved in `api_raw` for re-transforming without re-fetching.
- Whether `salesAndTrafficByAsin` actually blends across a multi-day range — downgraded from "CONFIRMED" to "believed, pending first live run" at rev 4 (fix 8); it was asserted but never actually observed this session.
- The 400-body content for a genuine rejection — `_fetch_sales_traffic_day` logs the full body on any 400, which is how that gets replaced with a real fact.
- `_TOKEN_MARGIN_S` (300s) and the actual `expires_in` Amazon returns — logged on every refresh.

**Local tests added for rev 4** (real assertions, output shown, synthetic data — no live calls, see `test_rev4.py` output this session): request body uses `asinGranularity=CHILD`; parsed rows have no `sku` key and carry `browser_sessions`/`mobile_app_sessions`, with `unit_session_pct` values over 100 preserved; a pre-retention day is still attempted (not skipped) and an empty result from it is marked `ok` not `gap`; a missing `salesAndTrafficByAsin` key is marked `parse_failed`, never `ok`; an all-parentAsin-only response is marked `parse_failed` with zero rows written (no double-counting fallback); the full response body lands in the `api_raw` write; mixed child/parent entries keep only the child rows and count the skip; `_mark_gap`/`_mark_parse_failed` correctly increment `attempts` from the existing stored value; `_resume_skip_info` correctly separates already-`ok`, permanently-failed (`attempts >= _MAX_ATTEMPTS`), and still-retryable days.

## First live run — checklist from the brief, kept here for reference

Deploy, then **one manual trigger**, not the schedule. Narrow: one marketplace, three consecutive days. Verify:
- Three separate rows per ASIN, one per date — not one blended row (this is what's "believed, pending" — see above)
- No days silently marked `ok` when they should be `parse_failed` — check `amazon_asin_daily_status` for any `parse_failed` rows and read their `reason`
- The logged `expires_in` value matches (or corrects) the assumed 300s margin
- No 429s at the current throttle (existing `ReportsRateLimiters`, 1/60s + burst 15)
- Any 400 body captured in full (logged automatically)

Then widen. Then register the schedule. None of this has been run — no live credentials this session.

## What was NOT touched

- `run()`, `run_backfill()`, `_sync_orders`, `_sync_inventory`, `_sync_marketplace`, `_sync_account`, `_RateLimiter`, `_get_access_token`, `_load_account_token`, `ACCOUNTS` (aside from the pre-existing uncommitted NA/NA-2 merge, not from this session) — all byte-identical to before this task, confirmed via `git diff`.
- `_sync_listings` — **touched at rev 3** (the `'unknown'` SKU fallback fix), explicitly requested; not silently changed. Everything else in it is unchanged.
- `scheduler.py` — not edited, nothing new registered.
- No `git add`/`commit`/`push`. No `az` command run. No write to production or staging Supabase (no entry point was executed against a real network this session).
