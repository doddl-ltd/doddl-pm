"""
Historical data backfill runner.

Goes back as far as each connector's API allows, syncing data in date chunks.
All writes use upsert_clean — completely safe to re-run after partial failures.

Max lookback per connector:
  Shopify              — unlimited  (account creation; connector paginates)
  Klaviyo              — unlimited  (account creation; connector paginates)
  Amazon SP-API        — 2 years   (Orders API hard limit)
  Amazon Advertising   — ~3 years  (Reporting API v3; varies per report type)
  Meta Ads insights    — 37 months (Graph API hard limit)
  GA4                  — property creation date
  Google Search Console— 16 months (hard limit; data lags 3 days)
  Microsoft Clarity    — ~2 years  (Data Export API)
  Google Ads           — account creation date

Usage:
    # Full backfill of all connectors:
    python scripts/run_backfill.py

    # Single connector only:
    python scripts/run_backfill.py --connector shopify
    python scripts/run_backfill.py --connector ga4
    python scripts/run_backfill.py --connector meta
    python scripts/run_backfill.py --connector klaviyo
    python scripts/run_backfill.py --connector amazon
    python scripts/run_backfill.py --connector amazon_ads
    python scripts/run_backfill.py --connector gsc
    python scripts/run_backfill.py --connector clarity
    python scripts/run_backfill.py --connector google_ads

    # Override start date (useful for re-running a gap):
    python scripts/run_backfill.py --connector ga4 --start 2023-01-01

    # Override as a day count back from today (Amazon Ads retention window):
    python scripts/run_backfill.py --connector amazon_ads --since 95

Set AZURE_KEYVAULT_URI before running.
"""

import sys
import os
import logging
import time
import argparse
from datetime import date, timedelta
from typing import Callable, Iterator, Tuple

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
    handlers=[logging.StreamHandler(sys.stdout)],
)
# Silence the Azure SDK's per-request HTTP logs — they fire once per DB write
# and make the output completely unreadable
logging.getLogger("azure").setLevel(logging.WARNING)
logging.getLogger("azure.core.pipeline.policies.http_logging_policy").setLevel(logging.WARNING)
logger = logging.getLogger("backfill")

# Amazon Ads v3 reporting data retention. Older dates are accepted by the API
# but return no rows, so this bounds the Amazon Advertising backfill by default.
ADS_RETENTION_DAYS = 95


# ── Date chunking ─────────────────────────────────────────────────────────────

def date_chunks(start: date, end: date, chunk_days: int) -> Iterator[Tuple[date, date]]:
    """Yield (chunk_start, chunk_end) pairs, newest-first.

    Newest-first means the most recent data is written first, so a mid-run
    failure still leaves you with a useful recent dataset.
    """
    current_end = end
    while current_end > start:
        current_start = max(start, current_end - timedelta(days=chunk_days - 1))
        yield current_start, current_end
        current_end = current_start - timedelta(days=1)


# ── Runners ───────────────────────────────────────────────────────────────────

def run_single(connector_name: str, func: Callable, start: date) -> dict:
    """Run a connector's backfill function with a single start date.

    Used for connectors (Shopify, Klaviyo) that handle pagination internally
    and can fetch their entire history in one session.
    """
    logger.info("%s: single pull since %s (connector paginates internally)", connector_name, start)
    try:
        func(start)
        return {"ok": 1, "failed": [], "total": 1}
    except Exception as exc:
        logger.error("%s FAILED: %s", connector_name, exc, exc_info=True)
        return {"ok": 0, "failed": [(start, date.today(), str(exc))], "total": 1}


