"""Klaviyo connector — campaigns and flows sync.

Pulls campaign metadata and flow definitions. Credentials fetched from
Azure Key Vault on every run so rotation takes effect without a restart.

Klaviyo API notes:
  - campaigns endpoint requires equals(messages.channel,'email') filter
  - page[size] is NOT a valid param for campaigns (cursor pagination only)
  - URL params with brackets must NOT be percent-encoded; we use
    urllib.parse.urlencode(..., safe="[](),") to preserve them

Secrets required:
  klaviyo-api-key  — Klaviyo private API key (pk_...)
"""

import logging
import urllib.parse
import uuid
from datetime import datetime, timezone, timedelta
from typing import Iterator

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from connectors.lib.secrets import get_secret
from connectors.lib.db import write_raw, upsert_clean, last_pull_ts

logger = logging.getLogger(__name__)

VERSION = "1.0.0"
SOURCE = "klaviyo"
BASE_URL = "https://a.klaviyo.com"
REVISION = "2024-02-15"


def _auth_headers(api_key: str) -> dict:
    return {
        "Authorization": f"Klaviyo-API-Key {api_key}",
        "revision": REVISION,
        "Accept": "application/json",
    }


def _build_url(path: str, params: dict) -> str:
    """Build a Klaviyo API URL preserving [] brackets (not percent-encoded)."""
    qs = urllib.parse.urlencode(params, safe="[](),")
    return f"{BASE_URL}{path}?{qs}"


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    retry=retry_if_exception_type(httpx.HTTPStatusError),
    reraise=True,
)
def _get_url(client: httpx.Client, url: str) -> dict:
    resp = client.get(url)
    resp.raise_for_status()
    return resp.json()


def _paginate(client: httpx.Client, initial_url: str) -> Iterator[dict]:
    """Yield every page from a Klaviyo cursor-paginated endpoint."""
    url = initial_url
    while url:
        page = _get_url(client, url)
        yield page
        url = page.get("links", {}).get("next")


def run() -> None:
    pull_id = str(uuid.uuid4())
    logger.info("klaviyo.run start pull_id=%s", pull_id)

    api_key = get_secret("klaviyo-api-key")
    # Klaviyo filter timestamps: ISO 8601 without microseconds, no tz offset
    _since_raw = last_pull_ts(SOURCE) or (
        (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
    )
    since = _since_raw[:19]  # e.g. "2026-02-07T09:39:00"

    with httpx.Client(headers=_auth_headers(api_key), timeout=30.0) as client:
        _sync_campaigns(client, pull_id, since)
        _sync_flows(client, pull_id)
    logger.info("klaviyo.run complete pull_id=%s", pull_id)


def _sync_campaigns(client: httpx.Client, pull_id: str, since: str) -> None:
    # campaigns endpoint requires messages.channel filter; page[size] not supported
    url = _build_url("/api/campaigns/", {
        "filter": f"and(equals(messages.channel,'email'),greater-or-equal(updated_at,{since}))",
        "fields[campaign]": "name,status,send_time,archived,created_at,updated_at",
    })
    count = 0
    for page in _paginate(client, url):
        write_raw(
            source=SOURCE, pull_id=pull_id, endpoint="/api/campaigns/",
            response_body=page, response_status=200, connector_version=VERSION,
        )
        for item in page.get("data", []):
            upsert_clean(
                source=SOURCE, record_type="campaign",
                source_record_id=item["id"],
                data={"id": item["id"], **item.get("attributes", {})},
                pull_id=pull_id,
            )
            count += 1
    logger.info("klaviyo: %d campaigns synced pull_id=%s", count, pull_id)


def _sync_flows(client: httpx.Client, pull_id: str) -> None:
    # Flows: pull all on every run (low volume; date filter requires matching sort)
    url = _build_url("/api/flows/", {
        "fields[flow]": "name,status,created,updated,trigger_type",
    })
    count = 0
    for page in _paginate(client, url):
        write_raw(
            source=SOURCE, pull_id=pull_id, endpoint="/api/flows/",
            response_body=page, response_status=200, connector_version=VERSION,
        )
        for item in page.get("data", []):
            upsert_clean(
                source=SOURCE, record_type="flow",
                source_record_id=item["id"],
                data={"id": item["id"], **item.get("attributes", {})},
                pull_id=pull_id,
            )
            count += 1
    logger.info("klaviyo: %d flows synced pull_id=%s", count, pull_id)


# ---------------------------------------------------------------------------
# Backfill entry point
# ---------------------------------------------------------------------------

def run_backfill(start_date) -> None:
    """Pull all campaigns updated on or after start_date, plus all flows.

    Klaviyo cursor pagination is handled internally.
    """
    pull_id = str(uuid.uuid4())
    since = start_date.strftime("%Y-%m-%dT00:00:00")
    logger.info("klaviyo.run_backfill since=%s pull_id=%s", since, pull_id)

    api_key = get_secret("klaviyo-api-key")
    with httpx.Client(headers=_auth_headers(api_key), timeout=60.0) as client:
        _sync_campaigns(client, pull_id, since)
        _sync_flows(client, pull_id)
    logger.info("klaviyo.run_backfill complete pull_id=%s", pull_id)
