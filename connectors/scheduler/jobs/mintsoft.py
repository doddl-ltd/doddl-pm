"""Mintsoft connector — orders, stock and despatch sync.

Pulls warehouse orders, current stock levels and despatch records from the
Mintsoft WMS API. Incremental for orders and despatches; stock is a full
snapshot on every run.

Secrets required:
  mintsoft-api-key  — Mintsoft API key (Settings → API Keys in Mintsoft portal)
"""

import logging
import uuid
from datetime import datetime, timezone, timedelta
from typing import Iterator

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from connectors.lib.secrets import get_secret
from connectors.lib.db import write_raw, upsert_clean, last_pull_ts

logger = logging.getLogger(__name__)

VERSION = "1.0.0"
SOURCE = "mintsoft"
API_BASE = "https://api.mintsoft.co.uk/api"
PAGE_SIZE = 250


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    retry=retry_if_exception_type(httpx.HTTPStatusError),
    reraise=True,
)
def _get(client: httpx.Client, path: str, params: dict | None = None) -> dict | list:
    resp = client.get(f"{API_BASE}{path}", params=params)
    resp.raise_for_status()
    return resp.json()


def _paginate(client: httpx.Client, path: str, params: dict) -> Iterator[list]:
    """Yield pages using Mintsoft page-number pagination."""
    page = 1
    while True:
        data = _get(client, path, {**params, "pageSize": PAGE_SIZE, "page": page})
        items = data if isinstance(data, list) else data.get("Items", data.get("results", []))
        if not items:
            break
        yield items
        if len(items) < PAGE_SIZE:
            break
        page += 1


def run() -> None:
    pull_id = str(uuid.uuid4())
    logger.info("mintsoft.run start pull_id=%s", pull_id)

    api_key = get_secret("mintsoft-api-key")
    since = last_pull_ts(SOURCE) or (
        datetime.now(timezone.utc) - timedelta(days=90)
    ).isoformat()

    with httpx.Client(
        headers={
            "ApiKey": api_key,
            "Accept": "application/json",
        },
        timeout=30.0,
    ) as client:
        _sync_orders(client, pull_id, since)
        _sync_stock(client, pull_id)
        _sync_despatches(client, pull_id, since)
    logger.info("mintsoft.run complete pull_id=%s", pull_id)


def _sync_orders(
    client: httpx.Client, pull_id: str, since: str
) -> None:
    params = {"updatedFrom": since, "orderBy": "UpdatedDate", "orderDirection": "ASC"}
    count = 0
    for page in _paginate(client, "/Order/GetOrders", params):
        write_raw(
            source=SOURCE, pull_id=pull_id, endpoint="/Order/GetOrders",
            response_body={"orders": page, "count": len(page)},
            response_status=200, connector_version=VERSION,
        )
        for order in page:
            order_id = str(order.get("OrderId") or order.get("Id") or order.get("id"))
            upsert_clean(
                source=SOURCE, record_type="order",
                source_record_id=order_id, data=order, pull_id=pull_id,
            )
            count += 1
    logger.info("mintsoft: %d orders synced pull_id=%s", count, pull_id)


def _sync_stock(client: httpx.Client, pull_id: str) -> None:
    """Full stock snapshot — Mintsoft does not support incremental stock."""
    params: dict = {}
    count = 0
    for page in _paginate(client, "/Stock/GetStockLevels", params):
        write_raw(
            source=SOURCE, pull_id=pull_id, endpoint="/Stock/GetStockLevels",
            response_body={"stock": page, "count": len(page)},
            response_status=200, connector_version=VERSION,
        )
        for item in page:
            sku = str(item.get("Sku") or item.get("SKU") or item.get("ProductCode", "unknown"))
            upsert_clean(
                source=SOURCE, record_type="stock_level",
                source_record_id=sku, data=item, pull_id=pull_id,
            )
            count += 1
    logger.info("mintsoft: %d stock lines synced pull_id=%s", count, pull_id)


def _sync_despatches(
    client: httpx.Client, pull_id: str, since: str
) -> None:
    params = {"despatchedFrom": since, "orderBy": "DespatchDate", "orderDirection": "ASC"}
    count = 0
    for page in _paginate(client, "/Despatch/GetDespatches", params):
        write_raw(
            source=SOURCE, pull_id=pull_id, endpoint="/Despatch/GetDespatches",
            response_body={"despatches": page, "count": len(page)},
            response_status=200, connector_version=VERSION,
        )
        for despatch in page:
            despatch_id = str(
                despatch.get("DespatchId") or despatch.get("Id") or despatch.get("id")
            )
            upsert_clean(
                source=SOURCE, record_type="despatch",
                source_record_id=despatch_id, data=despatch, pull_id=pull_id,
            )
            count += 1
    logger.info("mintsoft: %d despatches synced pull_id=%s", count, pull_id)
