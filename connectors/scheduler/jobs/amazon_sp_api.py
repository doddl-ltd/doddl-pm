"""Amazon SP-API connector — orders, FBA inventory, and listings across all doddl marketplaces.

Covers every marketplace visible in the doddl Amazon Seller Central account,
grouped by seller account (each has its own LWA refresh token):

  EU account  — sellingpartnerapi-eu.amazon.com  seller A95LVHANDHOSF
    UK  A1F83G8C2ARO7P      DE  A1PA6795UKMFR9      FR  A13V1IB3VIYZZH
    IT  APJ6JRA9NG5V4       ES  A1RKKUPIHCS9HS      NL  A1805IZSGTT6HS
    BE  AMEN7PMS3EDWL       PL  A1C3SOZRARQ6R3      SE  A2NODRKZP88ZB9
    TR  A33AVAJ2PDY3EV      IE  A28R8C7NBKEWEA
    AE  A2VIGQ35RCS4UG      SA  A17E79C6D8DWNP

  NA account  — sellingpartnerapi-na.amazon.com   seller A2J3OJ1QMMOAR5
    US  ATVPDKIKX0DER       CA  A2EUQ1WTGCTBG2      MX  A1AM78C64UM0Y8

  FE-JP account — sellingpartnerapi-fe.amazon.com  seller A3HUZ3EE07Z6DX
    JP  A1VC38T7YXB528

  FE-AU account — sellingpartnerapi-fe.amazon.com  seller A1LAIASXD1QDDB
    AU  A39IBJ37TRP1C6

  FE-SG account — sellingpartnerapi-fe.amazon.com  seller A3N8BDRT3JKMZ7
    SG  A19VAU5U5O7RUS

Each account requires its own LWA refresh token (SP-API authorization is per seller).
Accounts whose refresh token secret is absent are silently skipped — add the secret
to Key Vault to enable that account, no code change needed.

Secrets required:
  amazon-sp-api-client-id          — LWA client ID (shared across all accounts)
  amazon-sp-api-client-secret      — LWA client secret (shared across all accounts)
  amazon-sp-api-refresh-token-eu   — EU account
  amazon-sp-api-refresh-token      — (legacy alias for EU — used if -eu absent)
  amazon-sp-api-refresh-token-na-2 — NA account (US, CA, MX — single seller A2J3OJ1QMMOAR5)
  amazon-sp-api-refresh-token-fe-jp — FE Japan account
  amazon-sp-api-refresh-token-fe-au — FE Australia account
  amazon-sp-api-refresh-token-fe-sg — FE Singapore account

Data pulled per marketplace:
  order         — /orders/v0/orders (all statuses, cursor-paginated)
  fba_inventory — /fba/inventory/v1/summaries (current FBA stock snapshot)
  listing       — /listings/2021-08-01/items/{sellerId} (active SKUs)

marketplace_id is stored in the data field of every api_clean record.
Seller IDs (merchant tokens) are embedded in this file; they are not secret.
"""

import csv
import gzip
import io
import json
import logging
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta, date
from typing import Iterator, Optional

import httpx
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
)

from connectors.lib.secrets import get_secret, get_secrets
from connectors.lib.db import write_raw, upsert_clean_batch, last_pull_ts, upsert_table, select_rows
# Paging helpers for the catalog-rank target query: select_rows has no offset
# parameter and amazon_asin_daily holds tens of thousands of rows in 90 days.
from connectors.lib.db import SUPABASE_URL as _DB_URL, _headers as _db_headers, _key as _db_key

logger = logging.getLogger(__name__)

VERSION = "3.0.0"
SOURCE = "amazon_sp"
LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token"

# ---------------------------------------------------------------------------
# Account and marketplace configuration
#
# Each top-level key is a "seller account" — a distinct Amazon seller identity
# with its own LWA refresh token. Multiple accounts can share an API endpoint.
#
# Marketplace tuple: (amazon_marketplace_id, display_name, merchant_token)
#   amazon_marketplace_id — passed to MarketplaceIds param and stored on every record
#   display_name          — human-readable label for logs
#   merchant_token        — seller ID used for the Listings Items API
# ---------------------------------------------------------------------------

ACCOUNTS: dict[str, dict] = {
    # ── UK + Middle East ─────────────────────────────────────────────────────
    # Corrected 2026-08-25: this used to claim ONE unified EU account (seller
    # A95LVHANDHOSF) covered all 13 markets below. It doesn't — DE/FR/NL/PL/
    # BE/IT/ES/IE/SE actually belong to a second, separate seller account
    # (Doddl Europe, A1TR5EU9D7ZMRC — see "EU-2" below) that this app's token
    # was never authorised against. The old token is only valid for UK.
    # Evidence: run_sales_traffic_backfill returned status='ok' with zero
    # rows for those 9 markets across the entire backfilled range — a valid
    # token against the wrong seller account produces exactly that signature
    # (200 OK, no data), indistinguishable from a real zero without knowing
    # the account structure. TR/AE/SA left here provisionally — which seller
    # account they actually belong to is NOT yet confirmed either, so they're
    # paused in ACTIVE_MARKETPLACES below rather than assumed.
    "EU": {
        "endpoint": "https://sellingpartnerapi-eu.amazon.com",
        "refresh_token_secret": "amazon-sp-api-refresh-token-eu",
        "refresh_token_fallback": "amazon-sp-api-refresh-token",  # legacy compat
        "marketplaces": [
            ("A1F83G8C2ARO7P", "UK", "A95LVHANDHOSF"),
            ("A33AVAJ2PDY3EV", "TR", "A95LVHANDHOSF"),  # unconfirmed account — see comment above
            # Middle East — uses EU endpoint
            ("A2VIGQ35RCS4UG", "AE", "A95LVHANDHOSF"),  # unconfirmed account — see comment above
            ("A17E79C6D8DWNP", "SA", "A95LVHANDHOSF"),  # unconfirmed account — see comment above
        ],
    },

    # ── Europe (Doddl Europe) ────────────────────────────────────────────────
    # Added 2026-08-25. Seller A1TR5EU9D7ZMRC — a distinct Amazon seller
    # identity from the UK account above, confirmed by Jon from the account
    # structure itself (not derivable from our data — a wrong-account token
    # still returns 200 OK with zero rows, see the EU comment above).
    # refresh_token_secret does not exist in Key Vault yet: this account is
    # inert (skipped, same as FE-JP before its credentials existed) until
    # scripts/amazon_sp_oauth.py --account eu-2 is run against the Doddl
    # Europe Seller Central login.
    "EU-2": {
        "endpoint": "https://sellingpartnerapi-eu.amazon.com",
        "refresh_token_secret": "amazon-sp-api-refresh-token-eu-2",
        "marketplaces": [
            ("A1PA6795UKMFR9", "DE", "A1TR5EU9D7ZMRC"),
            ("A13V1IB3VIYZZH", "FR", "A1TR5EU9D7ZMRC"),
            ("APJ6JRA9NG5V4",  "IT", "A1TR5EU9D7ZMRC"),
            ("A1RKKUPIHCS9HS", "ES", "A1TR5EU9D7ZMRC"),
            ("A1805IZSGTT6HS", "NL", "A1TR5EU9D7ZMRC"),
            ("AMEN7PMS3EDWL",  "BE", "A1TR5EU9D7ZMRC"),
            ("A1C3SOZRARQ6R3", "PL", "A1TR5EU9D7ZMRC"),
            ("A2NODRKZP88ZB9", "SE", "A1TR5EU9D7ZMRC"),
            ("A28R8C7NBKEWEA", "IE", "A1TR5EU9D7ZMRC"),
        ],
    },

    # ── North America — US, CA, MX all share seller A2J3OJ1QMMOAR5 ──────────
    # One token covers all three marketplaces.
    # Secret: amazon-sp-api-refresh-token-na-2 (already stored in Key Vault).
    "NA": {
        "endpoint": "https://sellingpartnerapi-na.amazon.com",
        "refresh_token_secret": "amazon-sp-api-refresh-token-na-2",
        "marketplaces": [
            ("ATVPDKIKX0DER",  "US", "A2J3OJ1QMMOAR5"),
            ("A2EUQ1WTGCTBG2", "CA", "A2J3OJ1QMMOAR5"),
            ("A1AM78C64UM0Y8", "MX", "A2J3OJ1QMMOAR5"),
        ],
    },

    # ── Far East — separate seller accounts per marketplace ────────────────
    # Each FE marketplace is a distinct seller account with its own token.
    "FE-JP": {
        "endpoint": "https://sellingpartnerapi-fe.amazon.com",
        "refresh_token_secret": "amazon-sp-api-refresh-token-fe-jp",
        "refresh_token_fallback": "amazon-sp-api-refresh-token-fe",  # single-FE compat
        "marketplaces": [
            ("A1VC38T7YXB528", "JP", "A3HUZ3EE07Z6DX"),
        ],
    },
    "FE-AU": {
        "endpoint": "https://sellingpartnerapi-fe.amazon.com",
        "refresh_token_secret": "amazon-sp-api-refresh-token-fe-au",
        "marketplaces": [
            ("A39IBJ37TRP1C6", "AU", "A1LAIASXD1QDDB"),
        ],
    },
    "FE-SG": {
        "endpoint": "https://sellingpartnerapi-fe.amazon.com",
        "refresh_token_secret": "amazon-sp-api-refresh-token-fe-sg",
        "marketplaces": [
            ("A19VAU5U5O7RUS", "SG", "A3N8BDRT3JKMZ7"),
        ],
    },
}

# SP-API rate limits (per endpoint; accounts on the same endpoint share the bucket)
_ORDERS_RATE,    _ORDERS_BURST    = 0.0167, 10   # 1 req/60s restore, burst 10
_INVENTORY_RATE, _INVENTORY_BURST = 2.0,    2    # 2 req/s, burst 2
_LISTINGS_RATE,  _LISTINGS_BURST  = 5.0,    10   # 5 req/s, burst 10


# ---------------------------------------------------------------------------
# Rate limiter
# ---------------------------------------------------------------------------

class _RateLimiter:
    """Thread-safe token bucket rate limiter.

    Each seller account on each endpoint gets its own instance so accounts
    that share an endpoint (NA and NA-2) do not steal each other's budget.
    """

    def __init__(self, rate_per_second: float, burst: int) -> None:
        self._rate = rate_per_second
        self._burst = float(burst)
        self._tokens = float(burst)      # Start full — spend the burst allowance first
        self._last = time.monotonic()
        self._lock = threading.Lock()

    def acquire(self) -> None:
        with self._lock:
            now = time.monotonic()
            self._tokens = min(
                self._burst,
                self._tokens + (now - self._last) * self._rate,
            )
            self._last = now
            if self._tokens >= 1.0:
                self._tokens -= 1.0
                return
            wait = (1.0 - self._tokens) / self._rate

        time.sleep(wait)
        with self._lock:
            self._tokens = max(0.0, self._tokens - 1.0)


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

def _get_access_token(client_id: str, client_secret: str, refresh_token: str) -> str:
    """Exchange LWA refresh token for a short-lived access token (~1h TTL)."""
    resp = httpx.post(
        LWA_TOKEN_URL,
        data={
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": client_id,
            "client_secret": client_secret,
        },
        timeout=15.0,
    )
    resp.raise_for_status()
    token = resp.json().get("access_token")
    if not token:
        raise ValueError(f"No access_token in LWA response: {resp.json()}")
    return token


def _load_account_token(
    account_name: str,
    account_cfg: dict,
    client_id: str,
    client_secret: str,
) -> Optional[str]:
    """Fetch the refresh token for a seller account and exchange it for an access token.

    Returns None if no refresh token secret is configured — that account is skipped.
    """
    refresh_token: Optional[str] = None

    try:
        refresh_token = get_secret(account_cfg["refresh_token_secret"])
    except Exception:
        pass

    if refresh_token is None and "refresh_token_fallback" in account_cfg:
        try:
            refresh_token = get_secret(account_cfg["refresh_token_fallback"])
            logger.info("amazon_sp: %s account using fallback refresh token secret", account_name)
        except Exception:
            pass

    if refresh_token is None:
        logger.info(
            "amazon_sp: %s account not configured "
            "(add %s to Key Vault to enable)",
            account_name, account_cfg["refresh_token_secret"],
        )
        return None

    try:
        token = _get_access_token(client_id, client_secret, refresh_token)
        logger.info("amazon_sp: %s account LWA token obtained", account_name)
        return token
    except Exception as exc:
        logger.warning("amazon_sp: %s account auth failed — %s", account_name, exc)
        return None


def _get_access_token_full(client_id: str, client_secret: str, refresh_token: str) -> dict:
    """Same LWA exchange as _get_access_token, but returns the full parsed
    response (access_token + expires_in) instead of just the token string.

    Added for _TokenHolder (rev 3), which tracks real expiry instead of an
    assumed elapsed-time margin. _get_access_token itself is untouched —
    existing run()/run_backfill() callers are unaffected.
    """
    resp = httpx.post(
        LWA_TOKEN_URL,
        data={
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": client_id,
            "client_secret": client_secret,
        },
        timeout=15.0,
    )
    resp.raise_for_status()
    body = resp.json()
    if not body.get("access_token"):
        raise ValueError(f"No access_token in LWA response: {body}")
    return body


def _load_account_token_with_expiry(
    account_name: str,
    account_cfg: dict,
    client_id: str,
    client_secret: str,
) -> Optional[dict]:
    """Same refresh-token lookup and fallback as _load_account_token, but
    returns the full LWA response (access_token + expires_in) via
    _get_access_token_full. Used only by the Reports API section (rev 3);
    _load_account_token itself is untouched.
    """
    refresh_token: Optional[str] = None

    try:
        refresh_token = get_secret(account_cfg["refresh_token_secret"])
    except Exception:
        pass

    if refresh_token is None and "refresh_token_fallback" in account_cfg:
        try:
            refresh_token = get_secret(account_cfg["refresh_token_fallback"])
            logger.info("amazon_sp: %s account using fallback refresh token secret", account_name)
        except Exception:
            pass

    if refresh_token is None:
        logger.info(
            "amazon_sp: %s account not configured "
            "(add %s to Key Vault to enable)",
            account_name, account_cfg["refresh_token_secret"],
        )
        return None

    try:
        body = _get_access_token_full(client_id, client_secret, refresh_token)
        logger.info(
            "amazon_sp: %s account LWA token obtained (expires_in=%s)",
            account_name, body.get("expires_in"),
        )
        return body
    except Exception as exc:
        logger.warning("amazon_sp: %s account auth failed — %s", account_name, exc)
        return None


# ---------------------------------------------------------------------------
# HTTP helper
# ---------------------------------------------------------------------------

@retry(
    stop=stop_after_attempt(4),
    wait=wait_exponential(multiplier=2, min=5, max=60),
    retry=retry_if_exception_type(httpx.HTTPStatusError),
    reraise=True,
)
def _get(
    client: httpx.Client,
    url: str,
    params: dict,
    rl: Optional[_RateLimiter] = None,
) -> dict:
    """GET with optional pre-request rate limiting and automatic 429 retry."""
    if rl:
        rl.acquire()
    resp = client.get(url, params=params)
    if resp.status_code == 429:
        wait_s = float(resp.headers.get("x-amzn-RateLimit-Limit", "60"))
        logger.warning("amazon_sp: 429 on %s — backing off %.0fs", url, wait_s)
        time.sleep(wait_s)
        raise httpx.HTTPStatusError("Rate limited", request=resp.request, response=resp)
    if not resp.is_success:
        logger.error("amazon_sp: HTTP %s for %s: %s", resp.status_code, url, resp.text[:300])
    resp.raise_for_status()
    return resp.json()


