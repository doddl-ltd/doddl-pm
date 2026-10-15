"""
Standalone, resumable multi-marketplace backfill orchestrator for
GET_SALES_AND_TRAFFIC_REPORT. Not part of the scheduler's registered jobs.

Run as:
    python -m connectors.scheduler.backfill_sales_traffic

Required environment variables:
    BACKFILL_START          YYYY-MM-DD, required, no default. Clamped at
                             runtime to the confirmed 730-day retention floor
                             (today - 730 days) if given an earlier date —
                             Amazon cancels report requests past that wall,
                             see _SALES_TRAFFIC_RETENTION_DAYS in
                             connectors/scheduler/jobs/amazon_sp_api.py.
    BACKFILL_END            YYYY-MM-DD, optional (inclusive). Defaults to
                             yesterday (today - 1 day) when unset — Amazon's
                             sales/traffic data for a day isn't final until
                             that marketplace's day has closed, so yesterday
                             is the latest end date worth requesting. Leaving
                             it unset is preferred: a fixed value goes stale
                             and silently caps how far forward the backfill
                             reaches.
Optional:
    BACKFILL_MARKETPLACES   comma-separated marketplace_id list; defaults to
                             ACTIVE_MARKETPLACES (currently 9: 7 EU, 2 NA — see
                             connectors/scheduler/jobs/amazon_sp_api.py)
    BACKFILL_PACE_SECONDS   minimum seconds between createReport call starts,
                             per account. Default 65.
    BACKFILL_REVERSE        true/false. When true (default), each marketplace's
                             pending days are processed newest-first instead of
                             oldest-first, so recent data lands early in a long
                             run instead of at the end. Purely an ordering
                             change — does not affect resume/skip logic, which
                             is keyed by (marketplace_id, date) regardless of
                             visit order.

Built 2026-08-19 on two MEASURED findings, not assumptions (see
reports/amazon-reports-api.md for the full test output):

  - Account-level rate-limit buckets are independent (Test 1b, confirmed live:
    EU and NA createReport calls fired simultaneously, both succeeded, zero
    429 interference). This orchestrator runs one thread per account, in
    parallel — safe, not a guess.

  - Deliberate fixed-interval pacing on createReport does NOT reliably avoid
    429s (Test 1a, confirmed live: 12 single-day UK requests at a strict,
    disciplined 65s gap between call starts still hit 429 on 5/12 = 42% of
    them, in two separate clusters — the second cluster appeared again after
    three clean successes, which argues against this being purely leftover
    burst depletion from earlier test activity in the same session).
    BACKFILL_PACE_SECONDS is still applied, configurable, default 65s, per
    spec — but it is a courtesy that reduces load, NOT a guarantee against
    429s. The thing that actually makes this survive 429s is the
    retry-with-backoff already built into _fetch_sales_traffic_day (5
    attempts, Retry-After-aware, 60s default backoff) — untouched here,
    reused exactly as it already exists and has been proven across multiple
    live production runs. Do not tune BACKFILL_PACE_SECONDS down expecting
    fewer retries; the measured evidence doesn't support that expectation.

Deliberately thin, deliberately tightly coupled to
connectors.scheduler.jobs.amazon_sp_api's internals rather than duplicating
its resume/retry/upsert-failure logic (including two underscore-prefixed
"private" helpers, _resume_skip_info and _fetch_sales_traffic_day) — that
logic is already tested and has already run in production against this exact
report type. Calls _fetch_sales_traffic_day directly rather than the
higher-level run_sales_traffic_backfill for two reasons: (1) it returns
(row_count, skipped_count) per day, which run_sales_traffic_backfill only
logs internally and does not return — needed for the progress line this file
is required to print; (2) it lets one token/httpx.Client/rate-limiter be
shared across an ENTIRE account's marketplace list (all 13 EU markets, or
both NA markets), not re-created per marketplace or per day, which
run_sales_traffic_backfill does on every call since it's designed as a
single-marketplace entry point.

No new columns, no new tables, no schema changes — writes go through the
exact same amazon_asin_daily / amazon_asin_daily_status path as
run_sales_traffic_nightly / run_sales_traffic_backfill already use.
"""

