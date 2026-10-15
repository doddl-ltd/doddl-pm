"""Opinew connector — product reviews sync.

Pulls all product reviews from Opinew (Shopify review platform).
Incremental by created_at. Credentials fetched from Azure Key Vault on every run.

Secrets required:
  opinew-api-key   — Opinew API key (Settings → API in Opinew dashboard)
  opinew-shop-id   — Opinew shop ID (numeric, visible in dashboard URL)
"""

import logging
import uuid
from datetime import datetime, timezone, timedelta
from typing import Iterator

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from connectors.lib.secrets import get_secrets
from connectors.lib.db import write_raw, upsert_clean, last_pull_ts

logger = logging.getLogger(__name__)

VERSION = "1.0.0"
SOURCE = "opinew"
API_BASE = "https://app.opinew.com/api/v3"
PAGE_SIZE = 100


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    retry=retry_if_exception_type(httpx.HTTPStatusError),
    reraise=True,
)
def _get(client: httpx.Client, path: str, params: dict | None = None) -> dict:
    resp = client.get(f"{API_BASE}{path}", params=params)
    resp.raise_for_status()
    return resp.json()


def _paginate(client: httpx.Client, path: str, params: dict) -> Iterator[list]:
    """Yield pages of reviews using offset pagination."""
    offset = 0
    while True:
        data = _get(client, path, {**params, "limit": PAGE_SIZE, "offset": offset})
        items = data.get("reviews", data.get("results", []))
        if not items:
            break
        yield items
        if len(items) < PAGE_SIZE:
            break
        offset += PAGE_SIZE


def run() -> None:
    pull_id = str(uuid.uuid4())
    logger.info("opinew.run start pull_id=%s", pull_id)

    creds = get_secrets(["opinew-api-key", "opinew-shop-id"])
    api_key = creds["opinew-api-key"]
    shop_id = creds["opinew-shop-id"]

    since = last_pull_ts(SOURCE) or (
        datetime.now(timezone.utc) - timedelta(days=90)
    ).isoformat()

    with httpx.Client(
        headers={
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
        },
        timeout=30.0,
    ) as client:
        _sync_reviews(client, pull_id, shop_id, since)
    logger.info("opinew.run complete pull_id=%s", pull_id)


def _sync_reviews(
    client: httpx.Client, pull_id: str, shop_id: str, since: str
) -> None:
    params = {
        "shop_id": shop_id,
        "created_at_min": since,
        "order": "created_at_asc",
    }
    count = 0
    for page in _paginate(client, "/reviews", params):
        write_raw(
            source=SOURCE, pull_id=pull_id, endpoint="/reviews",
            response_body={"reviews": page, "count": len(page)},
            response_status=200, connector_version=VERSION,
        )
        for review in page:
            upsert_clean(
                source=SOURCE, record_type="review",
                source_record_id=str(review["id"]),
                data=review, pull_id=pull_id,
            )
            count += 1
    logger.info("opinew: %d reviews synced pull_id=%s", count, pull_id)
