"""Google Analytics 4 connector — traffic and engagement sync.

Pulls sessions, users, pageviews and key engagement metrics broken down by
date, page path, device category and session source for the last 30 days.
Access token refreshed from stored refresh token on every run.

Secrets required:
  google-oauth-client-id      — OAuth2 client ID (shared across Google connectors)
  google-oauth-client-secret  — OAuth2 client secret
  google-oauth-refresh-token  — OAuth2 refresh token (scopes: analytics.readonly + webmasters.readonly)
  ga4-property-id             — GA4 property ID (digits only, e.g. 123456789)
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
SOURCE = "google_analytics"
API_BASE = "https://analyticsdata.googleapis.com/v1beta"


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
    logger.info("google_analytics.run start pull_id=%s", pull_id)

    creds = get_secrets([
        "google-oauth-client-id",
        "google-oauth-client-secret",
        "google-oauth-refresh-token",
        "ga4-property-id",
    ])
    access_token = refresh_access_token(
        creds["google-oauth-client-id"],
        creds["google-oauth-client-secret"],
        creds["google-oauth-refresh-token"],
    )
    property_id = creds["ga4-property-id"]

    with httpx.Client(
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=60.0,
    ) as client:
        _sync_traffic(client, pull_id, property_id)
        _sync_pages(client, pull_id, property_id)
    logger.info("google_analytics.run complete pull_id=%s", pull_id)


# ---------------------------------------------------------------------------
# Backfill entry point
# ---------------------------------------------------------------------------

def run_backfill(start_date, end_date) -> None:
    """Pull traffic and page data for the specified date range."""
    pull_id = str(uuid.uuid4())
    logger.info("google_analytics.run_backfill %s to %s pull_id=%s", start_date, end_date, pull_id)

    creds = get_secrets([
        "google-oauth-client-id",
        "google-oauth-client-secret",
        "google-oauth-refresh-token",
        "ga4-property-id",
    ])
    access_token = refresh_access_token(
        creds["google-oauth-client-id"],
        creds["google-oauth-client-secret"],
        creds["google-oauth-refresh-token"],
    )
    property_id = creds["ga4-property-id"]
    dr = {"startDate": start_date.isoformat(), "endDate": end_date.isoformat()}

    with httpx.Client(
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=60.0,
    ) as client:
        _sync_traffic(client, pull_id, property_id, date_range=dr)
        _sync_pages(client, pull_id, property_id, date_range=dr)
    logger.info("google_analytics.run_backfill complete pull_id=%s", pull_id)


def _build_date_range() -> dict:
    end = date.today() - timedelta(days=1)
    start = end - timedelta(days=30)
    return {"startDate": start.isoformat(), "endDate": end.isoformat()}


def _sync_traffic(
    client: httpx.Client, pull_id: str, property_id: str,
    date_range: dict | None = None,
) -> None:
    """Sync sessions, users and engagement by date + device + source."""
    url = f"{API_BASE}/properties/{property_id}:runReport"
    offset = 0
    limit = 10_000
    count = 0
    dr = date_range or _build_date_range()

    while True:
        body = {
            "dateRanges": [dr],
            "dimensions": [
                {"name": "date"},
                {"name": "deviceCategory"},
                {"name": "sessionDefaultChannelGroup"},
            ],
            "metrics": [
                {"name": "sessions"},
                {"name": "totalUsers"},
                {"name": "newUsers"},
                {"name": "bounceRate"},
                {"name": "averageSessionDuration"},
                {"name": "conversions"},
            ],
            "limit": limit,
            "offset": offset,
        }
        data = _post(client, url, body)
        rows = data.get("rows", [])
        if not rows:
            break

        dim_headers = [h["name"] for h in data.get("dimensionHeaders", [])]
        met_headers = [h["name"] for h in data.get("metricHeaders", [])]

        records = []
        for row in rows:
            record = {}
            for i, dv in enumerate(row.get("dimensionValues", [])):
                record[dim_headers[i]] = dv["value"]
            for i, mv in enumerate(row.get("metricValues", [])):
                record[met_headers[i]] = mv["value"]
            records.append(record)

        write_raw(
            source=SOURCE, pull_id=pull_id, endpoint="runReport/traffic",
            response_body={"rows": records, "count": len(records)},
            response_status=200, connector_version=VERSION,
        )
        for record in records:
            record_id = f"{record.get('date')}|{record.get('deviceCategory')}|{record.get('sessionDefaultChannelGroup')}"
            upsert_clean(
                source=SOURCE, record_type="traffic",
                source_record_id=record_id, data=record, pull_id=pull_id,
            )
            count += 1

        if len(rows) < limit:
            break
        offset += limit

    logger.info("google_analytics: %d traffic rows synced pull_id=%s", count, pull_id)


def _sync_pages(
    client: httpx.Client, pull_id: str, property_id: str,
    date_range: dict | None = None,
) -> None:
    """Sync top pages by sessions for the specified date range."""
    url = f"{API_BASE}/properties/{property_id}:runReport"
    dr = date_range or _build_date_range()
    body = {
        "dateRanges": [dr],
        "dimensions": [{"name": "date"}, {"name": "pagePath"}],
        "metrics": [
            {"name": "sessions"},
            {"name": "screenPageViews"},
            {"name": "averageSessionDuration"},
            {"name": "bounceRate"},
        ],
        "limit": 10_000,
    }
    data = _post(client, url, body)
    rows = data.get("rows", [])

    dim_headers = [h["name"] for h in data.get("dimensionHeaders", [])]
    met_headers = [h["name"] for h in data.get("metricHeaders", [])]

    records = []
    for row in rows:
        record = {}
        for i, dv in enumerate(row.get("dimensionValues", [])):
            record[dim_headers[i]] = dv["value"]
        for i, mv in enumerate(row.get("metricValues", [])):
            record[met_headers[i]] = mv["value"]
        records.append(record)

    write_raw(
        source=SOURCE, pull_id=pull_id, endpoint="runReport/pages",
        response_body={"rows": records, "count": len(records)},
        response_status=200, connector_version=VERSION,
    )
    for record in records:
        record_id = f"{record.get('date')}|{record.get('pagePath')}"
        upsert_clean(
            source=SOURCE, record_type="page",
            source_record_id=record_id, data=record, pull_id=pull_id,
        )
    logger.info("google_analytics: %d page rows synced pull_id=%s", len(records), pull_id)