import logging
import os
import sys
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta

import httpx

from connectors.lib.secrets import get_secrets
from connectors.scheduler.jobs.amazon_sp_api import (
    ACCOUNTS,
    ACTIVE_MARKETPLACES,
    AccountSkipped,
    ReportsRateLimiters,
    _SALES_TRAFFIC_RETENTION_DAYS,
    _TokenHolder,
    _daterange,
    _fetch_sales_traffic_day,
    _load_account_token_with_expiry,
    _resume_skip_info,
)

logger = logging.getLogger(__name__)

DEFAULT_PACE_SECONDS = 65.0


def _parse_date_env(name: str) -> date | None:
    """Parse a YYYY-MM-DD env var. Returns None if unset; raises SystemExit if malformed."""
    raw = os.environ.get(name)
    if not raw:
        return None
    try:
        return datetime.strptime(raw, "%Y-%m-%d").date()
    except ValueError as exc:
        raise SystemExit(f"{name}={raw!r} is not a valid YYYY-MM-DD date") from exc


def _require_date_env(name: str) -> date:
    parsed = _parse_date_env(name)
    if parsed is None:
        raise SystemExit(f"{name} environment variable is required (format YYYY-MM-DD)")
    return parsed


def _all_marketplace_ids() -> dict[str, tuple[str, str]]:
    """marketplace_id -> (account_name, marketplace_name), across all of ACCOUNTS."""
    out: dict[str, tuple[str, str]] = {}
    for account_name, cfg in ACCOUNTS.items():
        for mid, name, _seller_id in cfg["marketplaces"]:
            out[mid] = (account_name, name)
    return out


def _marketplaces_from_env(catalog: dict[str, tuple[str, str]]) -> list[str]:
    raw = os.environ.get("BACKFILL_MARKETPLACES")
    if not raw:
        return sorted(ACTIVE_MARKETPLACES)
    ids = [m.strip() for m in raw.split(",") if m.strip()]
    unknown = [m for m in ids if m not in catalog]
    if unknown:
        raise SystemExit(
            f"BACKFILL_MARKETPLACES contains marketplace_id(s) not found in ACCOUNTS: {unknown}",
        )
    return ids


class _Progress:
    """Thread-safe running total across all account threads.

    done_pairs starts at the count of (marketplace, day) pairs already 'ok'
    or permanently failed BEFORE this run starts, so a resumed run reports
    accurate progress immediately rather than starting back at 0%.
    """

    def __init__(self, total_pairs: int, already_done_pairs: int) -> None:
        self._lock = threading.Lock()
        self.total_pairs = total_pairs
        self.done_pairs = already_done_pairs
        self._newly_processed = 0
        self._start = time.monotonic()

    def mark_pair_complete(
        self, account_name: str, marketplace_id: str, marketplace_name: str, d: date, row_count: int,
    ) -> None:
        with self._lock:
            self.done_pairs += 1
            self._newly_processed += 1
            elapsed = time.monotonic() - self._start
            rate_per_pair = elapsed / self._newly_processed
            remaining_pairs = max(self.total_pairs - self.done_pairs, 0)
            est_remaining_hours = (remaining_pairs * rate_per_pair) / 3600.0
            pct = 100.0 * self.done_pairs / self.total_pairs if self.total_pairs else 100.0
            logger.info(
                "amazon_sp_backfill: DONE account=%s marketplace=%s (%s) date=%s rows=%d | "
                "%d of %d pairs complete, %.1f%% done, est. %.1fh remaining",
                account_name, marketplace_id, marketplace_name, d, row_count,
                self.done_pairs, self.total_pairs, pct, est_remaining_hours,
            )


