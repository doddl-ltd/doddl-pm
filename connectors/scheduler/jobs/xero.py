"""Xero connector — invoices, contacts and payments sync.

Incremental: pulls records modified since the last successful pull (or 90 days
on first run). Access token refreshed from stored refresh token on every run.

Note: Xero refresh tokens are rolling — each refresh issues a new refresh
token valid for 60 days. The new token must be saved back to Key Vault to
prevent expiry. This connector fetches the new refresh token and updates the
secret in-place via the Key Vault SDK.

Secrets required:
  xero-client-id      — OAuth2 client ID from Xero developer portal
  xero-client-secret  — OAuth2 client secret
  xero-refresh-token  — OAuth2 refresh token (scope: accounting.transactions.read
                         accounting.contacts.read)
  xero-tenant-id      — Xero organisation/tenant ID (UUID)
"""

import base64
import logging
import os
import uuid
from datetime import datetime, timezone, timedelta
from typing import Iterator

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from connectors.lib.secrets import get_secrets
from connectors.lib.db import write_raw, upsert_clean, last_pull_ts

logger = logging.getLogger(__name__)

VERSION = "1.0.0"
SOURCE = "xero"
TOKEN_URL = "https://identity.xero.com/connect/token"
API_BASE = "https://api.xero.com/api.xro/2.0"
PAGE_SIZE = 100


def _xero_token_refresh(client_id: str, client_secret: str, refresh_token: str) -> tuple[str, str]:
    """Refresh Xero access token. Returns (access_token, new_refresh_token)."""
    credentials = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    resp = httpx.post(
        TOKEN_URL,
        headers={
            "Authorization": f"Basic {credentials}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        data={"grant_type": "refresh_token", "refresh_token": refresh_token},
        timeout=15.0,
    )
    resp.raise_for_status()
    data = resp.json()
    return data["access_token"], data["refresh_token"]


def _save_new_refresh_token(new_token: str) -> None:
    """Persist the new rolling refresh token back to Key Vault."""
    try:
        from azure.keyvault.secrets import SecretClient
        from azure.identity import DefaultAzureCredential
        vault_uri = os.environ["AZURE_KEYVAULT_URI"]
        client = SecretClient(vault_url=vault_uri, credential=DefaultAzureCredential())
        client.set_secret("xero-refresh-token", new_token)
        logger.info("xero: refresh token rotated and saved to Key Vault")
    except Exception as e:
        logger.error("xero: failed to save rotated refresh token — %s", e)


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    retry=retry_if_exception_type(httpx.HTTPStatusError),
    reraise=True,
)
def _get(client: httpx.Client, path: str, params: dict | None = None) -> dict:
    resp = client.get(f"{API_BASE}/{path}", params=params)
    resp.raise_for_status()
    return resp.json()


def _paginate(client: httpx.Client, path: str, params: dict) -> Iterator[list]:
    """Yield pages of records from a Xero paginated endpoint."""
    page = 1
    while True:
        data = _get(client, path, {**params, "page": page})
        # Xero wraps results in a key matching the entity name
        for key, value in data.items():
            if isinstance(value, list):
                if not value:
                    return
                yield value
                break
        else:
            return
        page += 1


def run() -> None:
    pull_id = str(uuid.uuid4())
    logger.info("xero.run start pull_id=%s", pull_id)

    creds = get_secrets([
        "xero-client-id",
        "xero-client-secret",
        "xero-refresh-token",
        "xero-tenant-id",
    ])

    access_token, new_refresh_token = _xero_token_refresh(
        creds["xero-client-id"],
        creds["xero-client-secret"],
        creds["xero-refresh-token"],
    )
    # Persist rotated refresh token immediately
    _save_new_refresh_token(new_refresh_token)

    tenant_id = creds["xero-tenant-id"]
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Xero-tenant-id": tenant_id,
        "Accept": "application/json",
    }

    since = last_pull_ts(SOURCE) or (
        datetime.now(timezone.utc) - timedelta(days=90)
    ).isoformat()

    with httpx.Client(headers=headers, timeout=30.0) as client:
        _sync_invoices(client, pull_id, since)
        _sync_contacts(client, pull_id, since)
        _sync_payments(client, pull_id, since)
    logger.info("xero.run complete pull_id=%s", pull_id)


def _sync_invoices(client: httpx.Client, pull_id: str, since: str) -> None:
    params = {
        "where": f'UpdatedDateUTC>=DateTime.Parse("{since}")',
        "order": "UpdatedDateUTC ASC",
    }
    count = 0
    for page in _paginate(client, "Invoices", params):
        write_raw(
            source=SOURCE, pull_id=pull_id, endpoint="Invoices",
            response_body={"Invoices": page, "count": len(page)},
            response_status=200, connector_version=VERSION,
        )
        for invoice in page:
            upsert_clean(
                source=SOURCE, record_type="invoice",
                source_record_id=invoice["InvoiceID"],
                data=invoice, pull_id=pull_id,
            )
            count += 1
    logger.info("xero: %d invoices synced pull_id=%s", count, pull_id)


def _sync_contacts(client: httpx.Client, pull_id: str, since: str) -> None:
    params = {
        "where": f'UpdatedDateUTC>=DateTime.Parse("{since}")',
        "order": "UpdatedDateUTC ASC",
    }
    count = 0
    for page in _paginate(client, "Contacts", params):
        write_raw(
            source=SOURCE, pull_id=pull_id, endpoint="Contacts",
            response_body={"Contacts": page, "count": len(page)},
            response_status=200, connector_version=VERSION,
        )
        for contact in page:
            upsert_clean(
                source=SOURCE, record_type="contact",
                source_record_id=contact["ContactID"],
                data=contact, pull_id=pull_id,
            )
            count += 1
    logger.info("xero: %d contacts synced pull_id=%s", count, pull_id)


def _sync_payments(client: httpx.Client, pull_id: str, since: str) -> None:
    params = {
        "where": f'UpdatedDateUTC>=DateTime.Parse("{since}")',
        "order": "UpdatedDateUTC ASC",
    }
    count = 0
    for page in _paginate(client, "Payments", params):
        write_raw(
            source=SOURCE, pull_id=pull_id, endpoint="Payments",
            response_body={"Payments": page, "count": len(page)},
            response_status=200, connector_version=VERSION,
        )
        for payment in page:
            upsert_clean(
                source=SOURCE, record_type="payment",
                source_record_id=payment["PaymentID"],
                data=payment, pull_id=pull_id,
            )
            count += 1
    logger.info("xero: %d payments synced pull_id=%s", count, pull_id)