def run_chunked(
    connector_name: str,
    func: Callable,
    start: date,
    end: date,
    chunk_days: int,
    pause_s: float = 2.0,
) -> dict:
    """Run a connector's backfill function over chunked date ranges.

    Iterates newest → oldest. Each chunk failure is logged and skipped so
    the rest of the backfill still completes.
    """
    chunks = list(date_chunks(start, end, chunk_days))
    total = len(chunks)
    logger.info(
        "%s: %d chunks of %d days  (%s to %s)",
        connector_name, total, chunk_days, start, end,
    )

    ok = 0
    failed = []

    for i, (chunk_start, chunk_end) in enumerate(chunks, 1):
        logger.info(
            "%s chunk %d/%d: %s to %s",
            connector_name, i, total, chunk_start, chunk_end,
        )
        try:
            func(chunk_start, chunk_end)
            ok += 1
        except Exception as exc:
            logger.error(
                "%s chunk %d/%d FAILED (%s to %s): %s",
                connector_name, i, total, chunk_start, chunk_end, exc,
                exc_info=True,
            )
            failed.append((chunk_start, chunk_end, str(exc)))

        if i < total:
            logger.debug("%s: pausing %.1fs before next chunk", connector_name, pause_s)
            time.sleep(pause_s)

    return {"ok": ok, "failed": failed, "total": total}


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    vault_uri = os.environ.get("AZURE_KEYVAULT_URI")
    if not vault_uri:
        logger.error("AZURE_KEYVAULT_URI is not set — aborting")
        sys.exit(1)

    parser = argparse.ArgumentParser(description="Historical data backfill runner")
    parser.add_argument(
        "--connector",
        help="Run only this connector (shopify, klaviyo, amazon, amazon_ads, meta, ga4, gsc, clarity, google_ads)",
    )
    parser.add_argument(
        "--start",
        help="Override earliest start date (YYYY-MM-DD). Default: per-connector maximum.",
    )
    parser.add_argument(
        "--since",
        type=int,
        metavar="DAYS",
        help="Override earliest start date as a day count back from today "
             "(e.g. --since 95 for the Amazon Ads reporting retention window). "
             "Relative form of --start; the two are mutually exclusive.",
    )
    args = parser.parse_args()

    if args.start and args.since is not None:
        logger.error("--start and --since are mutually exclusive; pass one or the other")
        sys.exit(1)
    if args.since is not None and args.since < 1:
        logger.error("--since must be a positive number of days (got %s)", args.since)
        sys.exit(1)

    logger.info("Vault  : %s", vault_uri)
    logger.info("Run at : %s", date.today().isoformat())
    if args.connector:
        logger.info("Filter : --connector %s", args.connector)
    if args.start:
        logger.info("Start  : --start %s (overrides per-connector default)", args.start)
    if args.since is not None:
        logger.info(
            "Start  : --since %d days -> %s (overrides per-connector default)",
            args.since, (date.today() - timedelta(days=args.since)).isoformat(),
        )

    # Import connectors after path setup
    from connectors.scheduler.jobs import (
        shopify, meta_ads, klaviyo, amazon_sp_api, amazon_advertising,
        google_analytics, google_search_console,
        microsoft_clarity, google_ads,
    )

    today = date.today()

    # ── Connector configuration ────────────────────────────────────────────────
    #
    # mode       : "single"  — one call, connector paginates (Shopify, Klaviyo)
    #              "chunked" — iterate date windows (analytics connectors)
    # earliest   : how far back to request (APIs return empty for pre-launch dates)
    # chunk_days : days per API request (chunked mode only)
    # pause_s    : sleep between chunks (rate-limit headroom)
    #
    connectors = [
        {
            "name": "Shopify",
            "key": "shopify",
            "mode": "single",
            "earliest": date(2019, 1, 1),   # Fetch everything; API paginates
            "func": shopify.run_backfill,
        },
        {
            "name": "Klaviyo",
            "key": "klaviyo",
            "mode": "single",
            "earliest": date(2019, 1, 1),
            "func": klaviyo.run_backfill,
        },
        {
            "name": "Amazon SP-API",
            "key": "amazon",
            "mode": "chunked",
            "earliest": today - timedelta(days=730),  # 2-year hard limit
            "chunk_days": 90,
            # SP-API: burst=10, refills at 0.0167 req/s (~60s per credit)
            # 90s pause gives enough headroom between multi-page chunks
            "pause_s": 90.0,
            "func": amazon_sp_api.run_backfill,
        },
        {
            "name": "Amazon Advertising",
            "key": "amazon_ads",
            "mode": "chunked",
            # Ads v3 reporting data is retained for ~95 days — requests for older
            # dates are accepted but come back empty, so the previous date(2022,1,1)
            # default queued ~44 chunks of which only the newest ~3 could ever
            # return rows. Default to the retention window; override with
            # --since / --start when Amazon confirms a wider window.
            "earliest": today - timedelta(days=ADS_RETENTION_DAYS),
            "chunk_days": 30,               # 30-day chunks: 4 report types x N profiles
                                             # per chunk; keep within API timeout budget
            # Ads Reporting API: 4 reports x N profiles per chunk; each report
            # takes ~20-60s to generate. 60s pause between chunks is conservative.
            "pause_s": 60.0,
            "func": amazon_advertising.run_backfill,
        },
        {
            "name": "Meta Ads",
            "key": "meta",
            "mode": "chunked",
            "earliest": today - timedelta(days=37 * 30),  # 37-month hard limit
            "chunk_days": 30,   # Smaller chunks; insights can be slow
            "pause_s": 3.0,
            "func": meta_ads.run_backfill,
        },
        {
            "name": "GA4",
            "key": "ga4",
            "mode": "chunked",
            "earliest": date(2022, 1, 1),   # GA4 property creation era; pre-launch dates return empty
            "chunk_days": 90,
            "pause_s": 2.0,
            "func": google_analytics.run_backfill,
        },
        {
            "name": "Google Search Console",
            "key": "gsc",
            "mode": "chunked",
            "earliest": today - timedelta(days=480),  # 16-month rolling window
            "chunk_days": 90,
            "pause_s": 2.0,
            "func": google_search_console.run_backfill,
        },
        {
            "name": "Microsoft Clarity",
            "key": "clarity",
            "mode": "chunked",
            "earliest": date(2021, 1, 1),
            "chunk_days": 90,
            "pause_s": 2.0,
            "func": microsoft_clarity.run_backfill,
        },
        {
            "name": "Google Ads",
            "key": "google_ads",
            "mode": "chunked",
            "earliest": date(2020, 1, 1),
            "chunk_days": 90,
            "pause_s": 5.0,
            "func": google_ads.run_backfill,
        },
    ]

    # Apply --connector filter
    if args.connector:
        # Capture the valid keys BEFORE filtering — reading them off the filtered
        # list always yielded an empty string and fell back to a hardcoded list
        # that was missing amazon_ads.
        valid_keys = ", ".join(c["key"] for c in connectors)
        connectors = [c for c in connectors if c["key"] == args.connector]
        if not connectors:
            logger.error("Unknown connector '%s'. Valid: %s", args.connector, valid_keys)
            sys.exit(1)

    # Apply --start / --since override (mutually exclusive, validated above)
    if args.start:
        start_override = date.fromisoformat(args.start)
    elif args.since is not None:
        start_override = today - timedelta(days=args.since)
    else:
        start_override = None

    results = []

    for config in connectors:
        print()
        print("=" * 60)
        print(f"BACKFILL: {config['name']}")
        print("=" * 60)

        earliest = start_override or config["earliest"]

        try:
            if config["mode"] == "single":
                result = run_single(config["name"], config["func"], earliest)
            else:
                result = run_chunked(
                    config["name"],
                    config["func"],
                    start=earliest,
                    end=today,
                    chunk_days=config["chunk_days"],
                    pause_s=config.get("pause_s", 2.0),
                )
        except Exception as exc:
            logger.error("%s backfill aborted: %s", config["name"], exc, exc_info=True)
            result = {"ok": 0, "failed": [("?", "?", str(exc))], "total": 0}

        result["name"] = config["name"]
        results.append(result)

    # ── Summary ───────────────────────────────────────────────────────────────
    print()
    print("=" * 60)
    print("BACKFILL SUMMARY")
    print("=" * 60)
    for r in results:
        if not r["failed"]:
            status = "OK"
        elif r["ok"] > 0:
            status = "PARTIAL"
        else:
            status = "FAIL"

        print(f"\n[{status:7s}]  {r['name']}  {r['ok']}/{r['total']} chunks ok")
        for chunk_start, chunk_end, err in r["failed"]:
            print(f"           FAILED {chunk_start} to {chunk_end}: {str(err)[:120]}")

    total_ok = sum(1 for r in results if not r["failed"])
    print()
    print(f"Result: {total_ok}/{len(results)} connectors fully complete")
    print("=" * 60)
    print()
    if any(r["failed"] for r in results):
        print("Tip: re-run with --connector <key> --start <YYYY-MM-DD> to retry failed chunks.")


if __name__ == "__main__":
    main()
