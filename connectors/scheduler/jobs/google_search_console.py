"""Google Search Console connector — search analytics sync.

Pulls clicks, impressions, CTR and position broken down by date, query and
page for the last 30 days. Credentials fetched from Azure Key Vault on every
run; access token refreshed from the stored refresh token each run.

Secrets required:
  google-oauth-client-id      — OAuth2 client ID (shared across Google connectors)
  google-oauth-client-secret  — OAuth2 client secret
  google-oauth-refresh-token  — OAuth2 refresh token (scopes: analytics.readonly + webmasters.readonly)
  gsc-property-url            — Verified property URL, e.g. https://doddl.com
"""

import logging
import uuid
from datetime import date, timedelta

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from connectors.lib.secrets import get_secrets
from connectors.lib.google_auth import refresh_access_token
from connectors.lib.db import write_raw, upsert_clean

logger = logging.getLogger(__name__)

VERSION = "1.0.0"
SOURCE = "google_search_console"
API_BASE = "https://searchconsole.googleapis.com/webmasters/v3"
ROW_LIMIT = 25_000  # Max per request


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    retry=retry_if_exception_type(httpx.HTTPStatusError),
    reraise=True,
)
def _post(client: httpx.Client, url: str, body: dict) -> dict:
    resp = client.post(url, json=body)
    resp.raise_for_status()
    return resp.json()


def run() -> None:
    pull_id = str(uuid.uuid4())
    logger.info("google_search_console.run start pull_id=%s", pull_id)

    creds = get_secrets([
        "google-oauth-client-id",
        "google-oauth-client-secret",
        "google-oauth-refresh-token",
        "gsc-property-url",
    ])
    access_token = refresh_access_token(
        creds["google-oauth-client-id"],
        creds["google-oauth-client-secret"],
        creds["google-oauth-refresh-token"],
    )
    site_url = creds["gsc-property-url"]

    with httpx.Client(
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=60.0,
    ) as client:
        _sync_search_analytics(client, pull_id, site_url)
    logger.info("google_search_console.run complete pull_id=%s", pull_id)


def _sync_search_analytics(
    client: httpx.Client, pull_id: str, site_url: str,
    start_date=None, end_date=None,
) -> None:
    if end_date is None:
        end_date = date.today() - timedelta(days=3)   # GSC data lags ~3 days
    if start_date is None:
        start_date = end_date - timedelta(days=30)

    url = f"{API_BASE}/sites/{site_url.replace('/', '%2F')}/searchAnalytics/query"
    body = {
        "startDate": start_date.isoformat(),
        "endDate": end_date.isoformat(),
        "dimensions": ["date", "query", "page", "device", "country"],
        "rowLimit": ROW_LIMIT,
        "startRow": 0,
    }

    count = 0
    while True:
        data = _post(client, url, body)
        rows = data.get("rows", [])
        if not rows:
            break

        write_raw(
            source=SOURCE, pull_id=pull_id,
            endpoint="searchAnalytics/query",
            response_body={"rows": rows, "count": len(rows), "startRow": body["startRow"]},
            response_status=200, connector_version=VERSION,
        )

        for row in rows:
            keys = row.get("keys", [])
            record = {
                "date": keys[0] if len(keys) > 0 else None,
                "query": keys[1] if len(keys) > 1 else None,
                "page": keys[2] if len(keys) > 2 else None,
                "device": keys[3] if len(keys) > 3 else None,
                "country": keys[4] if len(keys) > 4 else None,
                "clicks": row.get("clicks"),
                "impressions": row.get("impressions"),
                "ctr": row.get("ctr"),
                "position": row.get("position"),
            }
            record_id = f"{record['date']}|{record['query']}|{record['page']}|{record['device']}|{record['country']}"
            upsert_clean(
                source=SOURCE, record_type="search_analytics",
                source_record_id=record_id, data=record, pull_id=pull_id,
            )
            count += 1

        if len(rows) < ROW_LIMIT:
            break
        body["startRow"] += ROW_LIMIT

    logger.info("google_search_console: %d rows synced pull_id=%s", count, pull_id)


# ---------------------------------------------------------------------------
# Backfill entry point
# ---------------------------------------------------------------------------

def run_backfill(start_date, end_date) -> None:
    """Pull search analytics for the specified date range.

    GSC hard limit: 16 months rolling. Caller must not request dates
    older than ~480 days. GSC data lags ~3 days so end_date should be
    at least 3 days ago.
    """
    pull_id = str(uuid.uuid4())
    logger.info("google_search_console.run_backfill %s to %s pull_id=%s", start_date, end_date, pull_id)

    creds = get_secrets([
        "google-oauth-client-id",
        "google-oauth-client-secret",
        "google-oauth-refresh-token",
        "gsc-property-url",
    ])
    access_token = refresh_access_token(
        creds["google-oauth-client-id"],
        creds["google-oauth-client-secret"],
        creds["google-oauth-refresh-token"],
    )
    site_url = creds["gsc-property-url"]

    with httpx.Client(
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=60.0,
    ) as client:
        _sync_search_analytics(client, pull_id, site_url, start_date, end_date)
    logger.info("google_search_console.run_backfill complete pull_id=%s", pull_id)
