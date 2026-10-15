"""
Staging connector pull runner.

Runs one immediate pull for each specified connector, captures timing,
and reports rows written to api_raw and api_clean.

Usage:
    python scripts/run_staging_pull.py

Set AZURE_KEYVAULT_URI before running.
"""

import sys
import os
import logging
import time
from datetime import datetime

# Ensure repo root is on sys.path so 'connectors' package is importable
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

# ── Logging setup — capture connector log output ──────────────────────────────

class RowCounter(logging.Handler):
    """Capture log records so we can extract row counts from connector logs."""
    def __init__(self):
        super().__init__()
        self.records = []

    def emit(self, record):
        self.records.append(record.getMessage())


counter = RowCounter()
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
    handlers=[logging.StreamHandler(sys.stdout), counter],
)
# Silence Azure SDK per-request HTTP logs (fire once per DB write — very noisy)
logging.getLogger("azure").setLevel(logging.WARNING)
logging.getLogger("azure.core.pipeline.policies.http_logging_policy").setLevel(logging.WARNING)
logger = logging.getLogger("runner")


def run_connector(name: str, module) -> dict:
    """Run one connector pull and return timing + result summary."""
    logger.info("=" * 60)
    logger.info("STARTING: %s", name)
    logger.info("=" * 60)
    start = time.perf_counter()
    result = {"connector": name, "status": "unknown", "error": None, "elapsed_s": 0}

    # Capture log lines from this connector
    before = len(counter.records)
    try:
        module.run()
        result["status"] = "ok"
    except Exception as exc:
        result["status"] = "error"
        result["error"] = str(exc)
        logger.error("%s FAILED: %s", name, exc, exc_info=True)

    result["elapsed_s"] = round(time.perf_counter() - start, 1)
    result["log_lines"] = counter.records[before:]
    return result


def extract_counts(log_lines: list[str]) -> str:
    """Pull any 'N X synced' lines from connector logs."""
    synced = [l for l in log_lines if "synced" in l.lower() or "complete" in l.lower()]
    return "\n    ".join(synced) if synced else "(no count lines)"


def main():
    vault_uri = os.environ.get("AZURE_KEYVAULT_URI")
    if not vault_uri:
        logger.error("AZURE_KEYVAULT_URI is not set — aborting")
        sys.exit(1)

    logger.info("Vault: %s", vault_uri)
    logger.info("Run started: %s", datetime.utcnow().isoformat())

    # Import connectors AFTER path is set up
    from connectors.scheduler.jobs import shopify, meta_ads, klaviyo, amazon_sp_api, google_analytics, google_search_console, microsoft_clarity, google_ads

    connectors_to_run = [
        ("Shopify", shopify),
        ("Meta Ads", meta_ads),
        ("Klaviyo", klaviyo),
        ("Amazon SP-API", amazon_sp_api),
        ("GA4", google_analytics),
        ("Google Search Console", google_search_console),
        ("Microsoft Clarity", microsoft_clarity),
        ("Google Ads", google_ads),
    ]

    results = []
    for name, module in connectors_to_run:
        results.append(run_connector(name, module))

    # ── Summary ───────────────────────────────────────────────────────────────
    print("\n")
    print("=" * 60)
    print("PULL SUMMARY")
    print("=" * 60)
    for r in results:
        status_icon = "OK" if r["status"] == "ok" else "FAIL"
        print(f"\n[{status_icon}]  {r['connector']}  [{r['elapsed_s']}s]  status={r['status']}")
        if r["error"]:
            print(f"   ERROR: {r['error']}")
        print(f"   {extract_counts(r['log_lines'])}")
    print("\n" + "=" * 60)
    total_ok = sum(1 for r in results if r["status"] == "ok")
    print(f"Result: {total_ok}/{len(results)} connectors completed successfully")
    print("=" * 60)


if __name__ == "__main__":
    main()