# ---------------------------------------------------------------------------
# Orders sync
# ---------------------------------------------------------------------------

def _paginate_orders(
    client: httpx.Client,
    base_url: str,
    marketplace_id: str,
    params: dict,
    rl: _RateLimiter,
) -> Iterator[dict]:
    """Yield order pages following NextToken cursor."""
    url = f"{base_url}/orders/v0/orders"
    page = _get(client, url, params, rl)
    yield page
    while True:
        next_token = page.get("payload", {}).get("NextToken")
        if not next_token:
            break
        page = _get(client, url, {
            "MarketplaceIds": marketplace_id,
            "NextToken": next_token,
        }, rl)
        yield page


def _sync_orders(
    client: httpx.Client,
    base_url: str,
    marketplace_id: str,
    marketplace_name: str,
    pull_id: str,
    rl: _RateLimiter,
    since: str,
    until: Optional[str] = None,
) -> int:
    params: dict = {
        "MarketplaceIds": marketplace_id,
        "LastUpdatedAfter": since,
        "MaxResultsPerPage": 100,
    }
    if until:
        params["LastUpdatedBefore"] = until

    count = 0
    for page in _paginate_orders(client, base_url, marketplace_id, params, rl):
        orders = page.get("payload", {}).get("Orders", [])
        write_raw(
            source=SOURCE, pull_id=pull_id,
            endpoint=f"/orders/v0/orders/{marketplace_id}",
            response_body={**page, "marketplace_id": marketplace_id},
            response_status=200, connector_version=VERSION,
        )
        batch = [
            {
                "source": SOURCE,
                "record_type": "order",
                "source_record_id": order["AmazonOrderId"],   # globally unique
                "data": {
                    **order,
                    "marketplace_id": marketplace_id,
                    "marketplace_name": marketplace_name,
                },
                "last_pull_id": pull_id,
            }
            for order in orders
        ]
        upsert_clean_batch(batch)
        count += len(batch)

    logger.info(
        "amazon_sp: orders  marketplace=%s (%s) count=%d",
        marketplace_id, marketplace_name, count,
    )
    return count


# ---------------------------------------------------------------------------
# FBA inventory sync
# ---------------------------------------------------------------------------

def _paginate_inventory(
    client: httpx.Client,
    base_url: str,
    marketplace_id: str,
    rl: _RateLimiter,
) -> Iterator[dict]:
    """Yield FBA inventory summary pages following nextToken cursor."""
    url = f"{base_url}/fba/inventory/v1/summaries"
    base_params: dict = {
        "details": "true",
        "granularityType": "Marketplace",
        "granularityId": marketplace_id,
        "marketplaceIds": marketplace_id,
    }
    page = _get(client, url, base_params, rl)
    yield page
    while True:
        next_token = page.get("pagination", {}).get("nextToken")
        if not next_token:
            break
        page = _get(client, url, {**base_params, "nextToken": next_token}, rl)
        yield page


def _sync_inventory(
    client: httpx.Client,
    base_url: str,
    marketplace_id: str,
    marketplace_name: str,
    pull_id: str,
    rl: _RateLimiter,
) -> int:
    """Pull current FBA inventory snapshot for one marketplace."""
    count = 0
    try:
        for page in _paginate_inventory(client, base_url, marketplace_id, rl):
            summaries = page.get("payload", {}).get("inventorySummaries", [])
            write_raw(
                source=SOURCE, pull_id=pull_id,
                endpoint=f"/fba/inventory/v1/summaries/{marketplace_id}",
                response_body={**page, "marketplace_id": marketplace_id},
                response_status=200, connector_version=VERSION,
            )
            batch: list = []
            for s in summaries:
                sku_key = s.get("fnSku") or s.get("asin") or s.get("sellerSku", "unknown")
                batch.append({
                    "source": SOURCE,
                    "record_type": "fba_inventory",
                    "source_record_id": f"{marketplace_id}_{sku_key}",
                    "data": {
                        **s,
                        "marketplace_id": marketplace_id,
                        "marketplace_name": marketplace_name,
                    },
                    "last_pull_id": pull_id,
                })
                if len(batch) >= 500:
                    upsert_clean_batch(batch)
                    count += len(batch)
                    batch = []
            if batch:
                upsert_clean_batch(batch)
                count += len(batch)

    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 400:
            logger.info(
                "amazon_sp: FBA inventory not available for marketplace=%s (%s)",
                marketplace_id, marketplace_name,
            )
        else:
            logger.warning(
                "amazon_sp: inventory error marketplace=%s HTTP %s",
                marketplace_id, exc.response.status_code,
            )
        return 0

    if count:
        logger.info(
            "amazon_sp: inventory marketplace=%s (%s) count=%d",
            marketplace_id, marketplace_name, count,
        )
    return count


# ---------------------------------------------------------------------------
# Listings sync (Listings Items API v2021-08-01)
# ---------------------------------------------------------------------------

def _paginate_listings(
    client: httpx.Client,
    base_url: str,
    seller_id: str,
    marketplace_id: str,
    rl: _RateLimiter,
) -> Iterator[dict]:
    """Yield listing item pages following nextToken cursor."""
    url = f"{base_url}/listings/2021-08-01/items/{seller_id}"
    base_params: dict = {
        "marketplaceIds": marketplace_id,
        "pageSize": 10,
        "includedData": "summaries,attributes,offers,fulfillmentAvailability",
    }
    page = _get(client, url, base_params, rl)
    yield page
    while True:
        next_token = page.get("pagination", {}).get("nextToken")
        if not next_token:
            break
        page = _get(client, url, {**base_params, "pageToken": next_token}, rl)
        yield page


def _sync_listings(
    client: httpx.Client,
    base_url: str,
    seller_id: str,
    marketplace_id: str,
    marketplace_name: str,
    pull_id: str,
    rl: _RateLimiter,
) -> int:
    count = 0
    skipped = 0
    try:
        for page in _paginate_listings(client, base_url, seller_id, marketplace_id, rl):
            items = page.get("items", [])
            write_raw(
                source=SOURCE, pull_id=pull_id,
                endpoint=f"/listings/2021-08-01/items/{marketplace_id}",
                response_body={**page, "marketplace_id": marketplace_id},
                response_status=200, connector_version=VERSION,
            )
            batch = []
            for item in items:
                sku = item.get("sku")
                if not sku:
                    # Fixed 2026-08-17 (rev 3): this used to fall back to the
                    # literal string "unknown", which collapsed every SKU-less
                    # item in a marketplace into one row that overwrote itself
                    # on each subsequent item — silent data loss that looked
                    # like a successful upsert. Skip and count instead.
                    logger.warning(
                        "amazon_sp: listings marketplace=%s: item without sku, skipping: asin=%s",
                        marketplace_id, item.get("asin"),
                    )
                    skipped += 1
                    continue
                batch.append({
                    "source": SOURCE,
                    "record_type": "listing",
                    "source_record_id": f"{marketplace_id}_{sku}",
                    "data": {
                        **item,
                        "marketplace_id": marketplace_id,
                        "marketplace_name": marketplace_name,
                    },
                    "last_pull_id": pull_id,
                })
            if batch:
                upsert_clean_batch(batch)
            count += len(batch)

    except httpx.HTTPStatusError as exc:
        logger.warning(
            "amazon_sp: listings error marketplace=%s HTTP %s",
            marketplace_id, exc.response.status_code,
        )
        return 0

    if count:
        logger.info(
            "amazon_sp: listings  marketplace=%s (%s) count=%d",
            marketplace_id, marketplace_name, count,
        )
    if skipped:
        logger.warning(
            "amazon_sp: listings marketplace=%s (%s) skipped=%d item(s) with no sku — investigate if this is ever non-zero",
            marketplace_id, marketplace_name, skipped,
        )
    return count


# ---------------------------------------------------------------------------
# Per-marketplace orchestration
# ---------------------------------------------------------------------------

def _sync_marketplace(
    client: httpx.Client,
    base_url: str,
    marketplace_id: str,
    marketplace_name: str,
    seller_id: str,
    pull_id: str,
    *,
    orders_rl: _RateLimiter,
    inventory_rl: _RateLimiter,
    listings_rl: _RateLimiter,
    since: str,
    until: Optional[str] = None,
    include_inventory: bool = True,
    include_listings: bool = True,
) -> None:
    logger.info(
        "amazon_sp: marketplace=%s (%s) since=%s",
        marketplace_id, marketplace_name, since,
    )
    _sync_orders(
        client, base_url, marketplace_id, marketplace_name,
        pull_id, orders_rl, since, until,
    )
    if include_inventory:
        _sync_inventory(
            client, base_url, marketplace_id, marketplace_name, pull_id, inventory_rl,
        )
    if include_listings:
        _sync_listings(
            client, base_url, seller_id, marketplace_id, marketplace_name,
            pull_id, listings_rl,
        )


# ---------------------------------------------------------------------------
# Per-account orchestration
# ---------------------------------------------------------------------------

def _sync_account(
    account_name: str,
    account_cfg: dict,
    access_token: str,
    pull_id: str,
    since: str,
    until: Optional[str] = None,
    include_inventory: bool = True,
    include_listings: bool = True,
) -> None:
    """Process all marketplaces under one seller account."""
    base_url = account_cfg["endpoint"]
    headers = {
        "x-amz-access-token": access_token,
        "Accept": "application/json",
    }
    # Each account gets independent rate limiters
    orders_rl    = _RateLimiter(_ORDERS_RATE,    _ORDERS_BURST)
    inventory_rl = _RateLimiter(_INVENTORY_RATE, _INVENTORY_BURST)
    listings_rl  = _RateLimiter(_LISTINGS_RATE,  _LISTINGS_BURST)

    with httpx.Client(headers=headers, timeout=30.0) as client:
        for marketplace_id, marketplace_name, seller_id in account_cfg["marketplaces"]:
            try:
                _sync_marketplace(
                    client, base_url, marketplace_id, marketplace_name, seller_id,
                    pull_id,
                    orders_rl=orders_rl,
                    inventory_rl=inventory_rl,
                    listings_rl=listings_rl,
                    since=since,
                    until=until,
                    include_inventory=include_inventory,
                    include_listings=include_listings,
                )
            except Exception as exc:
                logger.error(
                    "amazon_sp: marketplace=%s (%s) FAILED: %s",
                    marketplace_id, marketplace_name, exc, exc_info=True,
                )

    logger.info("amazon_sp: %s account complete pull_id=%s", account_name, pull_id)


# ---------------------------------------------------------------------------
# Entry points
# ---------------------------------------------------------------------------

def run() -> None:
    """Incremental sync: orders, FBA inventory, and listings for all accounts.

    Loads tokens for whichever accounts are configured in Key Vault, then runs
    all active accounts in parallel (each has its own access token and rate limits).
    """
    pull_id = str(uuid.uuid4())
    logger.info("amazon_sp.run start pull_id=%s", pull_id)

    creds = get_secrets([
        "amazon-sp-api-client-id",
        "amazon-sp-api-client-secret",
    ])
    client_id     = creds["amazon-sp-api-client-id"]
    client_secret = creds["amazon-sp-api-client-secret"]

    # Build access tokens for every account that has a refresh token configured
    active: dict[str, str] = {}   # account_name -> access_token
    for account_name, account_cfg in ACCOUNTS.items():
        token = _load_account_token(account_name, account_cfg, client_id, client_secret)
        if token:
            active[account_name] = token

    if not active:
        logger.error("amazon_sp: no accounts accessible — add refresh token secrets to Key Vault")
        return

    _since_raw = last_pull_ts(SOURCE) or (
        datetime.now(timezone.utc) - timedelta(days=90)
    ).isoformat()
    since = datetime.fromisoformat(
        _since_raw.replace("Z", "+00:00")
    ).strftime("%Y-%m-%dT%H:%M:%SZ")

    logger.info(
        "amazon_sp: %d/%d accounts active since=%s pull_id=%s",
        len(active), len(ACCOUNTS), since, pull_id,
    )

    # Accounts are independent — run in parallel
    with ThreadPoolExecutor(
        max_workers=len(active),
        thread_name_prefix="amazon_sp",
    ) as executor:
        futures = {
            executor.submit(
                _sync_account,
                account_name, ACCOUNTS[account_name], token, pull_id, since,
                include_inventory=True, include_listings=True,
            ): account_name
            for account_name, token in active.items()
        }
        for future in as_completed(futures):
            account_name = futures[future]
            try:
                future.result()
            except Exception as exc:
                logger.error(
                    "amazon_sp: %s account FAILED: %s", account_name, exc, exc_info=True,
                )

    logger.info("amazon_sp.run complete pull_id=%s", pull_id)


def run_backfill(start_date, end_date) -> None:
    """Pull orders for all configured accounts within the given date range.

    Accounts run sequentially to stay well within rate limits during long
    backfill sessions. Inventory and listings are skipped — they are current
    state only, not historical data.
    """
    pull_id = str(uuid.uuid4())

    since = datetime(
        start_date.year, start_date.month, start_date.day, tzinfo=timezone.utc,
    ).strftime("%Y-%m-%dT%H:%M:%SZ")

    # SP-API: LastUpdatedBefore must be at least 2 minutes in the past
    until_dt = min(
        datetime(
            end_date.year, end_date.month, end_date.day,
            23, 59, 59, tzinfo=timezone.utc,
        ),
        datetime.now(timezone.utc) - timedelta(minutes=5),
    )
    until = until_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    logger.info("amazon_sp.run_backfill %s to %s pull_id=%s", since, until, pull_id)

    creds = get_secrets([
        "amazon-sp-api-client-id",
        "amazon-sp-api-client-secret",
    ])
    client_id     = creds["amazon-sp-api-client-id"]
    client_secret = creds["amazon-sp-api-client-secret"]

    for account_name, account_cfg in ACCOUNTS.items():
        token = _load_account_token(account_name, account_cfg, client_id, client_secret)
        if token is None:
            continue
        try:
            _sync_account(
                account_name, account_cfg, token, pull_id, since, until,
                include_inventory=False,   # point-in-time only
                include_listings=False,
            )
        except Exception as exc:
            logger.error(
                "amazon_sp: %s account backfill FAILED: %s", account_name, exc, exc_info=True,
            )

    logger.info("amazon_sp.run_backfill complete pull_id=%s", pull_id)


# ═══════════════════════════════════════════════════════════════════════════
# Reports API (v2021-06-30) — added alongside the above, does not modify it.
#
# Covers three report types not available through getOrders:
#   GET_MERCHANT_LISTINGS_ALL_DATA                          -> run_listings()
#   GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL      -> run_order_items()
#   GET_SALES_AND_TRAFFIC_REPORT                             -> run_sales_traffic_nightly()
#                                                               run_sales_traffic_backfill()
#
# None of these are registered in scheduler.py yet — call manually or via the
# dry-run CLI at the bottom of this file. See reports/amazon-reports-api.md.
# ═══════════════════════════════════════════════════════════════════════════

# ---------------------------------------------------------------------------
# Reports API rate limits
#
# Confirmed 2026-08-17 from the official SP-API OpenAPI model
# (github.com/amzn/selling-partner-api-models, reports-api-model/reports_2021-06-30.json)
# — these three numbers are source-verified. The date-range/retention constants
# further down are NOT verified the same way; see the comments on each and
# reports/amazon-reports-api.md.
# ---------------------------------------------------------------------------
_REPORTS_CREATE_RATE,   _REPORTS_CREATE_BURST   = 0.0167, 15   # createReport:      1 req/60s, burst 15
_REPORTS_POLL_RATE,     _REPORTS_POLL_BURST     = 2.0,    15   # getReport:         2 req/s,   burst 15
_REPORTS_DOCUMENT_RATE, _REPORTS_DOCUMENT_BURST = 0.0167, 15   # getReportDocument: 1 req/60s, burst 15

