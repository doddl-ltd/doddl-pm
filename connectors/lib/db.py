"""Shared database helpers for connector jobs — Supabase REST API.

Writes to api_raw and api_clean via the PostgREST HTTP endpoint.
Auth: supabase-service-role-key-prod fetched from Key Vault on each call.

No psycopg2 / direct TCP connection — works with IPv4-only hosts by going
through Cloudflare's CDN layer in front of Supabase.
"""

import httpx

from connectors.lib.secrets import get_secret_cached

SUPABASE_URL = "https://ikcjciscttsvpxoijnqe.supabase.co/rest/v1"
_TIMEOUT = 30.0


def _key() -> str:
    # Cached: fetched once per process, not once per row
    return get_secret_cached("supabase-service-role-key-prod")


def _headers(key: str, prefer: str | None = None) -> dict:
    h = {
        "Authorization": f"Bearer {key}",
        "apikey": key,
        "Content-Type": "application/json",
    }
    if prefer:
        h["Prefer"] = prefer
    return h


def write_raw(
    *,
    source: str,
    pull_id: str,
    endpoint: str,
    response_body: dict,
    response_status: int,
    connector_version: str,
) -> None:
    key = _key()
    payload = {
        "source": source,
        "pull_id": pull_id,
        "endpoint": endpoint,
        "response_body": response_body,
        "response_status": response_status,
        "connector_version": connector_version,
    }
    resp = httpx.post(
        f"{SUPABASE_URL}/api_raw",
        headers=_headers(key, prefer="return=minimal"),
        json=payload,
        timeout=_TIMEOUT,
    )
    resp.raise_for_status()


def upsert_clean(
    *,
    source: str,
    record_type: str,
    source_record_id: str,
    data: dict,
    pull_id: str,
) -> None:
    key = _key()
    payload = {
        "source": source,
        "record_type": record_type,
        "source_record_id": source_record_id,
        "data": data,
        "last_pull_id": pull_id,
    }
    # on_conflict tells PostgREST which unique constraint to use for the upsert.
    # Without it, PostgREST defaults to the primary key (id), which we don't
    # provide — causing a 409 on second-run duplicates from the natural-key
    # constraint api_clean_unique_record(source, record_type, source_record_id).
    resp = httpx.post(
        f"{SUPABASE_URL}/api_clean?on_conflict=source,record_type,source_record_id",
        headers=_headers(key, prefer="resolution=merge-duplicates,return=minimal"),
        json=payload,
        timeout=_TIMEOUT,
    )
    resp.raise_for_status()


def upsert_clean_batch(records: list[dict]) -> None:
    """Upsert a list of api_clean records in a single POST (much faster than row-by-row).

    Each record must have keys: source, record_type, source_record_id, data, last_pull_id.
    PostgREST accepts an array body and upserts all rows atomically.
    """
    if not records:
        return
    key = _key()
    resp = httpx.post(
        f"{SUPABASE_URL}/api_clean?on_conflict=source,record_type,source_record_id",
        headers=_headers(key, prefer="resolution=merge-duplicates,return=minimal"),
        json=records,
        timeout=_TIMEOUT,
    )
    resp.raise_for_status()


def upsert_table(table: str, records: list[dict], on_conflict: str) -> None:
    """Generic upsert into any table via PostgREST — same shape as
    upsert_clean_batch but parameterized by table name and conflict columns,
    for connectors that need their own table instead of the generic api_clean
    schema (e.g. amazon_asin_daily). Added for the Amazon SP-API Sales & Traffic
    connector (rev 3) — existing upsert_clean/upsert_clean_batch are untouched.
    """
    if not records:
        return
    key = _key()
    resp = httpx.post(
        f"{SUPABASE_URL}/{table}?on_conflict={on_conflict}",
        headers=_headers(key, prefer="resolution=merge-duplicates,return=minimal"),
        json=records,
        timeout=_TIMEOUT,
    )
    resp.raise_for_status()


def select_rows(
    table: str,
    *,
    select: str = "*",
    filters: dict | None = None,
    order: str | None = None,
    limit: int | None = None,
) -> list[dict]:
    """Generic PostgREST GET for any table — mirrors last_pull_ts's existing
    select/filter/order/limit pattern, parameterized by table name.

    filters values are PostgREST filter strings ("eq.X", "gte.Y"); a list value
    produces a repeated query-string key (e.g. a date range: {"report_date":
    ["gte.2026-01-01", "lte.2026-01-31"]} -> ?report_date=gte...&report_date=lte...).
    """
    key = _key()
    params: dict = {"select": select}
    if filters:
        params.update(filters)
    if order:
        params["order"] = order
    if limit:
        params["limit"] = str(limit)
    resp = httpx.get(
        f"{SUPABASE_URL}/{table}",
        headers=_headers(key),
        params=params,
        timeout=_TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json()


def last_pull_ts(source: str) -> str | None:
    """Return ISO timestamp of the most recent api_raw row for a source, or None."""
    key = _key()
    resp = httpx.get(
        f"{SUPABASE_URL}/api_raw",
        headers=_headers(key),
        params={
            "select": "received_at",
            "source": f"eq.{source}",
            "order": "received_at.desc",
            "limit": "1",
        },
        timeout=_TIMEOUT,
    )
    resp.raise_for_status()
    rows = resp.json()
    return rows[0]["received_at"] if rows else None