def _run_account(
    account_name: str,
    marketplace_ids: list[str],
    marketplace_names: dict[str, str],
    start: date,
    end: date,
    pace_seconds: float,
    reverse: bool,
    progress: _Progress,
    client_id: str,
    client_secret: str,
) -> None:
    account_cfg = ACCOUNTS[account_name]
    token_body = _load_account_token_with_expiry(account_name, account_cfg, client_id, client_secret)
    if token_body is None:
        logger.error(
            "amazon_sp_backfill: account=%s — no token obtainable, skipping this account entirely",
            account_name,
        )
        return

    base_url = account_cfg["endpoint"]
    headers = {"x-amz-access-token": token_body["access_token"], "Accept": "application/json"}
    rl = ReportsRateLimiters()
    token_holder = _TokenHolder(account_name, account_cfg, client_id, client_secret, token_body)

    last_call_start: float | None = None

    with httpx.Client(headers=headers, timeout=90.0) as client:
        for marketplace_id in marketplace_ids:
            marketplace_name = marketplace_names.get(marketplace_id, marketplace_id)
            ok_days, failed_days = _resume_skip_info(marketplace_id, start, end)
            already_skipped = ok_days | failed_days
            pending = [d for d in _daterange(start, end) if d not in already_skipped]
            if reverse:
                pending.reverse()

            logger.info(
                "amazon_sp_backfill: account=%s marketplace=%s (%s) %d day(s) pending "
                "(%d already ok, %d permanently failed after max attempts)",
                account_name, marketplace_id, marketplace_name,
                len(pending), len(ok_days), len(failed_days),
            )

            pull_id = str(uuid.uuid4())
            for d in pending:
                if last_call_start is not None:
                    elapsed = time.monotonic() - last_call_start
                    wait = max(0.0, pace_seconds - elapsed)
                    if wait > 0:
                        time.sleep(wait)
                last_call_start = time.monotonic()

                try:
                    row_count, _skipped_no_child_asin = _fetch_sales_traffic_day(
                        client, base_url, rl, token_holder,
                        marketplace_id, marketplace_name, d, pull_id,
                    )
                except AccountSkipped as exc:
                    logger.error(
                        "amazon_sp_backfill: account=%s — %s — aborting remaining "
                        "marketplaces/days for this account (other accounts unaffected)",
                        account_name, exc,
                    )
                    return

                progress.mark_pair_complete(account_name, marketplace_id, marketplace_name, d, row_count)

    logger.info("amazon_sp_backfill: account=%s ALL MARKETPLACES COMPLETE", account_name)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    logging.getLogger("azure").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)

    start = _require_date_env("BACKFILL_START")
    # BACKFILL_END defaults to yesterday when unset. Amazon's sales/traffic data
    # for a day isn't final until that marketplace's day has closed, so yesterday
    # is the furthest forward worth requesting — and defaulting means the value
    # can't go stale and silently cap the backfill's reach, the way a hardcoded
    # env var did (it sat at 2026-08-16 while data quietly stopped landing).
    end = _parse_date_env("BACKFILL_END") or (date.today() - timedelta(days=1))
    logger.info(
        "amazon_sp_backfill: BACKFILL_END=%s (%s)",
        end, "from env" if os.environ.get("BACKFILL_END") else "defaulted to yesterday",
    )
    if start > end:
        raise SystemExit(f"BACKFILL_START ({start}) is after BACKFILL_END ({end})")

    # Clamp at runtime rather than requiring the operator to compute the floor
    # by hand — the floor moves with today's date on every run anyway.
    # _SALES_TRAFFIC_RETENTION_DAYS is CONFIRMED (2026-08-25, see its header
    # comment in amazon_sp_api.py): Amazon cancels GET_SALES_AND_TRAFFIC_REPORT
    # past this wall, every time, no exceptions found. _fetch_sales_traffic_day
    # already skips an individual day past the wall without calling Amazon,
    # but clamping here too means a long historical BACKFILL_START doesn't
    # spend hours walking through days that are all going to be skipped
    # anyway — the plan log below reports the true, already-clamped range.
    retention_floor = date.today() - timedelta(days=_SALES_TRAFFIC_RETENTION_DAYS)
    if start < retention_floor:
        logger.warning(
            "amazon_sp_backfill: BACKFILL_START %s is before the %d-day retention floor "
            "(%s) — Amazon cancels report requests past this wall. Clamping BACKFILL_START "
            "to %s.",
            start, _SALES_TRAFFIC_RETENTION_DAYS, retention_floor, retention_floor,
        )
        start = retention_floor
    if start > end:
        raise SystemExit(
            f"Requested range ({end} back to the original BACKFILL_START) is entirely "
            f"before the {_SALES_TRAFFIC_RETENTION_DAYS}-day retention floor ({retention_floor}) "
            f"— nothing in this range is fetchable."
        )

    catalog = _all_marketplace_ids()
    marketplace_ids = _marketplaces_from_env(catalog)
    pace_seconds = float(os.environ.get("BACKFILL_PACE_SECONDS", str(DEFAULT_PACE_SECONDS)))
    reverse = os.environ.get("BACKFILL_REVERSE", "true").strip().lower() not in ("false", "0", "no")

    by_account: dict[str, list[str]] = {}
    marketplace_names: dict[str, str] = {}
    for mid in marketplace_ids:
        account_name, name = catalog[mid]
        by_account.setdefault(account_name, []).append(mid)
        marketplace_names[mid] = name

    total_days = (end - start).days + 1
    total_pairs = len(marketplace_ids) * total_days

    logger.info(
        "amazon_sp_backfill: PLAN start=%s end=%s (%d day(s)) marketplaces=%d accounts=%s "
        "pace=%.0fs reverse=%s total_pairs=%d",
        start, end, total_days, len(marketplace_ids), sorted(by_account.keys()), pace_seconds, reverse, total_pairs,
    )
    logger.info("amazon_sp_backfill: marketplace_ids=%s", sorted(marketplace_ids))

    # Pre-count already-complete pairs so a resumed run reports real progress
    # immediately instead of starting back at 0%.
    already_done = 0
    for mid in marketplace_ids:
        ok_days, failed_days = _resume_skip_info(mid, start, end)
        already_done += len(ok_days) + len(failed_days)
    logger.info(
        "amazon_sp_backfill: RESUME %d of %d pairs already complete (ok or permanently failed) "
        "before this run starts",
        already_done, total_pairs,
    )

    creds = get_secrets(["amazon-sp-api-client-id", "amazon-sp-api-client-secret"])
    client_id = creds["amazon-sp-api-client-id"]
    client_secret = creds["amazon-sp-api-client-secret"]

    progress = _Progress(total_pairs=total_pairs, already_done_pairs=already_done)

    failed_accounts: list[str] = []
    with ThreadPoolExecutor(max_workers=len(by_account), thread_name_prefix="backfill_account") as executor:
        futures = {
            executor.submit(
                _run_account, account_name, mids, marketplace_names, start, end,
                pace_seconds, reverse, progress, client_id, client_secret,
            ): account_name
            for account_name, mids in by_account.items()
        }
        for future in as_completed(futures):
            account_name = futures[future]
            try:
                future.result()
            except Exception as exc:
                logger.error(
                    "amazon_sp_backfill: account=%s thread FAILED unexpectedly: %s",
                    account_name, exc, exc_info=True,
                )
                failed_accounts.append(account_name)

    logger.info(
        "amazon_sp_backfill: RUN COMPLETE. %d of %d pairs done.",
        progress.done_pairs, progress.total_pairs,
    )
    if failed_accounts:
        logger.error("amazon_sp_backfill: account thread(s) failed unexpectedly: %s", failed_accounts)
        sys.exit(1)


if __name__ == "__main__":
    main()