_REPORT_TERMINAL_STATUSES = {"DONE", "CANCELLED", "FATAL"}
_REPORT_POLL_INITIAL_DELAY_S = 10.0
_REPORT_POLL_MAX_DELAY_S = 120.0
_REPORT_POLL_MAX_WAIT_S = 30 * 60   # give up after 30 minutes of IN_QUEUE / IN_PROGRESS

# ---------------------------------------------------------------------------
# Configurable date-range/retention limits — moved here (top of the Reports
# API section) so they're easy to find and edit in one place.
#
# _ORDER_ITEMS_CHUNK_DAYS is a STARTING POINT, not a hard wall, and remains
# UNVERIFIED (developer-docs.amazon.com and a GitHub docs mirror were both
# unreachable this session, no live credentials to test against either — see
# reports/amazon-reports-api.md): run_order_items() halves a chunk and retries
# if Amazon rejects it as too wide (_create_report_adaptive below), so the
# real limit is discovered at runtime instead of assumed.
#
# _SALES_TRAFFIC_RETENTION_DAYS is CONFIRMED (2026-08-25), not a guess.
# Evidence: amazon_asin_daily_status rows with status='parse_failed',
# reason='missing_salesAndTrafficByAsin_key' were cross-checked against their
# raw api_raw response — every one carries processingStatus=CANCELLED and an
# empty report body, never a differently-shaped payload. Checked the exact
# day-gap (api_raw.received_at date minus the requested report_date) across
# UK, US and Poland independently: day 730 back always succeeds, day 731
# always comes back CANCELLED, no drift between marketplaces, no exceptions
# across 151 distinct (marketplace, day) cases. This is a hard wall on
# Amazon's side, not ours — see _fetch_sales_traffic_day, which now skips a
# date past this wall before calling Amazon at all.
# ---------------------------------------------------------------------------
_ORDER_ITEMS_CHUNK_DAYS = 30        # UNVERIFIED — commonly cited for BY_ORDER_DATE flat-file reports
_SALES_TRAFFIC_RETENTION_DAYS = 730 # CONFIRMED 2026-08-25 — see header comment above. Dates past this
                                     # wall are skipped before calling Amazon (see
                                     # _fetch_sales_traffic_day) rather than wasting a createReport call
                                     # on a request that cannot succeed.

# ---------------------------------------------------------------------------
# Sales & traffic finalisation lag — added 2026-09-22 after a three-week silent
# data loss. ROOT CAUSE, for anyone tempted to tighten these back up:
#
# run_sales_traffic_nightly originally pulled YESTERDAY (lag 1 day). Amazon has
# not finalised salesAndTrafficByAsin or the traffic metrics that soon: the
# report comes back processingStatus=DONE with salesAndTrafficByAsin == [] and
# trafficByDate.sessions == 0, while salesByDate still carries partial,
# later-revised sales. _fetch_sales_traffic_day's empty-list branch then called
# _mark_fetched -> status 'ok', and _resume_skip_info skips 'ok' days forever,
# so the day was never re-fetched. A job reporting success wrote a permanent
# hole.
#
# Measured over 2026-08-31..2026-09-21, all 9 ACTIVE_MARKETPLACES: rows/day
# fell 99 -> 29 (-70%) and traffic vanished platform-wide (688 of 693 rows
# carried sessions before, 10 of 648 after). US/CA hit EXACTLY zero ASIN
# entries because the job fires at 03:30 UTC, which is 20:30 PDT the previous
# day — the US marketplace day had not even ended when we asked for it. EU
# marketplaces had just closed their day, so they kept partial rows, which is
# why nothing looked broken there.
#
# Re-requesting those same days later returned full data every time (e.g.
# 2026-09-20 US: 0 ASINs / 0 sessions as stored, 15 ASINs / 263 sessions on
# re-request), so nothing was ever lost on Amazon's side — we simply asked too
# early and then recorded the empty answer as final.
_SALES_TRAFFIC_LAG_DAYS = 2
# How far back the nightly job's newest target sits. D-2, matching what the
# Amazon Ads connector already does (commit 3db862c, "end its window at D-2").
# Lag 2 is CONFIRMED sufficient, not assumed: 2026-08-30 was fetched at lag 2
# by the 2026-09-01 backfill and came back complete (19 ASINs, 370 sessions),
# and a live re-request of 2026-09-20 at lag 2 returned 15 ASINs / 263
# sessions. Lag 1 is confirmed INSUFFICIENT by the whole incident above.

_SALES_TRAFFIC_FINALISATION_DAYS = 7
# Within this many days of today, an empty salesAndTrafficByAsin means "Amazon
# has not finalised this day yet", NOT "no sales" — see _fetch_sales_traffic_day,
# which marks it a retryable 'gap' instead of 'ok'. 7 rather than the
# confirmed-sufficient 2 deliberately: the cost of being wrong in one direction
# (a genuine zero-sales day gets re-requested a few times, ~1 report/day at the
# 1/60s createReport budget) is trivial next to the cost in the other direction
# (a permanent silent hole, which is what just cost three weeks of data). Small
# marketplaces like IE and NL do have genuine zero-sales days, so this is not a
# purely theoretical trade — it is just a cheap one.

_SALES_TRAFFIC_RETRY_WINDOW_DAYS = 10
# How far back run_sales_traffic_nightly sweeps for days that are not yet 'ok'.
# MUST stay strictly greater than _SALES_TRAFFIC_FINALISATION_DAYS, otherwise a
# day that went 'gap' on the finalisation rule above would age out of the sweep
# while still 'gap' and stay unresolved forever. The gap between the two (days
# 8-10) is where a still-empty day finally gets accepted as a genuine zero and
# marked 'ok'.

_MAX_ATTEMPTS = 3
# Sales & traffic backfill: a day marked 'parse_failed', or 'gap' for a REAL
# rejection (http_400), this many times stops being retried on resume and is
# logged as needing manual investigation instead. Fixed 2026-08-19: 'gap' from
# an exhausted-429-retries pass does NOT count toward this — a 429 is
# transient (measured 33-42% createReport rate, see
# reports/amazon-reports-api.md), not a defect in that day, so it must stay
# retryable indefinitely rather than getting silently abandoned partway
# through a long backfill. See amazon_asin_daily_status.attempts,
# _resume_skip_info, run_sales_traffic_backfill.

ACTIVE_MARKETPLACES: set[str] = {
    # Filled in 2026-08-17 per Jon: every marketplace_id in ACCOUNTS above
    # EXCEPT Mexico, Australia and Singapore. IDs copied directly from
    # ACCOUNTS, not from any external source. Filtering happens at the
    # iteration point in run_sales_traffic_nightly / run_sales_traffic_backfill
    # — not by removing entries from ACCOUNTS — so re-enabling a marketplace
    # later is one line here, no other code changes.
    #
    # Japan dropped 2026-08-19 (out of scope, not just untested) — the FE-JP
    # account has no working credentials (amazon-sp-api-refresh-token-fe-jp and
    # its fallback amazon-sp-api-refresh-token-fe both 404 in Key Vault,
    # confirmed live). Not a rate-limit finding, a configuration gap.
    #
    # TR, AE and SA paused 2026-08-25 (reduced 15 -> 12) — same reasoning as
    # DE/FR/NL/PL/BE/IT/ES/IE/SE being moved to ACCOUNTS["EU-2"]: which real
    # seller account these three belong to is NOT confirmed. Leaving them
    # active under the UK token would risk repeating exactly the silent
    # wrong-account-zero-rows problem just found for the other nine — a
    # valid token against the wrong seller returns 200 OK with no data,
    # indistinguishable from a genuine zero without knowing the account
    # structure. Re-enable once confirmed, same one-line pattern as JP above.
    #
    # BE, PL and SE dropped 2026-08-26 per Jon (reduced 12 -> 9) — out of
    # scope entirely, not paused pending confirmation like TR/AE/SA below.
    # doddl-reports' lib/marketplaces.js ALLOWED_MARKETPLACES dropped the same
    # three the same day — both codebases must agree or the reports drift from
    # the connector again. PL already has rows in amazon_asin_daily from
    # before this change; left in place, just no longer fetched or displayed.
    # Final scope: 9 marketplaces — UK + 6 EU-2 (pending their new token, see
    # ACCOUNTS["EU-2"]), 2 NA.

    # EU (7 of 13) — TR, AE, SA paused pending account confirmation;
    # BE, PL, SE dropped entirely 2026-08-26
    "A1F83G8C2ARO7P",  # UK
    "A1PA6795UKMFR9",  # DE
    "A13V1IB3VIYZZH",  # FR
    "APJ6JRA9NG5V4",   # IT
    "A1RKKUPIHCS9HS",  # ES
    "A1805IZSGTT6HS",  # NL
    "A28R8C7NBKEWEA",  # IE

    # NA (2 of 3) — MX excluded
    "ATVPDKIKX0DER",   # US
    "A2EUQ1WTGCTBG2",  # CA

    # paused 2026-08-25 — re-enable by uncommenting once it's confirmed which
    # seller account (UK A95LVHANDHOSF, Doddl Europe A1TR5EU9D7ZMRC, or a
    # third account) actually holds these
    # "A33AVAJ2PDY3EV",  # TR
    # "A2VIGQ35RCS4UG",  # AE
    # "A17E79C6D8DWNP",  # SA

    # dropped 2026-08-26 per Jon — out of scope entirely, not paused. IDs
    # taken from ACCOUNTS["EU-2"] above, which is untouched — re-enable by
    # uncommenting here, same one-line pattern as TR/AE/SA above, if ever
    # brought back into scope.
    # "AMEN7PMS3EDWL",   # BE
    # "A1C3SOZRARQ6R3",  # PL
    # "A2NODRKZP88ZB9",  # SE

    # out of scope 2026-08-19 — re-enable by uncommenting, once
    # amazon-sp-api-refresh-token-fe-jp exists in Key Vault
    # FE (0 of 3) — AU and SG excluded (never in scope); JP excluded (no credentials)
    # "A1VC38T7YXB528",  # JP
}

class AccountSkipped(Exception):
    """Raised by _TokenHolder.ensure_fresh when a token refresh is needed and
    fails. Callers should catch this per-account (see _run_reports_for_all_accounts
    and run_sales_traffic_backfill) so one bad account/expired-credential
    doesn't waste further calls on a token that will just fail again, while
    other accounts in the same run continue unaffected.
    """

    def __init__(self, account_name: str, reason: str) -> None:
        self.account_name = account_name
        self.reason = reason
        super().__init__(f"{account_name}: {reason}")


_TOKEN_MARGIN_S = 300   # refresh 5 minutes before the token's OWN reported expiry


class _TokenHolder:
    """Tracks one account's LWA access token using the token's own expires_in
    from Amazon — not an assumed elapsed-time margin.

    Fixed 2026-08-17 (rev 3): the previous version measured staleness from when
    the token was first loaded *in this process* (45 minutes, assuming ~1h TTL).
    A token that happened to already be partially aged when fetched (e.g.
    reused from a recent prior call, or Amazon issuing a shorter TTL than
    assumed) would be treated as fresh for a further 45 minutes here, then
    expire mid-run. Tracking the real expires_in removes that assumption.
    """

    def __init__(
        self, account_name: str, account_cfg: dict, client_id: str, client_secret: str, initial_token_body: dict,
    ) -> None:
        self._account_name = account_name
        self._account_cfg = account_cfg
        self._client_id = client_id
        self._client_secret = client_secret
        self.token: str = initial_token_body["access_token"]
        self._expires_at = self._compute_expiry(initial_token_body)

    @staticmethod
    def _compute_expiry(token_body: dict) -> Optional[float]:
        expires_in = token_body.get("expires_in")
        return time.time() + float(expires_in) if expires_in is not None else None

    def ensure_fresh(self, client: httpx.Client) -> None:
        """Call before every report request (each create/poll/download cycle).

        Raises AccountSkipped if a refresh is needed and fails — see the class
        docstring above for why this is fatal-for-this-account rather than a
        silent continue-with-stale-token: continuing on a token that just
        failed to refresh would most likely just fail again on the next real
        HTTP call, after already spending a createReport call to find out.
        """
        now = time.time()
        if self.token and self._expires_at and now < self._expires_at - _TOKEN_MARGIN_S:
            return
        logger.info(
            "amazon_sp: %s access token needs refresh (expires_at=%s) — refreshing before next report request",
            self._account_name, self._expires_at,
        )
        body = _load_account_token_with_expiry(
            self._account_name, self._account_cfg, self._client_id, self._client_secret,
        )
        if body is None:
            logger.error("amazon_sp: %s token refresh failed — skipping account", self._account_name)
            raise AccountSkipped(self._account_name, "token refresh failed")
        self.token = body["access_token"]
        self._expires_at = self._compute_expiry(body)
        client.headers["x-amz-access-token"] = self.token
        logger.info(
            "amazon_sp: %s access token refreshed, valid %ss", self._account_name, body.get("expires_in"),
        )


class ReportsRateLimiters:
    """One create/poll/document _RateLimiter triplet per seller account.

    Mirrors the existing per-account orders_rl/inventory_rl/listings_rl pattern in
    _sync_account: a fresh instance per account so accounts on the same Amazon
    endpoint don't share a budget. _RateLimiter itself needed no changes to support
    this — it was already generic, just instantiated per-endpoint before.
    """

    def __init__(self) -> None:
        self.create = _RateLimiter(_REPORTS_CREATE_RATE, _REPORTS_CREATE_BURST)
        self.poll = _RateLimiter(_REPORTS_POLL_RATE, _REPORTS_POLL_BURST)
        self.document = _RateLimiter(_REPORTS_DOCUMENT_RATE, _REPORTS_DOCUMENT_BURST)


def _create_report(
    client: httpx.Client,
    base_url: str,
    rl: ReportsRateLimiters,
    report_type: str,
    marketplace_ids: list[str],
    data_start_time: Optional[str] = None,
    data_end_time: Optional[str] = None,
    report_options: Optional[dict] = None,
) -> str:
    rl.create.acquire()
    body: dict = {"reportType": report_type, "marketplaceIds": marketplace_ids}
    if data_start_time:
        body["dataStartTime"] = data_start_time
    if data_end_time:
        body["dataEndTime"] = data_end_time
    if report_options:
        body["reportOptions"] = report_options
    resp = client.post(f"{base_url}/reports/2021-06-30/reports", json=body)
    resp.raise_for_status()
    report_id = resp.json()["reportId"]
    logger.info(
        "amazon_sp: report requested type=%s id=%s marketplaces=%s",
        report_type, report_id, marketplace_ids,
    )
    return report_id


def _poll_report(client: httpx.Client, base_url: str, rl: ReportsRateLimiters, report_id: str) -> dict:
    """Poll GET /reports/{reportId} until processingStatus is terminal.

    Exponential backoff from 10s up to a 120s cap, logging each status
    transition (not every poll). Gives up after 30 minutes total.
    """
    delay = _REPORT_POLL_INITIAL_DELAY_S
    waited = 0.0
    last_status: Optional[str] = None
    while True:
        rl.poll.acquire()
        resp = client.get(f"{base_url}/reports/2021-06-30/reports/{report_id}")
        resp.raise_for_status()
        body = resp.json()
        status = body.get("processingStatus")
        if status != last_status:
            logger.info("amazon_sp: report %s status=%s (waited %.0fs)", report_id, status, waited)
            last_status = status
        if status in _REPORT_TERMINAL_STATUSES:
            return body
        if waited >= _REPORT_POLL_MAX_WAIT_S:
            raise TimeoutError(f"amazon_sp: report {report_id} still {status} after {waited:.0f}s — giving up")
        time.sleep(delay)
        waited += delay
        delay = min(delay * 1.5, _REPORT_POLL_MAX_DELAY_S)


def _download_report_document(
    client: httpx.Client, base_url: str, rl: ReportsRateLimiters, report_document_id: str,
) -> tuple[bytes, dict]:
    """Fetch document metadata, then download from its pre-signed URL.

    The pre-signed URL is not an SP-API endpoint — no LWA token belongs on it —
    so it's fetched with a bare httpx.get, not the authenticated `client`.
    Decompresses GZIP when compressionAlgorithm says so.
    """
    rl.document.acquire()
    resp = client.get(f"{base_url}/reports/2021-06-30/documents/{report_document_id}")
    resp.raise_for_status()
    doc_meta = resp.json()
    download_resp = httpx.get(doc_meta["url"], timeout=120.0)
    download_resp.raise_for_status()
    raw = download_resp.content
    if doc_meta.get("compressionAlgorithm") == "GZIP":
        raw = gzip.decompress(raw)
    return raw, doc_meta


def _decode_report_bytes(raw: bytes) -> str:
    """Amazon flat-file reports are documented as cp1252-ish "ANSI"; some come
    back plain UTF-8 or UTF-8 with a BOM. Try in order rather than assuming.
    """
    for encoding in ("utf-8-sig", "utf-8", "cp1252"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("cp1252", errors="replace")


def _parse_tsv(text: str) -> list[dict]:
    """Parse a tab-separated flat file using its own header row — no hardcoded columns."""
    if not text.strip():
        return []
    reader = csv.DictReader(io.StringIO(text), delimiter="\t")
    return [dict(row) for row in reader]


def run_report_sync(
    client: httpx.Client,
    base_url: str,
    rl: ReportsRateLimiters,
    report_type: str,
    marketplace_ids: list[str],
    *,
    data_start_time: Optional[str] = None,
    data_end_time: Optional[str] = None,
    report_options: Optional[dict] = None,
    report_format: str = "tsv",
):
    """Create, poll, download and parse one report end-to-end.

    Returns (parsed, columns, status_body):
      report_format="tsv"  -> parsed is list[dict], one dict per row keyed by the
                               report's own header row; columns is that header list.
      report_format="json" -> parsed is the decoded JSON document (dict); columns is [].
    status_body is the final GET /reports/{reportId} response — returned even on
    CANCELLED/FATAL so callers can log or inspect it; parsed is [] / {} in that case.
    """
    report_id = _create_report(
        client, base_url, rl, report_type, marketplace_ids,
        data_start_time, data_end_time, report_options,
    )
    status_body = _poll_report(client, base_url, rl, report_id)
    status = status_body.get("processingStatus")
    if status != "DONE":
        logger.warning("amazon_sp: report %s ended %s (not DONE) — %s", report_id, status, status_body)
        return ([] if report_format == "tsv" else {}), [], status_body

    raw, _doc_meta = _download_report_document(client, base_url, rl, status_body["reportDocumentId"])
    text = _decode_report_bytes(raw)

    if report_format == "json":
        return json.loads(text), [], status_body

    rows = _parse_tsv(text)
    columns = list(rows[0].keys()) if rows else []
    return rows, columns, status_body


def _looks_like_range_too_wide(exc: httpx.HTTPStatusError) -> bool:
    """Heuristic only — NOT confirmed against a real Amazon error body this
    session (no live credentials, docs unreachable; see
    reports/amazon-reports-api.md). A 400 on createReport for a date-scoped
    report is most plausibly a date-range validation error, but if Amazon's
    actual reason is something else (bad marketplace ID, malformed
    reportOptions, etc.) this will misfire and treat an unrelated 400 as "too
    wide". Always logged loudly either way (see _create_report_adaptive), so a
    misfire is visible rather than silent.
    """
    resp = exc.response
    if resp is None or resp.status_code != 400:
        return False
    try:
        text = json.dumps(resp.json()).lower()
    except Exception:
        text = (resp.text or "").lower()
    keywords = ("date", "range", "too large", "too wide", "exceed", "period", "interval")
    return any(kw in text for kw in keywords)


def _create_report_adaptive(
    client: httpx.Client,
    base_url: str,
    rl: ReportsRateLimiters,
    token_holder: _TokenHolder,
    report_type: str,
    marketplace_ids: list[str],
    chunk_start: date,
    chunk_end: date,
    *,
    report_options: Optional[dict] = None,
    report_format: str = "tsv",
    min_days: int = 1,
):
    """Request one report for [chunk_start, chunk_end]. If Amazon rejects the
    range as too wide (per _looks_like_range_too_wide), halve it and retry each
    half, recursing down to min_days. Logs the accepted width once a sub-range
    succeeds, so the real limit gets discovered at runtime instead of assumed.
    Refreshes the account's access token first if it's getting stale.

    Yields (sub_start, sub_end, parsed, columns, status_body) for every
    sub-range actually requested. A failure for any reason other than "too
    wide" propagates as an exception rather than yielding.
    """
    token_holder.ensure_fresh(client)

    data_start = datetime(
        chunk_start.year, chunk_start.month, chunk_start.day, tzinfo=timezone.utc,
    ).strftime("%Y-%m-%dT%H:%M:%SZ")
    data_end_dt = min(
        datetime(chunk_end.year, chunk_end.month, chunk_end.day, 23, 59, 59, tzinfo=timezone.utc),
        datetime.now(timezone.utc) - timedelta(minutes=5),   # dataEndTime must be in the past
    )
    data_end = data_end_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    try:
        parsed, columns, status = run_report_sync(
            client, base_url, rl, report_type, marketplace_ids,
            data_start_time=data_start, data_end_time=data_end,
            report_options=report_options, report_format=report_format,
        )
        width = (chunk_end - chunk_start).days + 1
        logger.info(
            "amazon_sp: %s accepted width=%d day(s) (%s..%s)",
            report_type, width, chunk_start, chunk_end,
        )
        yield chunk_start, chunk_end, parsed, columns, status
    except httpx.HTTPStatusError as exc:
        span_days = (chunk_end - chunk_start).days + 1
        if span_days > min_days and _looks_like_range_too_wide(exc):
            mid = chunk_start + timedelta(days=max(span_days // 2 - 1, 0))
            logger.warning(
                "amazon_sp: %s rejected width=%d day(s) (%s..%s) status=%s — halving and retrying",
                report_type, span_days, chunk_start, chunk_end,
                exc.response.status_code if exc.response is not None else "?",
            )
            yield from _create_report_adaptive(
                client, base_url, rl, token_holder, report_type, marketplace_ids,
                chunk_start, mid,
                report_options=report_options, report_format=report_format, min_days=min_days,
            )
            yield from _create_report_adaptive(
                client, base_url, rl, token_holder, report_type, marketplace_ids,
                mid + timedelta(days=1), chunk_end,
                report_options=report_options, report_format=report_format, min_days=min_days,
            )
        else:
            raise


# ---------------------------------------------------------------------------
# Date-range chunking
# ---------------------------------------------------------------------------

def _chunk_date_range(start_date: date, end_date: date, max_days: int) -> list[tuple[date, date]]:
    """Split [start_date, end_date] (inclusive) into consecutive chunks of at most max_days days."""
    if start_date > end_date:
        raise ValueError(f"start_date {start_date} is after end_date {end_date}")
    chunks: list[tuple[date, date]] = []
    cur = start_date
    while cur <= end_date:
        chunk_end = min(cur + timedelta(days=max_days - 1), end_date)
        chunks.append((cur, chunk_end))
        cur = chunk_end + timedelta(days=1)
    return chunks


# ---------------------------------------------------------------------------
# Per-account orchestration shared by all three report entry points below
# ---------------------------------------------------------------------------

def _run_reports_for_all_accounts(
    pull_id: str, label: str, per_marketplace, *, marketplace_filter: Optional[set] = None,
) -> int:
    """Load tokens for every configured account, then call per_marketplace for
    every (account, marketplace) pair.

    marketplace_filter, if given, restricts iteration to marketplace_ids in
    that set — used by run_sales_traffic_nightly to scope to ACTIVE_MARKETPLACES
    without removing anything from ACCOUNTS. run_listings/run_order_items pass
    nothing and cover all configured marketplaces, unchanged.

    Accounts run in parallel (one thread each, mirroring run()'s ThreadPoolExecutor
    use — accounts are independent, each with its own token and rate-limit budget).
    Marketplaces within one account run sequentially, because they share that
    account's ReportsRateLimiters instance — same reasoning as the existing
    _sync_account, which loops its marketplaces in a plain for loop for the same
    per-account-shared-budget reason.

    per_marketplace(client, base_url, rl, marketplace_id, marketplace_name, account_name, token_holder) -> int (row count)
    Call token_holder.ensure_fresh(client) before each report request inside
    per_marketplace — see _TokenHolder above.
    """
    creds = get_secrets(["amazon-sp-api-client-id", "amazon-sp-api-client-secret"])
    client_id, client_secret = creds["amazon-sp-api-client-id"], creds["amazon-sp-api-client-secret"]

    active: dict[str, tuple[dict, dict]] = {}
    for account_name, account_cfg in ACCOUNTS.items():
        token_body = _load_account_token_with_expiry(account_name, account_cfg, client_id, client_secret)
        if token_body:
            active[account_name] = (account_cfg, token_body)

    if not active:
        logger.error("amazon_sp: %s — no accounts accessible (add refresh token secrets to Key Vault)", label)
        return 0

    def _run_account(account_name: str, account_cfg: dict, token_body: dict) -> int:
        base_url = account_cfg["endpoint"]
        headers = {"x-amz-access-token": token_body["access_token"], "Accept": "application/json"}
        rl = ReportsRateLimiters()
        token_holder = _TokenHolder(account_name, account_cfg, client_id, client_secret, token_body)
        count = 0
        with httpx.Client(headers=headers, timeout=60.0) as client:
            for marketplace_id, marketplace_name, _seller_id in account_cfg["marketplaces"]:
                if marketplace_filter is not None and marketplace_id not in marketplace_filter:
                    continue
                try:
                    count += per_marketplace(
                        client, base_url, rl, marketplace_id, marketplace_name, account_name, token_holder,
                    )
                except AccountSkipped as exc:
                    logger.error(
                        "amazon_sp: %s — %s — aborting remaining marketplaces for this account",
                        label, exc,
                    )
                    break
                except Exception as exc:
                    logger.error(
                        "amazon_sp: %s FAILED account=%s marketplace=%s (%s): %s",
                        label, account_name, marketplace_id, marketplace_name, exc, exc_info=True,
                    )
        return count

    total = 0
    with ThreadPoolExecutor(max_workers=len(active), thread_name_prefix=f"amazon_sp_{label}") as executor:
        futures = {
            executor.submit(_run_account, name, cfg, token_body): name
            for name, (cfg, token_body) in active.items()
        }
        for future in as_completed(futures):
            account_name = futures[future]
            try:
                total += future.result()
            except Exception as exc:
                logger.error("amazon_sp: %s account=%s FAILED: %s", label, account_name, exc, exc_info=True)

    return total


# ---------------------------------------------------------------------------
# 3a. GET_MERCHANT_LISTINGS_ALL_DATA -> record_type "listing"
#
# Current-snapshot report, no date range. Requested one marketplace at a time
# (not all 13 EU marketplaces in one call) because the flat file has no
# marketplace-id column of its own to key off — same reason _sync_listings
# above loops marketplaces individually and stamps marketplace_id on afterward.
#
# source_record_id = f"{marketplace_id}_{seller_sku}" — underscore-separated,
# matching the EXISTING Listings-Items-API-sourced 'listing' rows written by
# _sync_listings above. Corrected 2026-08-17 — the original colon-separated
# spec was wrong and would have produced two rows per real listing (one per
# source). Same format, same record_type='listing' -> both sources now upsert
# into the SAME row per real listing, whichever ran most recently wins
# (merge-duplicates), matching upsert_clean_batch's
# (source, record_type, source_record_id) unique key.
#
# _sync_listings itself was also fixed the same day: it used to fall back to
# the literal string "unknown" for SKU-less items, collapsing them into one
# overwriting row — see its docstring-adjacent comment above for the fix.
# ---------------------------------------------------------------------------

def run_listings() -> None:
    """Pull the current merchant listings snapshot for every configured marketplace.

    Not registered in scheduler.py. Call directly, e.g. from a one-off script
    or the dry-run CLI at the bottom of this file.
    """
    pull_id = str(uuid.uuid4())
    logger.info("amazon_sp.run_listings start pull_id=%s", pull_id)

    def _one_marketplace(client, base_url, rl, marketplace_id, marketplace_name, account_name, token_holder) -> int:
        token_holder.ensure_fresh(client)
        rows, columns, status = run_report_sync(
            client, base_url, rl,
            report_type="GET_MERCHANT_LISTINGS_ALL_DATA",
            marketplace_ids=[marketplace_id],
        )
        write_raw(
            source=SOURCE, pull_id=pull_id,
            endpoint=f"/reports/2021-06-30/reports/GET_MERCHANT_LISTINGS_ALL_DATA/{marketplace_id}",
            response_body={
                "processingStatus": status.get("processingStatus"),
                "row_count": len(rows), "columns": columns,
            },
            response_status=200, connector_version=VERSION,
        )
        batch = []
        for row in rows:
            seller_sku = row.get("seller-sku")
            if not seller_sku:
                continue
            batch.append({
                "source": SOURCE, "record_type": "listing",
                "source_record_id": f"{marketplace_id}_{seller_sku}",
                "data": {**row, "marketplace_id": marketplace_id, "marketplace_name": marketplace_name},
                "last_pull_id": pull_id,
            })
        if batch:
            upsert_clean_batch(batch)
        logger.info(
            "amazon_sp: listings marketplace=%s (%s) rows=%d",
            marketplace_id, marketplace_name, len(batch),
        )
        return len(batch)

    total = _run_reports_for_all_accounts(pull_id, "listings", _one_marketplace)
    logger.info("amazon_sp.run_listings complete pull_id=%s total_rows=%d", pull_id, total)


# ---------------------------------------------------------------------------
# 3b. GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL -> record_type "order_item"
#
# source_record_id = f"{amazon_order_id}:{seller_sku}". This cannot collide with
# the existing record_type='order' rows regardless of the ID string chosen,
# because (source, record_type, source_record_id) is the full unique key and
# record_type differs ('order' vs 'order_item') — see Step 1(d) in the chat
# report for the full explanation. The colon join with seller_sku is what keeps
# multiple line items *within the same order* from colliding with each other,
# which is the real job this ID format is doing.
#
# Starting chunk width: _ORDER_ITEMS_CHUNK_DAYS, defined near the top of the
# Reports API section above (UNVERIFIED — see the comment there). If Amazon
# rejects a chunk as too wide, _create_report_adaptive (above) halves it and
# retries, discovering and logging the real accepted width at runtime instead
# of trusting the assumed 30-day figure.
# ---------------------------------------------------------------------------

def run_order_items(start_date: date, end_date: date) -> None:
    """Pull order line items (ASIN, SKU, qty, item price/tax) for every configured
    marketplace over [start_date, end_date], starting from _ORDER_ITEMS_CHUNK_DAYS
    windows and adaptively halving any window Amazon rejects as too wide.

    Not registered in scheduler.py. Call directly, e.g. from a one-off script
    or the dry-run CLI at the bottom of this file.
    """
    pull_id = str(uuid.uuid4())
    logger.info("amazon_sp.run_order_items start %s to %s pull_id=%s", start_date, end_date, pull_id)

    chunks = _chunk_date_range(start_date, end_date, _ORDER_ITEMS_CHUNK_DAYS)
    logger.info(
        "amazon_sp: order_items %d starting chunk(s) of up to %d day(s) each (may be halved further at runtime)",
        len(chunks), _ORDER_ITEMS_CHUNK_DAYS,
    )

    def _one_marketplace(client, base_url, rl, marketplace_id, marketplace_name, account_name, token_holder) -> int:
        count = 0
        for chunk_start, chunk_end in chunks:
            for sub_start, sub_end, rows, columns, status in _create_report_adaptive(
                client, base_url, rl, token_holder,
                "GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL", [marketplace_id],
                chunk_start, chunk_end,
            ):
                write_raw(
                    source=SOURCE, pull_id=pull_id,
                    endpoint=f"/reports/2021-06-30/reports/GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL/{marketplace_id}",
                    response_body={
                        "processingStatus": status.get("processingStatus"), "row_count": len(rows),
                        "columns": columns, "chunk_start": str(sub_start), "chunk_end": str(sub_end),
                    },
                    response_status=200, connector_version=VERSION,
                )
                batch = []
                for row in rows:
                    order_id = row.get("amazon-order-id")
                    sku = row.get("sku")
                    if not order_id or not sku:
                        continue
                    batch.append({
                        "source": SOURCE, "record_type": "order_item",
                        "source_record_id": f"{order_id}:{sku}",
                        "data": {**row, "marketplace_id": marketplace_id, "marketplace_name": marketplace_name},
                        "last_pull_id": pull_id,
                    })
                if batch:
                    upsert_clean_batch(batch)
                count += len(batch)
                logger.info(
                    "amazon_sp: order_items marketplace=%s (%s) %s..%s rows=%d",
                    marketplace_id, marketplace_name, sub_start, sub_end, len(batch),
                )
        return count

    total = _run_reports_for_all_accounts(pull_id, "order_items", _one_marketplace)
    logger.info("amazon_sp.run_order_items complete pull_id=%s total_rows=%d", pull_id, total)


# ---------------------------------------------------------------------------
# 3c. GET_SALES_AND_TRAFFIC_REPORT -> amazon_asin_daily (NOT api_clean)
#
# Rewritten 2026-08-17 (rev 3, corrected rev 4 same day).
#
# CONFIRMED 2026-08-17, live run against real credentials (upgraded from
# "believed, pending first live run" at rev 4). Evidence: requested UK,
# 2026-08-12 to 2026-08-14 (3-day range, dataStartTime != dataEndTime) —
# response came back with exactly 33 salesAndTrafficByAsin entries, 33
# distinct childAsin values (one entry per ASIN, no duplicates), and ZERO
# entries carrying any date-like field (checked for date, reportDate,
# startDate, endDate, dataStartTime, dataEndTime — none present on any of the
# 33). Compare: the same marketplace on a single day (2026-08-14 alone)
# returned 28 entries. A 3-day request does not return ~3x the entries with a
# date per entry — it returns one blended total per ASIN with no way to
# attribute a figure back to a specific day. salesAndTrafficByAsin IS
# aggregated across whatever dataStartTime/dataEndTime range is requested.
# dateGranularity=DAY only affects the separate salesAndTrafficByDate section.
# Day-level ASIN data requires dataStartTime == dataEndTime — one report per
# calendar day, no exceptions. _create_report_adaptive (halving) does NOT
# apply here regardless — there is nothing to halve, width is always exactly
# 1 day.
#
# asinGranularity is "CHILD" (confirmed 2026-08-17 — rev 3's switch to "SKU"
# was wrong, reverted). _parse_sales_traffic_asin's field nesting is also now
# CONFIRMED — observed verbatim on the same live run (UK, 2026-08-14): every
# field it assumes (childAsin, salesByAsin.{unitsOrdered,orderedProductSales.
# {amount,currencyCode}}, trafficByAsin.{sessions,pageViews,browserSessions,
# mobileAppSessions,buyBoxPercentage,unitSessionPercentage}) matched exactly,
# 0 mismatches. The real response carries substantially more fields than were
# originally captured — see _parse_sales_traffic_asin's docstring for what was
# added 2026-08-17 (totalOrderItems, unitsShipped, ordersShipped,
# shippedProductSales, unitsRefunded, refundRate, browserPageViews,
# mobileAppPageViews, and a full set of B2B counterparts) and what's still
# deliberately skipped (the "...Percentage" share-of-total fields).
#
# Storage: a NEW table, amazon_asin_daily, keyed on
# (marketplace_id, asin, report_date) — not api_clean. No `sku` column: CHILD
# granularity has nothing to key it on cleanly, and an always-null column
# invites someone to populate it later and reintroduce a PK collision.
# report_date as a real `date` column is what makes daily/weekly/monthly
# rollups valid; that's only true because every row is exactly one day's data,
# never a blended range. amazon_asin_daily_status tracks which days have been
# pulled per marketplace — status is 'ok' / 'gap' / 'parse_failed', each with a
# reason and an attempts counter (see _MAX_ATTEMPTS) — making backfills
# resumable, gaps visible instead of indistinguishable from a genuine zero, and
# permanent failures stop being retried forever. See
# lib/migrations/14-amazon-asin-daily.sql — NOT YET APPLIED, see
# reports/amazon-reports-api.md.
#
# Retention (_SALES_TRAFFIC_RETENTION_DAYS) skips the request entirely for a
# date past the wall — reinstated 2026-08-25 now that the constant is
# CONFIRMED (see the header comment above it), reversing the 2026-08-17 rev 4
# decision to always attempt the call regardless. That decision was correct
# at the time: the number was unverified, so a wrong constant would have
# silently truncated a backfill. It no longer applies — every one of 151
# checked cases past this exact wall came back CANCELLED with an empty body,
# zero exceptions across three marketplaces — so skipping is now the correct
# behaviour, not a risk. Marked status='gap', reason='pre_retention',
# count_toward_attempts=False (not a failure, nothing to retry).
#
# Marketplace scope: iterate ACTIVE_MARKETPLACES, not every configured
# marketplace — doddl sells in a subset of the 19 configured. Two entry
# points, not one, because of the throughput math even at that narrower scope:
# createReport is rate-limited to ~1/60s (source-verified, see the rate-limit
# table above), so a historical backfill is realistically hours, not minutes.
#   - run_sales_traffic_nightly()   — yesterday only, ACTIVE_MARKETPLACES.
#     Cheap, safe to run every night.
#   - run_sales_traffic_backfill()  — ONE marketplace (explicit argument, not
#     necessarily restricted to ACTIVE_MARKETPLACES — see its docstring),
#     a date range, resumable via amazon_asin_daily_status, meant to be run in
#     slices and survive being killed and restarted without re-fetching
#     completed days or endlessly retrying permanent failures.
# ---------------------------------------------------------------------------


def _daterange(start: date, end: date):
    """Inclusive day-by-day iterator."""
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


def _resume_skip_info(marketplace_id: str, start: date, end: date) -> tuple[set, set]:
    """For run_sales_traffic_backfill's resume=True: which days to skip and why.

    Returns (ok_days, permanently_failed_days):
      ok_days                — status='ok', genuinely done, skip silently.
      permanently_failed_days — status in ('gap','parse_failed') AND
                                attempts >= _MAX_ATTEMPTS. Stop retrying these
                                automatically; caller logs them as needing
                                manual investigation rather than silently
                                skipping forever.
    A day with attempts < _MAX_ATTEMPTS and status != 'ok' is NOT in either
    set — it gets retried, which is the point of resume.
    """
    rows = select_rows(
        "amazon_asin_daily_status",
        select="report_date,status,attempts",
        filters={
            "marketplace_id": f"eq.{marketplace_id}",
            "report_date": [f"gte.{start.isoformat()}", f"lte.{end.isoformat()}"],
        },
    )
    ok_days: set = set()
    failed_days: set = set()
    for r in rows:
        d = datetime.strptime(r["report_date"], "%Y-%m-%d").date()
        if r.get("status") == "ok":
            ok_days.add(d)
        elif (r.get("attempts") or 0) >= _MAX_ATTEMPTS:
            failed_days.add(d)
    return ok_days, failed_days


def _next_attempt_count(marketplace_id: str, d: date) -> int:
    """Current amazon_asin_daily_status.attempts for this (marketplace, day),
    plus one. 0 (-> 1) if no row exists yet.
    """
    rows = select_rows(
        "amazon_asin_daily_status",
        select="attempts",
        filters={"marketplace_id": f"eq.{marketplace_id}", "report_date": f"eq.{d.isoformat()}"},
    )
    current = rows[0].get("attempts") if rows else 0
    return (current or 0) + 1


def _mark_fetched(marketplace_id: str, d: date) -> None:
    """status='ok'. Deliberately does not touch attempts — PostgREST's
    merge-duplicates upsert only updates columns present in the payload, so
    leaving attempts out preserves whatever it already was (irrelevant once
    status='ok', since _resume_skip_info only checks attempts for non-'ok'
    rows).
    """
    upsert_table(
        "amazon_asin_daily_status",
        [{"marketplace_id": marketplace_id, "report_date": d.isoformat(), "status": "ok", "reason": None}],
        on_conflict="marketplace_id,report_date",
    )


def _mark_gap(marketplace_id: str, d: date, reason: str, *, count_toward_attempts: bool = True) -> None:
    """status='gap' — report succeeded (or was rejected) but there is nothing
    to parse: pre-retention (skips the call entirely, reinstated 2026-08-25
    now that _SALES_TRAFFIC_RETENTION_DAYS is confirmed — see the module
    comment above and the header comment on the constant), a 400, or
    exhausted rate-limit retries.

    count_toward_attempts (fixed 2026-08-19 — was unconditional before this):
    a 429 is transient, not a defect in that day's data — with the measured
    real-world 33-42% createReport 429 rate (see reports/amazon-reports-api.md),
    treating 'rate_limited_exhausted' as counting toward _MAX_ATTEMPTS would
    permanently abandon days purely on bad luck during an 87-hour run, and
    _resume_skip_info would silently skip them on any later resume/retry —
    reported as if the run had succeeded when it had actually given up on
    real, fetchable data. Callers pass count_toward_attempts=False for
    'rate_limited_exhausted' — always retryable, no matter how many times it
    happens. 'http_400' (a real rejection from Amazon, not a rate limit)
    keeps count_toward_attempts=True, same as before.

    When False, 'attempts' is omitted from the upsert payload entirely —
    PostgREST's merge-duplicates upsert only updates columns present in the
    payload, so omitting it leaves whatever value was already there untouched
    (same mechanism _mark_fetched already relies on for 'ok', immediately
    above).
    """
    record: dict = {
        "marketplace_id": marketplace_id, "report_date": d.isoformat(),
        "status": "gap", "reason": reason,
    }
    if count_toward_attempts:
        record["attempts"] = _next_attempt_count(marketplace_id, d)
    upsert_table(
        "amazon_asin_daily_status",
        [record],
        on_conflict="marketplace_id,report_date",
    )


def _mark_parse_failed(marketplace_id: str, d: date, reason: str) -> None:
    """status='parse_failed' — Amazon returned DONE with a real response body,
    but something on our side went wrong with it: _parse_sales_traffic_asin's
    field-name assumptions didn't match (reason: missing_salesAndTrafficByAsin_key
    | salesAndTrafficByAsin_not_list | zero_rows_extracted_all_missing_child_asin),
    or the parsed rows failed to write to amazon_asin_daily (reason:
    upsert_failed — e.g. the 2026-08-19 numeric overflow, see
    _fetch_sales_traffic_day). Distinct from 'gap' on purpose: this is a bug/
    schema/wrong-assumption signal on our side, not something Amazon reported
    as absent. The raw response is in api_raw (see _fetch_sales_traffic_day)
    so the transform/upsert can be re-run once the real cause is known,
    without re-fetching from Amazon. Always increments attempts (unconditionally,
    unlike 'gap' — see _mark_gap's count_toward_attempts — because every
    parse_failed reason here is a real bug/assumption signal, never a
    transient rate limit).
    """
    attempts = _next_attempt_count(marketplace_id, d)
    upsert_table(
        "amazon_asin_daily_status",
        [{
            "marketplace_id": marketplace_id, "report_date": d.isoformat(),
            "status": "parse_failed", "reason": reason, "attempts": attempts,
        }],
        on_conflict="marketplace_id,report_date",
    )


def _upsert_asin_daily(rows: list[dict]) -> None:
    if rows:
        upsert_table("amazon_asin_daily", rows, on_conflict="marketplace_id,asin,report_date")


def _parse_sales_traffic_asin(report: dict, marketplace_id: str, report_date: date) -> tuple[list[dict], int]:
    """Extract one amazon_asin_daily row per ASIN entry from a single-day
    GET_SALES_AND_TRAFFIC_REPORT response, assuming report["salesAndTrafficByAsin"]
    is already known to be a non-empty list (callers check that — see
    _fetch_sales_traffic_day).

    Under CHILD granularity every entry should carry a childAsin. An entry
    without one is skipped and counted, NEVER folded into a parentAsin-keyed
    row — that would put a parent-level total into the same table as child
    rows under the same-shaped key, and any SUM over asin would double-count.

    Returns (rows, skipped_no_child_asin_count). Callers aggregate the skip
    count across a whole run and report it at the end (a non-zero total means
    the CHILD-granularity assumption itself may be wrong — see run_sales_
    traffic_nightly / run_sales_traffic_backfill).

    Field names CONFIRMED 2026-08-17 against a real GET_SALES_AND_TRAFFIC_REPORT
    response (UK, single day) — see the module comment above for the evidence.
    The real response carries roughly twice as many fields as are captured
    here: every metric below has a B2B counterpart (captured, `_b2b` suffix),
    plus a full set of "...Percentage" share-of-marketplace-total fields
    (browserSessionPercentage, pageViewsPercentage, etc., and their B2B
    counterparts) which are deliberately NOT captured — they're derivable from
    the absolute figures already stored here, per Jon 2026-08-17.
    """
    entries = report.get("salesAndTrafficByAsin", []) if isinstance(report, dict) else []
    rows = []
    skipped = 0
    for entry in entries:
        child_asin = entry.get("childAsin")
        if not child_asin:
            logger.warning(
                "amazon_sp: sales_traffic marketplace=%s date=%s: entry with no childAsin, skipping: keys=%s",
                marketplace_id, report_date, list(entry.keys()) if isinstance(entry, dict) else type(entry).__name__,
            )
            skipped += 1
            continue
        sales = entry.get("salesByAsin", {}) or {}
        traffic = entry.get("trafficByAsin", {}) or {}
        revenue = sales.get("orderedProductSales")
        revenue = revenue if isinstance(revenue, dict) else {}
        revenue_b2b = sales.get("orderedProductSalesB2B")
        revenue_b2b = revenue_b2b if isinstance(revenue_b2b, dict) else {}
        shipped_sales = sales.get("shippedProductSales")
        shipped_sales = shipped_sales if isinstance(shipped_sales, dict) else {}
        rows.append({
            "marketplace_id": marketplace_id,
            "asin": child_asin,
            "report_date": report_date.isoformat(),
            "units_ordered": sales.get("unitsOrdered"),
            "ordered_revenue": revenue.get("amount"),
            "currency": revenue.get("currencyCode"),
            "total_order_items": sales.get("totalOrderItems"),
            "units_shipped": sales.get("unitsShipped"),
            "orders_shipped": sales.get("ordersShipped"),
            "shipped_product_sales": shipped_sales.get("amount"),
            "units_refunded": sales.get("unitsRefunded"),
            "refund_rate": sales.get("refundRate"),
            "sessions": traffic.get("sessions"),
            "page_views": traffic.get("pageViews"),
            "browser_sessions": traffic.get("browserSessions"),
            "mobile_app_sessions": traffic.get("mobileAppSessions"),
            "browser_page_views": traffic.get("browserPageViews"),
            "mobile_app_page_views": traffic.get("mobileAppPageViews"),
            "buy_box_pct": traffic.get("buyBoxPercentage"),
            "unit_session_pct": traffic.get("unitSessionPercentage"),
            # B2B counterparts
            "units_ordered_b2b": sales.get("unitsOrderedB2B"),
            "ordered_revenue_b2b": revenue_b2b.get("amount"),
            "total_order_items_b2b": sales.get("totalOrderItemsB2B"),
            "sessions_b2b": traffic.get("sessionsB2B"),
            "browser_sessions_b2b": traffic.get("browserSessionsB2B"),
            "mobile_app_sessions_b2b": traffic.get("mobileAppSessionsB2B"),
            "page_views_b2b": traffic.get("pageViewsB2B"),
            "buy_box_pct_b2b": traffic.get("buyBoxPercentageB2B"),
            "unit_session_pct_b2b": traffic.get("unitSessionPercentageB2B"),
        })
    return rows, skipped


_SALES_TRAFFIC_RATE_LIMIT_RETRIES = 5


def _fetch_sales_traffic_day(
    client: httpx.Client, base_url: str, rl: ReportsRateLimiters, token_holder: _TokenHolder,
    marketplace_id: str, marketplace_name: str, d: date, pull_id: str,
) -> tuple[int, int]:
    """Fetch, parse and store ONE day of GET_SALES_AND_TRAFFIC_REPORT for one
    marketplace. dataStartTime == dataEndTime == d, always. No
    _create_report_adaptive: there is nothing to halve, width is always 1.

    Skips the request entirely for a date past _SALES_TRAFFIC_RETENTION_DAYS
    — reinstated 2026-08-25 now that the constant is confirmed (see its
    header comment). Amazon cancels the report job for these regardless of
    how many times it's asked, so calling is a wasted createReport slot
    (~1/60s budget) on every remaining marketplace as the backfill keeps
    working backward.

    Returns (row_count, no_child_asin_skipped_count). row_count is 0 on any
    gap/parse failure. Writes to amazon_asin_daily / amazon_asin_daily_status,
    NOT api_clean; writes the FULL response to api_raw regardless of whether
    parsing succeeds, so a wrong field-name assumption can be re-transformed
    later without re-fetching. Raises AccountSkipped (propagated from
    token_holder.ensure_fresh) if the account's token cannot be refreshed —
    callers must catch this.
    """
    cutoff = date.today() - timedelta(days=_SALES_TRAFFIC_RETENTION_DAYS)
    if d < cutoff:
        logger.info(
            "amazon_sp: sales_traffic marketplace=%s (%s) date=%s: past the confirmed "
            "%d-day retention wall (cutoff %s) — skipping without calling Amazon",
            marketplace_id, marketplace_name, d, _SALES_TRAFFIC_RETENTION_DAYS, cutoff,
        )
        _mark_gap(marketplace_id, d, reason="pre_retention", count_toward_attempts=False)
        return 0, 0

    day_start_str = d.strftime("%Y-%m-%dT00:00:00Z")
    day_end_str = d.strftime("%Y-%m-%dT23:59:59Z")

    parsed = None
    status: dict = {}
    for attempt in range(1, _SALES_TRAFFIC_RATE_LIMIT_RETRIES + 1):
        token_holder.ensure_fresh(client)   # may raise AccountSkipped — propagates to caller
        try:
            parsed, _columns, status = run_report_sync(
                client, base_url, rl,
                report_type="GET_SALES_AND_TRAFFIC_REPORT",
                marketplace_ids=[marketplace_id],
                data_start_time=day_start_str, data_end_time=day_end_str,
                report_options={"dateGranularity": "DAY", "asinGranularity": "CHILD"},
                report_format="json",
            )
            break
        except httpx.HTTPStatusError as exc:
            code = exc.response.status_code if exc.response is not None else None
            if code == 429:
                retry_after = 60.0
                if exc.response is not None:
                    try:
                        retry_after = float(exc.response.headers.get("Retry-After", 60))
                    except (TypeError, ValueError):
                        pass
                logger.warning(
                    "amazon_sp: sales_traffic marketplace=%s (%s) date=%s: 429, backing off %.0fs (attempt %d/%d)",
                    marketplace_id, marketplace_name, d, retry_after, attempt, _SALES_TRAFFIC_RATE_LIMIT_RETRIES,
                )
                time.sleep(retry_after)
                continue
            if code == 400:
                body_text = exc.response.text if exc.response is not None else "?"
                logger.error(
                    "amazon_sp: sales_traffic marketplace=%s (%s) date=%s: 400 body=%s",
                    marketplace_id, marketplace_name, d, body_text,
                )
                _mark_gap(marketplace_id, d, reason="http_400")
                return 0, 0
            raise
    else:
        logger.error(
            "amazon_sp: sales_traffic marketplace=%s (%s) date=%s: giving up after %d rate-limit retries "
            "for this pass — transient, does not count toward _MAX_ATTEMPTS, always retryable on resume",
            marketplace_id, marketplace_name, d, _SALES_TRAFFIC_RATE_LIMIT_RETRIES,
        )
        _mark_gap(marketplace_id, d, reason="rate_limited_exhausted", count_toward_attempts=False)
        return 0, 0

    # Full response stored regardless of what happens next — fix for rev 4:
    # previously only {"processingStatus", "date"} was stored, discarding the
    # actual body, so a wrong field-name assumption meant every affected day
    # had to be re-fetched at 1/60s just to re-attempt the transform.
    write_raw(
        source=SOURCE, pull_id=pull_id,
        endpoint=f"/reports/2021-06-30/reports/GET_SALES_AND_TRAFFIC_REPORT/{marketplace_id}",
        response_body={"processingStatus": status.get("processingStatus"), "date": str(d), "report": parsed},
        response_status=200, connector_version=VERSION,
    )

    if not isinstance(parsed, dict) or "salesAndTrafficByAsin" not in parsed:
        top_level = list(parsed.keys()) if isinstance(parsed, dict) else f"<{type(parsed).__name__}>"
        logger.error(
            "amazon_sp: sales_traffic marketplace=%s (%s) date=%s: response missing/malformed "
            "salesAndTrafficByAsin — top-level keys=%s — the field-name assumption may be wrong "
            "(full response is in api_raw for this pull_id)",
            marketplace_id, marketplace_name, d, top_level,
        )
        _mark_parse_failed(marketplace_id, d, reason="missing_salesAndTrafficByAsin_key")
        return 0, 0

    by_asin_raw = parsed["salesAndTrafficByAsin"]
    if not isinstance(by_asin_raw, list):
        logger.error(
            "amazon_sp: sales_traffic marketplace=%s (%s) date=%s: salesAndTrafficByAsin is not a list (type=%s)",
            marketplace_id, marketplace_name, d, type(by_asin_raw).__name__,
        )
        _mark_parse_failed(marketplace_id, d, reason="salesAndTrafficByAsin_not_list")
        return 0, 0

    if not by_asin_raw:
        # An empty list means one of two very different things, and conflating
        # them is exactly what caused the 2026-08-31..09-21 data loss (see the
        # _SALES_TRAFFIC_LAG_DAYS header comment):
        #
        #   - recent date  -> Amazon has not finalised the ASIN breakdown yet.
        #                     Retryable 'gap', NOT 'ok' — otherwise
        #                     _resume_skip_info skips it forever and the day is
        #                     lost permanently despite the data existing.
        #   - older date   -> a real "no ASIN entries" day. 'ok'.
        #
        # count_toward_attempts=False for the recent case: an unfinalised day is
        # not a defect in that day's data, same reasoning as
        # 'rate_limited_exhausted' (see _mark_gap). It must stay retryable for
        # as long as it sits inside the finalisation window rather than burning
        # through _MAX_ATTEMPTS on days that were always going to be empty at
        # this point.
        #
        # Never a retention-boundary artefact here — any date past the retention
        # wall was already skipped above without calling Amazon at all, so by
        # this point d >= cutoff is guaranteed.
        # >= not >: a day exactly _SALES_TRAFFIC_FINALISATION_DAYS old is still
        # "within 7 days" and stays retryable. Only day 8 onward is accepted as
        # a genuine zero.
        finalisation_cutoff = date.today() - timedelta(days=_SALES_TRAFFIC_FINALISATION_DAYS)
        if d >= finalisation_cutoff:
            logger.warning(
                "amazon_sp: sales_traffic marketplace=%s (%s) date=%s: empty salesAndTrafficByAsin "
                "within the %d-day finalisation window (cutoff %s) — treating as NOT YET FINALISED "
                "and leaving it retryable, not recording it as a genuine zero",
                marketplace_id, marketplace_name, d, _SALES_TRAFFIC_FINALISATION_DAYS, finalisation_cutoff,
            )
            _mark_gap(marketplace_id, d, reason="empty_not_yet_finalised", count_toward_attempts=False)
            return 0, 0
        logger.info(
            "amazon_sp: sales_traffic marketplace=%s (%s) date=%s: empty (no sales that day) — "
            "older than the %d-day finalisation window, accepting as a genuine zero",
            marketplace_id, marketplace_name, d, _SALES_TRAFFIC_FINALISATION_DAYS,
        )
        _mark_fetched(marketplace_id, d)
        return 0, 0

    rows, skipped = _parse_sales_traffic_asin(parsed, marketplace_id, d)
    if not rows:
        # Entries existed but none yielded a row (all lacked childAsin) — this
        # is a parse failure, not a genuine empty day. Distinguishing this from
        # the empty-list case above is the whole point of fix 3: a wrong
        # field-name assumption must never look like success.
        logger.error(
            "amazon_sp: sales_traffic marketplace=%s (%s) date=%s: %d entries present but 0 rows "
            "extracted (all lacked childAsin) — treating as parse failure, not a genuine empty day",
            marketplace_id, marketplace_name, d, len(by_asin_raw),
        )
        _mark_parse_failed(marketplace_id, d, reason="zero_rows_extracted_all_missing_child_asin")
        return 0, skipped

    try:
        _upsert_asin_daily(rows)
    except Exception as exc:
        # Fixed 2026-08-19: this used to propagate and kill the entire
        # multi-day run — exactly what happened on 2026-06-18 (UK), where one
        # ASIN's unitSessionPercentageB2B (1000, one digit past
        # numeric(6,3)'s max) took down a 100+ day backfill outright. The
        # resume mechanism and attempts cap exist precisely so a bad day can
        # be retried or eventually abandoned instead of raising — a crash
        # bypasses both. Never raise here; always mark_parse_failed and
        # return so the caller (and the rest of the backfill) keeps going.
        detail = None
        if isinstance(exc, httpx.HTTPStatusError) and exc.response is not None:
            try:
                detail = exc.response.json()
            except Exception:
                detail = exc.response.text
        logger.error(
            "amazon_sp: sales_traffic marketplace=%s (%s) date=%s: upsert to amazon_asin_daily "
            "FAILED for %d row(s), asins=%s: %s | response detail: %s",
            marketplace_id, marketplace_name, d, len(rows),
            [r.get("asin") for r in rows], exc, detail,
        )
        _mark_parse_failed(marketplace_id, d, reason="upsert_failed")
        return 0, skipped

    _mark_fetched(marketplace_id, d)
    return len(rows), skipped


class SalesTrafficHealthCheckFailed(Exception):
    """The nightly run completed without raising, but what it stored does not
    look like a healthy day. Raised at the very END of run_sales_traffic_nightly
    (never mid-run, so it can't abort fetching) purely to surface the problem:
    scheduler.py's on_job_error listener turns any exception out of a job into a
    high-priority PM incident task via alerting.create_incident_task, which is
    the only channel that actually reaches a human. Logging alone is what let
    the 2026-08-31 regression run for three weeks unnoticed.
    """


# Health-guard tuning. These describe "obviously broken", not "slightly off" —
# a nightly job that cries wolf gets muted, and a muted guard is the same as no
# guard. Every threshold below is set so the ACTUAL 2026-08-31 regression trips
# it several times over (rows/day 99 -> 29, US and CA to exactly 0, traffic
# gone everywhere) while ordinary day-to-day variation does not.
_HEALTH_BASELINE_DAYS = 14        # trailing window the target day is compared against
_HEALTH_MIN_BASELINE_DAYS = 5     # below this many usable baseline days, skip the check entirely
_HEALTH_ROW_RATIO = 0.5           # total rows < 50% of the baseline daily average -> fail
_HEALTH_MKT_MIN_BASELINE = 3.0    # only flag a silent marketplace if it averaged >= 3 rows/day
_HEALTH_SESSION_BASELINE = 0.5    # baseline must be >=50% sessions-bearing before absence is damning
_HEALTH_PAGE = 1000               # PostgREST page size — Supabase caps a response at 1000 rows


def _sales_traffic_health_check(target_date: date) -> None:
    """Compare what target_date actually stored against the trailing baseline,
    and raise SalesTrafficHealthCheckFailed if it looks like a silent loss.

    Reads amazon_asin_daily rather than trusting this run's in-memory row
    counts, because the counts include retry-sweep days and, more importantly,
    the thing being guarded against is precisely a run that believes it
    succeeded. Three independent signals, any one of which fails the check:

      1. Total rows collapsed vs the trailing daily average.
      2. A marketplace that reliably produces rows produced none at all.
         (This is the one that would have caught US/CA on 2026-08-31.)
      3. Rows exist but NONE carry sessions, where the baseline normally does.
         (This is the one that would have caught the traffic loss across
         UK/DE/FR, which kept producing rows and so looked fine.)
    """
    baseline_start = target_date - timedelta(days=_HEALTH_BASELINE_DAYS)
    baseline_end = target_date - timedelta(days=1)
    # Paged deliberately: select_rows() has no offset parameter and Supabase
    # caps a PostgREST response at 1000 rows, while this window is 15 days at
    # ~100 rows/day across 9 marketplaces. A single select_rows call would be
    # silently truncated at 1000 and the truncation would land on whichever
    # rows PostgREST happened to order last — skewing the per-marketplace and
    # per-day counts this check is entirely built on, and turning the guard
    # into a source of false alarms. Same reason and same mechanism as
    # _catalog_select_page further down this file.
    rows: list[dict] = []
    page = 0
    while True:
        headers = dict(_db_headers(_db_key()))
        headers["Range-Unit"] = "items"
        headers["Range"] = f"{page * _HEALTH_PAGE}-{(page + 1) * _HEALTH_PAGE - 1}"
        resp = httpx.get(
            f"{_DB_URL}/amazon_asin_daily",
            headers=headers,
            params={
                "select": "marketplace_id,report_date,sessions",
                "report_date": [f"gte.{baseline_start.isoformat()}", f"lte.{target_date.isoformat()}"],
            },
            timeout=60.0,
        )
        resp.raise_for_status()
        batch = resp.json()
        rows.extend(batch)
        if len(batch) < _HEALTH_PAGE:
            break
        page += 1

    target_rows = [r for r in rows if r["report_date"] == target_date.isoformat()]
    baseline_rows = [r for r in rows if r["report_date"] != target_date.isoformat()]
    baseline_days = {r["report_date"] for r in baseline_rows}
    if len(baseline_days) < _HEALTH_MIN_BASELINE_DAYS:
        logger.info(
            "amazon_sp: sales_traffic_nightly health check skipped — only %d baseline day(s) "
            "between %s and %s, need %d",
            len(baseline_days), baseline_start, baseline_end, _HEALTH_MIN_BASELINE_DAYS,
        )
        return

    problems: list[str] = []

    baseline_per_day = len(baseline_rows) / len(baseline_days)
    if len(target_rows) < baseline_per_day * _HEALTH_ROW_RATIO:
        problems.append(
            f"row count collapsed: {len(target_rows)} row(s) for {target_date} vs a trailing "
            f"average of {baseline_per_day:.0f}/day over {len(baseline_days)} day(s) "
            f"(threshold {_HEALTH_ROW_RATIO:.0%})"
        )

    target_by_mkt: dict[str, int] = {}
    for r in target_rows:
        target_by_mkt[r["marketplace_id"]] = target_by_mkt.get(r["marketplace_id"], 0) + 1
    baseline_by_mkt: dict[str, int] = {}
    for r in baseline_rows:
        baseline_by_mkt[r["marketplace_id"]] = baseline_by_mkt.get(r["marketplace_id"], 0) + 1
    silent = sorted(
        mkt for mkt, n in baseline_by_mkt.items()
        if (n / len(baseline_days)) >= _HEALTH_MKT_MIN_BASELINE and target_by_mkt.get(mkt, 0) == 0
    )
    if silent:
        problems.append(
            f"marketplace(s) produced no rows at all for {target_date} despite averaging "
            f">= {_HEALTH_MKT_MIN_BASELINE:.0f} rows/day in the baseline: "
            + ", ".join(f"{m} ({baseline_by_mkt[m] / len(baseline_days):.1f}/day)" for m in silent)
        )

    def _with_sessions(rs: list[dict]) -> int:
        return sum(1 for r in rs if (r.get("sessions") or 0) > 0)

    baseline_session_share = _with_sessions(baseline_rows) / len(baseline_rows) if baseline_rows else 0.0
    if (
        target_rows
        and baseline_session_share >= _HEALTH_SESSION_BASELINE
        and _with_sessions(target_rows) == 0
    ):
        problems.append(
            f"traffic metrics absent: 0 of {len(target_rows)} row(s) for {target_date} carry "
            f"sessions > 0, while {baseline_session_share:.0%} of baseline rows do — sales may "
            f"still be landing while the traffic half of the report is silently empty"
        )

    if problems:
        raise SalesTrafficHealthCheckFailed(
            f"amazon-sales-traffic-nightly stored data for {target_date} that does not look "
            f"healthy ({len(problems)} signal(s)): " + " | ".join(problems)
            + " — the data very likely EXISTS on Amazon's side and can be recovered with "
              "connectors/scheduler/backfill_sales_traffic.py over the affected range; see the "
              "_SALES_TRAFFIC_LAG_DAYS comment for the 2026-08-31 precedent."
        )

    logger.info(
        "amazon_sp: sales_traffic_nightly health check PASSED for %s — %d row(s) vs %.0f/day "
        "baseline, %d marketplace(s), %d row(s) with sessions",
        target_date, len(target_rows), baseline_per_day, len(target_by_mkt), _with_sessions(target_rows),
    )


def run_sales_traffic_nightly() -> None:
    """Pull the D-_SALES_TRAFFIC_LAG_DAYS day, plus any day in the trailing
    _SALES_TRAFFIC_RETRY_WINDOW_DAYS that is not yet 'ok', for every marketplace
    in ACTIVE_MARKETPLACES. Still NOT a backfill — use
    run_sales_traffic_backfill for historical ranges.

    Changed 2026-09-22 (was: yesterday only). Two things had to change together,
    and neither alone is sufficient:

      - The newest target moved from D-1 to D-2, because Amazon has not
        finalised the ASIN/traffic halves of the report at lag 1.
      - The job now SWEEPS unfinished recent days rather than fetching exactly
        one. Without the sweep, _fetch_sales_traffic_day's new
        'empty_not_yet_finalised' gap would be written and then never
        revisited, which is the same permanent hole in a different costume.

    On a healthy night the sweep costs nothing extra: every day behind D-2 is
    already 'ok' and _resume_skip_info filters it out, leaving exactly one
    report per marketplace. It only expands after something has gone wrong,
    which is when the extra requests are worth spending.

    Refuses to run if ACTIVE_MARKETPLACES is empty (see its definition near
    the top of the Reports API section) rather than silently doing nothing or
    falling back to all 19 configured marketplaces.

    Raises SalesTrafficHealthCheckFailed at the end if what landed does not look
    like a healthy day — see _sales_traffic_health_check. The fetching is all
    done by then; the exception exists to reach a human, not to abort work.

    Registered in scheduler.py as the "amazon-sales-traffic-nightly" cron job
    (daily 04:30 Europe/London). Can also be called directly, e.g. from a
    one-off script or the dry-run CLI at the bottom of this file.
    """
    if not ACTIVE_MARKETPLACES:
        logger.error(
            "amazon_sp: sales_traffic_nightly — ACTIVE_MARKETPLACES is empty, refusing to run. "
            "Fill in the marketplace_id values doddl actually sells in near the top of the "
            "Reports API section before using this.",
        )
        return

    pull_id = str(uuid.uuid4())
    target_date = date.today() - timedelta(days=_SALES_TRAFFIC_LAG_DAYS)
    window_start = date.today() - timedelta(days=_SALES_TRAFFIC_RETRY_WINDOW_DAYS)
    logger.info(
        "amazon_sp.run_sales_traffic_nightly start target=%s (D-%d) retry_window=%s..%s "
        "marketplaces=%d pull_id=%s",
        target_date, _SALES_TRAFFIC_LAG_DAYS, window_start, target_date,
        len(ACTIVE_MARKETPLACES), pull_id,
    )

    skip_lock = threading.Lock()
    skip_total = [0]   # mutable cell, closed over by _one_marketplace across threads

    def _one_marketplace(client, base_url, rl, marketplace_id, marketplace_name, account_name, token_holder) -> int:
        # Same resume semantics as the backfill: skip days already 'ok', and
        # days that have burned _MAX_ATTEMPTS without succeeding (those need a
        # human, not another automatic retry every single night forever).
        ok_days, failed_days = _resume_skip_info(marketplace_id, window_start, target_date)
        days = [d for d in _daterange(window_start, target_date) if d not in ok_days and d not in failed_days]
        if failed_days:
            logger.warning(
                "amazon_sp: sales_traffic_nightly marketplace=%s (%s): %d day(s) in the retry window "
                "have hit %d attempts without succeeding and need manual investigation: %s",
                marketplace_id, marketplace_name, len(failed_days), _MAX_ATTEMPTS, sorted(failed_days),
            )
        if len(days) > 1:
            logger.info(
                "amazon_sp: sales_traffic_nightly marketplace=%s (%s): %d day(s) to fetch "
                "(%s) — more than the usual 1, so an earlier night left days unfinished",
                marketplace_id, marketplace_name, len(days), sorted(days),
            )

        count = 0
        for d in days:
            row_count, skipped = _fetch_sales_traffic_day(
                client, base_url, rl, token_holder, marketplace_id, marketplace_name, d, pull_id,
            )
            count += row_count
            if skipped:
                with skip_lock:
                    skip_total[0] += skipped
        return count

    total = _run_reports_for_all_accounts(
        pull_id, "sales_traffic_nightly", _one_marketplace, marketplace_filter=ACTIVE_MARKETPLACES,
    )
    logger.info("amazon_sp.run_sales_traffic_nightly complete pull_id=%s total_rows=%d", pull_id, total)
    if skip_total[0]:
        logger.warning(
            "amazon_sp: sales_traffic_nightly: %d entries skipped for missing childAsin across this run "
            "— the CHILD granularity assumption may be wrong, investigate",
            skip_total[0],
        )

    _sales_traffic_health_check(target_date)


def run_sales_traffic_backfill(
    account_name: str, marketplace_id: str, start_date: date, end_date: date, *, resume: bool = True,
) -> None:
    """Backfill GET_SALES_AND_TRAFFIC_REPORT for ONE marketplace over a date
    range, one report per calendar day. Deliberately separate from the nightly
    job — see the module comment above for the throughput math.

    marketplace_id is NOT restricted to ACTIVE_MARKETPLACES — this is an
    explicit, deliberate single-marketplace call, so a marketplace outside
    that list is allowed (e.g. testing a newly-launched market) but logged as
    a warning, since it is usually a mistake given the 1/60s cost.

    resume=True (default) skips days already marked 'ok', AND days that have
    hit _MAX_ATTEMPTS without succeeding (logged separately as needing manual
    investigation — see _resume_skip_info) — so a killed-and-restarted backfill
    does not re-fetch completed days, and a permanently-broken day does not
    get retried forever at 1/60s. Run in slices, e.g.:
        run_sales_traffic_backfill("EU", "A1F83G8C2ARO7P", date(2025,1,1), date(2025,3,31))

    Requires lib/migrations/14-amazon-asin-daily.sql to have been applied first
    (amazon_asin_daily / amazon_asin_daily_status must exist) — not done this
    session, see reports/amazon-reports-api.md.

    Not registered in scheduler.py.
    """
    if marketplace_id not in ACTIVE_MARKETPLACES:
        logger.warning(
            "amazon_sp: sales_traffic_backfill marketplace=%s is not in ACTIVE_MARKETPLACES — "
            "proceeding anyway since this is an explicit single-marketplace call, but confirm "
            "this marketplace actually has sales before spending 1/60s-rate-limited quota on it",
            marketplace_id,
        )

    pull_id = str(uuid.uuid4())
    account_cfg = ACCOUNTS[account_name]
    marketplace_name = next(
        (name for mid, name, _sid in account_cfg["marketplaces"] if mid == marketplace_id),
        marketplace_id,
    )
    logger.info(
        "amazon_sp.run_sales_traffic_backfill start account=%s marketplace=%s (%s) %s to %s resume=%s pull_id=%s",
        account_name, marketplace_id, marketplace_name, start_date, end_date, resume, pull_id,
    )

    days = list(_daterange(start_date, end_date))
    if resume:
        ok_days, failed_days = _resume_skip_info(marketplace_id, start_date, end_date)
        before = len(days)
        days = [d for d in days if d not in ok_days and d not in failed_days]
        logger.info(
            "amazon_sp: sales_traffic_backfill marketplace=%s %d day(s) to fetch (%d already ok, "
            "%d permanently failed after %d+ attempts)",
            marketplace_id, len(days), len(ok_days), len(failed_days), _MAX_ATTEMPTS,
        )
        if failed_days:
            logger.warning(
                "amazon_sp: sales_traffic_backfill marketplace=%s: %d day(s) need manual investigation "
                "(hit %d attempts without succeeding): %s",
                marketplace_id, len(failed_days), _MAX_ATTEMPTS, sorted(failed_days),
            )

    creds = get_secrets(["amazon-sp-api-client-id", "amazon-sp-api-client-secret"])
    client_id, client_secret = creds["amazon-sp-api-client-id"], creds["amazon-sp-api-client-secret"]
    token_body = _load_account_token_with_expiry(account_name, account_cfg, client_id, client_secret)
    if token_body is None:
        logger.error(
            "amazon_sp: sales_traffic_backfill account=%s — no token obtainable, aborting", account_name,
        )
        return

    base_url = account_cfg["endpoint"]
    headers = {"x-amz-access-token": token_body["access_token"], "Accept": "application/json"}
    rl = ReportsRateLimiters()
    token_holder = _TokenHolder(account_name, account_cfg, client_id, client_secret, token_body)

    total = 0
    skip_total = 0
    with httpx.Client(headers=headers, timeout=60.0) as client:
        for d in days:
            try:
                row_count, skipped = _fetch_sales_traffic_day(
                    client, base_url, rl, token_holder, marketplace_id, marketplace_name, d, pull_id,
                )
                total += row_count
                skip_total += skipped
            except AccountSkipped as exc:
                logger.error(
                    "amazon_sp: sales_traffic_backfill account=%s — %s — aborting backfill",
                    account_name, exc,
                )
                break

    logger.info(
        "amazon_sp.run_sales_traffic_backfill complete account=%s marketplace=%s pull_id=%s total_rows=%d",
        account_name, marketplace_id, pull_id, total,
    )
    if skip_total:
        logger.warning(
            "amazon_sp: sales_traffic_backfill marketplace=%s: %d entries skipped for missing childAsin "
            "across this run — the CHILD granularity assumption may be wrong, investigate",
            marketplace_id, skip_total,
        )


# ---------------------------------------------------------------------------
# Dry-run mode — Step 5. Creates, polls, downloads and parses ONE real report
# against live Amazon credentials, prints a preview, and writes nothing to
# api_raw or api_clean. Needs Key Vault access for the Amazon LWA secrets,
# which is documented as broken on this machine (see
# reports/scheduler-deploy-prep.md, "Known local-tooling issue — WON'T FIX").
# This code has NOT been executed against live Amazon credentials — see
# reports/amazon-reports-api.md for exactly what is and isn't tested.
# ---------------------------------------------------------------------------

def dry_run_report(
    account_name: str,
    marketplace_id: str,
    report_type: str,
    *,
    data_start_time: Optional[str] = None,
    data_end_time: Optional[str] = None,
    report_options: Optional[dict] = None,
    report_format: str = "tsv",
) -> None:
    """Request/poll/download/parse a single report and print a preview. No DB writes."""
    account_cfg = ACCOUNTS[account_name]
    creds = get_secrets(["amazon-sp-api-client-id", "amazon-sp-api-client-secret"])
    token = _load_account_token(account_name, account_cfg, creds["amazon-sp-api-client-id"], creds["amazon-sp-api-client-secret"])
    if token is None:
        print(f"Could not obtain an access token for account {account_name} "
              f"— check Key Vault secret {account_cfg['refresh_token_secret']}")
        return

    base_url = account_cfg["endpoint"]
    headers = {"x-amz-access-token": token, "Accept": "application/json"}
    rl = ReportsRateLimiters()
    with httpx.Client(headers=headers, timeout=60.0) as client:
        parsed, columns, status = run_report_sync(
            client, base_url, rl, report_type, [marketplace_id],
            data_start_time=data_start_time, data_end_time=data_end_time,
            report_options=report_options, report_format=report_format,
        )

    print(f"\n=== {report_type} — account={account_name} marketplace={marketplace_id} ===")
    print(f"processingStatus: {status.get('processingStatus')}")
    if status.get("processingStatus") != "DONE":
        print(f"Full status body: {json.dumps(status, indent=2)}")
        return

    if report_format == "json":
        if isinstance(parsed, dict):
            print("Top-level keys:", list(parsed.keys()))
            sample = parsed.get("salesAndTrafficByAsin", [])[:5]
        else:
            print("Unexpected top-level type:", type(parsed))
            sample = []
        print(f"\nFirst {len(sample)} salesAndTrafficByAsin entries:")
        for entry in sample:
            print(json.dumps(entry, indent=2))
    else:
        print(f"Columns ({len(columns)}): {columns}")
        print(f"\nFirst {min(5, len(parsed))} of {len(parsed)} rows:")
        for row in parsed[:5]:
            print(json.dumps(row, indent=2))


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Dry-run one SP-API report: create, poll, download, parse, print. No DB writes.",
    )
    parser.add_argument("report", choices=["listings", "order_items", "sales_traffic"])
    parser.add_argument("--account", default="EU", choices=list(ACCOUNTS.keys()))
    parser.add_argument("--marketplace", default=None, help="marketplace_id; defaults to the account's first marketplace")
    parser.add_argument("--start", default=None, help="YYYY-MM-DD (order_items / sales_traffic only)")
    parser.add_argument("--end", default=None, help="YYYY-MM-DD (order_items only; sales_traffic always uses one day, --start)")
    args = parser.parse_args()

    _account_cfg = ACCOUNTS[args.account]
    _marketplace_id = args.marketplace or _account_cfg["marketplaces"][0][0]

    if args.report == "listings":
        dry_run_report(args.account, _marketplace_id, "GET_MERCHANT_LISTINGS_ALL_DATA")

    elif args.report == "order_items":
        _start = (
            datetime.strptime(args.start, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            if args.start else datetime.now(timezone.utc) - timedelta(days=1)
        )
        _end = (
            datetime.strptime(args.end, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            if args.end else datetime.now(timezone.utc)
        )
        dry_run_report(
            args.account, _marketplace_id, "GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL",
            data_start_time=_start.strftime("%Y-%m-%dT%H:%M:%SZ"),
            data_end_time=_end.strftime("%Y-%m-%dT%H:%M:%SZ"),
        )

    elif args.report == "sales_traffic":
        _day = (
            datetime.strptime(args.start, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            if args.start else datetime.now(timezone.utc) - timedelta(days=3)
        )
        dry_run_report(
            args.account, _marketplace_id, "GET_SALES_AND_TRAFFIC_REPORT",
            data_start_time=_day.strftime("%Y-%m-%dT00:00:00Z"),
            data_end_time=_day.strftime("%Y-%m-%dT23:59:59Z"),
            report_options={"dateGranularity": "DAY", "asinGranularity": "CHILD"},   # rev 4: reverted from rev 3's SKU
            report_format="json",
        )


# ---------------------------------------------------------------------------
# Catalog Items — daily sales rank snapshot
# ---------------------------------------------------------------------------
# GET /catalog/2022-04-01/items/{asin}?marketplaceIds={id}&includedData=salesRanks
#
# RANK HAS NO HISTORY. A MISSED DAY IS GONE.
# Every other feed here can be backfilled: sales/traffic reaches back two years,
# ads keeps 95 days. Catalog rank is a point-in-time snapshot with no retention
# window at all — if this job does not run on a given day, that day's rank does
# not exist anywhere and never will. That is why it is scheduled early, why a
# per-ASIN failure is tolerated, and why a run that ranks nothing raises.
#
# BOTH RANK ARRAYS ARE STORED, UNFLATTENED.
# One ASIN sits in several categories at once and the useful one changes:
#   classificationRanks  {classificationId, title, link, rank}    Toddler Bowls #34
#   displayGroupRanks    {websiteDisplayGroup, title, link, rank} Baby Products #7740
# Same product, two orders of magnitude apart. The two also carry DIFFERENT
# identifying keys — classificationId vs websiteDisplayGroup — so flattening to
# one shape would discard whichever field lost. The marketplace's whole
# salesRanks entry is stored as returned and the reader decides which matters.
#
# TARGETS COME FROM WHAT ACTUALLY SELLS, NOT FROM THE PRODUCT MASTER.
# dim_product_asin holds 78 distinct ASINs against a region ("EU"/"NA"), so
# using it would mean fanning each across all seven EU marketplaces and
# discovering by 404 which listings exist — ~500 requests a night, most of them
# misses. amazon_asin_daily already holds real (marketplace_id, asin) pairs,
# every one a listing Amazon reported activity for: 184 pairs over 63 ASINs in
# the last 90 days. Every request targets a listing known to exist.
#
# The 90-day bound is also the retry-suppression mechanism. A delisted ASIN
# stops appearing in amazon_asin_daily, ages out of the window, and leaves this
# job's target list on its own — no status table, no attempts counter, and no
# never-retry flag that has to be cleared by hand when a listing returns.
CATALOG_RANK_RATE = 2.0          # x-amzn-RateLimit-Limit: 2.0, confirmed live
CATALOG_RANK_BURST = 2
CATALOG_RANK_LOOKBACK_DAYS = 90
CATALOG_RANK_RECORD_TYPE = "catalog_rank"
CATALOG_RANK_PATH = "/catalog/2022-04-01/items"
# Throttle retries per pair. Amazon's quota is shared across everything hitting
# the same endpoint, so a locally-correct 2 req/sec still collects 429s when the
# ads or sales/traffic jobs are running alongside on the 10-worker pool.
CATALOG_RANK_THROTTLE_RETRIES = 4
#
# WHAT ELSE COMPETES FOR THIS QUOTA: NOTHING, TODAY.
# Checked 2026-09-08 against a week of api_raw timings (UTC):
#   amazon-sp-api-sync        00:30:03 -> 00:30:31   orders / fba / listings
#   sales-traffic-nightly     03:30:29 -> 03:36:42   reports
#   amazon-catalog-rank       05:30 (06:30 BST)      catalog        <- this job
# Sales/traffic finishes nearly two hours before this job starts, and it has
# never run long: six minutes, every night, seven nights running.
#
# The advertising job at 04:30 UTC does NOT compete either — it calls
# advertising-api-*.amazon.com, a different host and a different product, with
# its own quota. (An earlier note in this file's history claimed otherwise.)
#
# SP-API quotas are also published PER OPERATION rather than per host, and the
# response confirms it per call: getCatalogItem returns its own
# x-amzn-RateLimit-Limit: 2.0. So even a sales/traffic overrun would be
# spending Reports API budget, not this one.
#
# The 429s on the first live run therefore came from inside this job, not from
# contention: the NA account holds the largest block (51 US + 8 CA pairs) and
# ran them back to back at exactly the advertised rate with no slack, which
# Amazon throttled anyway. Hence the retry above rather than a lower rate — the
# limiter is correct, the enforcement is just tighter than the number implies.
#
# THIS LOOP MUST STAY SEQUENTIAL ACROSS ACCOUNTS. Each account gets its own
# _RateLimiter, which is right when they run one after another. Parallelising
# them on the 10-worker pool would put EU and EU-2 — two accounts, one
# getCatalogItem quota — at 4 req/sec against a 2 req/sec limit, and the
# symptom would be intermittent 429s that look like Amazon being flaky.
_CATALOG_PAGE = 1000

# marketplace_id -> the label used elsewhere in this file, so a stamped
# marketplace_name matches what the sales/traffic rows already carry.
_MARKETPLACE_LABEL: dict[str, str] = {
    marketplace_id: country
    for account_cfg in ACCOUNTS.values()
    for (marketplace_id, country, _seller_id) in account_cfg["marketplaces"]
}


def _catalog_select_page(table: str, select: str, filters: dict, page: int) -> list:
    """One page of a PostgREST select.

    select_rows() has no offset parameter and amazon_asin_daily holds tens of
    thousands of rows in a 90-day window, so paging happens here rather than
    pulling the lot in a single request.
    """
    params = {"select": select, **filters}
    headers = dict(_db_headers(_db_key()))
    headers["Range-Unit"] = "items"
    headers["Range"] = f"{page * _CATALOG_PAGE}-{(page + 1) * _CATALOG_PAGE - 1}"
    resp = httpx.get(f"{_DB_URL}/{table}", headers=headers, params=params, timeout=60.0)
    resp.raise_for_status()
    return resp.json()


def catalog_rank_targets(lookback_days: int = CATALOG_RANK_LOOKBACK_DAYS) -> dict:
    """{marketplace_id: sorted[asin]} for listings with activity in the window.

    Restricted to ACTIVE_MARKETPLACES: a marketplace we do not report on does
    not need its rank tracked, and pulling it would spend rate-limit budget the
    reported marketplaces need.
    """
    since = (date.today() - timedelta(days=lookback_days)).isoformat()
    by_marketplace: dict = {}
    page = 0
    while True:
        rows = _catalog_select_page(
            "amazon_asin_daily", "marketplace_id,asin",
            {"report_date": f"gte.{since}"}, page,
        )
        if not rows:
            break
        for r in rows:
            mid, asin = r.get("marketplace_id"), r.get("asin")
            if mid and asin and mid in ACTIVE_MARKETPLACES:
                by_marketplace.setdefault(mid, set()).add(asin)
        if len(rows) < _CATALOG_PAGE:
            break
        page += 1
    return {m: sorted(a) for m, a in sorted(by_marketplace.items())}


def _fetch_sales_rank(client, endpoint: str, asin: str, marketplace_id: str, limiter) -> tuple:
    """(status, salesRanks-entry-or-None) where status is 'ok' or 'not_found'.

    A 404 IS A NORMAL ABSENCE, NOT A FAILURE. The listing was pulled, or the
    ASIN sold here historically and no longer has a catalogue entry. Amazon
    returns a structured body for it:

      {"errors":[{"code":"NOT_FOUND","message":"Requested item, B0..., not
       found in marketplace(s) A1PA...."}]}

    The identical 404 also covers a genuinely wrong ASIN, so the two cannot be
    told apart from the status code alone. Both are recorded, neither raises.
    """
    # 429 IS RETRIED, NOT COUNTED AS A LOSS.
    # The first live run threw away 39 of 184 pairs to throttling because this
    # raised on 429 and the caller moved on. For a feed with a retention window
    # that is a re-run; for rank it is a permanent hole in the series, because
    # the API only ever returns today. The documented 2 req/sec is what
    # _RateLimiter is set to and the observed limit header agrees, but the quota
    # is shared with whatever else is calling the same endpoint — the ads and
    # sales/traffic jobs overlap on a 10-worker pool — so being locally correct
    # is not enough. Retry-After is honoured when Amazon sends it, following the
    # same pattern as the sales/traffic job.
    for attempt in range(1, CATALOG_RANK_THROTTLE_RETRIES + 1):
        limiter.acquire()
        resp = client.get(
            f"{endpoint}{CATALOG_RANK_PATH}/{asin}",
            params={"marketplaceIds": marketplace_id, "includedData": "salesRanks"},
        )
        if resp.status_code != 429:
            break
        try:
            wait = float(resp.headers.get("Retry-After", 0)) or (2.0 * attempt)
        except (TypeError, ValueError):
            wait = 2.0 * attempt
        logger.debug("catalog_rank: 429 on %s/%s, waiting %.1fs (attempt %d/%d)",
                     marketplace_id, asin, wait, attempt, CATALOG_RANK_THROTTLE_RETRIES)
        time.sleep(wait)

    if resp.status_code == 404:
        return "not_found", None
    resp.raise_for_status()
    for entry in resp.json().get("salesRanks") or []:
        if entry.get("marketplaceId") == marketplace_id:
            return "ok", entry
    # 200 with no entry for the marketplace asked about — distinct from a 404.
    # The ASIN exists here; it simply holds no rank yet (too new, or no
    # category assigned). Recorded as 'ok' with empty arrays so the absence of
    # a rank is visible rather than looking like a failed fetch.
    return "ok", None


def run_catalog_rank() -> None:
    """Daily sales-rank snapshot, one row per (asin, marketplace, date)."""
    pull_id = str(uuid.uuid4())
    snapshot_date = date.today().isoformat()
    logger.info("catalog_rank start pull_id=%s date=%s", pull_id, snapshot_date)

    targets = catalog_rank_targets()
    total = sum(len(v) for v in targets.values())
    logger.info(
        "catalog_rank: %d (marketplace, asin) pairs across %d marketplaces from %d days",
        total, len(targets), CATALOG_RANK_LOOKBACK_DAYS,
    )
    if not total:
        raise RuntimeError(
            "catalog_rank: no (marketplace, asin) pairs in the last "
            f"{CATALOG_RANK_LOOKBACK_DAYS} days of amazon_asin_daily. Rank has no history, "
            "so a silent no-op day is a permanent hole — failing instead."
        )

    creds = get_secrets(["amazon-sp-api-client-id", "amazon-sp-api-client-secret"])
    cid, csec = creds["amazon-sp-api-client-id"], creds["amazon-sp-api-client-secret"]

    counts = {"ok": 0, "no_rank": 0, "not_found": 0, "error": 0}
    batch: list = []

    # Iterated by ACCOUNT, not by marketplace. The seven EU marketplaces span
    # two seller identities (UK under EU, the rest under EU-2) with separate
    # refresh tokens, and accounts sharing an endpoint must not share a
    # rate-limit bucket — the same reason _RateLimiter is per-account for
    # orders, inventory and listings.
    for account_name, cfg in ACCOUNTS.items():
        mkts = [m for (m, _c, _s) in cfg["marketplaces"]
                if m in ACTIVE_MARKETPLACES and m in targets]
        if not mkts:
            continue
        try:
            secret_name = cfg["refresh_token_secret"]
            rt = get_secrets([secret_name])[secret_name]
        except Exception as exc:
            # Skipped, not fatal: one account without a token must not cost the
            # others their snapshot, and today's rank cannot be re-fetched later.
            skipped = sum(len(targets[m]) for m in mkts)
            counts["error"] += skipped
            logger.error("catalog_rank: %s refresh token unavailable (%s) — skipping %d pairs",
                         account_name, str(exc)[:120], skipped)
            continue

        token = _get_access_token(cid, csec, rt)
        limiter = _RateLimiter(CATALOG_RANK_RATE, CATALOG_RANK_BURST)
        headers = {"x-amz-access-token": token, "Accept": "application/json"}

        with httpx.Client(headers=headers, timeout=30.0) as client:
            for marketplace_id in mkts:
                label = _MARKETPLACE_LABEL.get(marketplace_id, marketplace_id)
                for asin in targets[marketplace_id]:
                    try:
                        status, entry = _fetch_sales_rank(
                            client, cfg["endpoint"], asin, marketplace_id, limiter)
                    except Exception as exc:
                        counts["error"] += 1
                        logger.warning("catalog_rank: %s %s failed: %s",
                                       label, asin, str(exc)[:200])
                        continue

                    if status == "not_found":
                        counts["not_found"] += 1
                    elif entry is None:
                        counts["no_rank"] += 1
                    else:
                        counts["ok"] += 1

                    # marketplace_id / marketplace_name / date are STAMPED ON.
                    # The catalogue response nests the marketplace inside
                    # salesRanks and carries no date at all, so putting both on
                    # the row means no consumer has to infer either — the same
                    # rule applied to the amazon_ads rows.
                    batch.append({
                        "source": SOURCE,
                        "record_type": CATALOG_RANK_RECORD_TYPE,
                        "source_record_id": f"{marketplace_id}_{asin}_{snapshot_date}",
                        "data": {
                            "asin": asin,
                            "marketplace_id": marketplace_id,
                            "marketplace_name": label,
                            "date": snapshot_date,
                            "status": status,
                            "classificationRanks": (entry or {}).get("classificationRanks") or [],
                            "displayGroupRanks": (entry or {}).get("displayGroupRanks") or [],
                        },
                        "last_pull_id": pull_id,
                    })
                    if len(batch) >= 500:
                        upsert_clean_batch(batch)
                        batch = []

    if batch:
        upsert_clean_batch(batch)

    write_raw(
        source=SOURCE, pull_id=pull_id,
        endpoint=f"{CATALOG_RANK_PATH}/salesRanks",
        response_body={"date": snapshot_date, "pairs": total, **counts},
        response_status=200, connector_version=VERSION,
    )
    logger.info("catalog_rank complete pull_id=%s %s", pull_id, counts)

    # A run that ranked nothing is a failed run. Rank cannot be backfilled, so
    # "completed, wrote only absences" has to reach the incident log the first
    # night rather than being found a month later as a hole in the series.
    if counts["ok"] == 0:
        raise RuntimeError(
            f"catalog_rank obtained no ranks at all for {snapshot_date} across {total} pairs; "
            f"counts={counts}. Rank is a point-in-time snapshot with no retention window, so "
            f"this day cannot be recovered by re-running later."
        )
