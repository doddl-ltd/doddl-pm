"""Meta Ads connector — campaign, ad set, and insights sync.

Pulls campaign/ad set metadata and last-30-day performance insights from the
Meta Marketing API. Credentials fetched from Azure Key Vault on every run.

Secrets required:
  meta-ads-access-token  — Long-lived user access token (60-day expiry; rotate via Meta)
  meta-ads-account-id    — Ad account ID (digits only, without "act_" prefix)
"""

import json
import logging
import uuid
from typing import Iterator

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from connectors.lib.secrets import get_secrets
from connectors.lib.db import write_raw, upsert_clean

logger = logging.getLogger(__name__)

VERSION = "1.0.0"
SOURCE = "meta_ads"
GRAPH_BASE = "https://graph.facebook.com"
API_VERSION = "v18.0"

CAMPAIGN_FIELDS = (
    "id,name,status,objective,daily_budget,lifetime_budget,"
    "start_time,stop_time,created_time,updated_time"
)
ADSET_FIELDS = (
    "id,name,status,campaign_id,daily_budget,lifetime_budget,"
    "start_time,end_time,targeting,created_time,updated_time"
)
INSIGHT_FIELDS = (
    "campaign_id,campaign_name,adset_id,adset_name,"
    "impressions,clicks,spend,reach,cpm,cpc,ctr,actions,"
    "date_start,date_stop"
)


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    retry=retry_if_exception_type(httpx.HTTPStatusError),
    reraise=True,
)
def _get(client: httpx.Client, path: str, params: dict) -> dict:
    resp = client.get(f"{GRAPH_BASE}/{API_VERSION}{path}", params=params)
    resp.raise_for_status()
    return resp.json()


def _paginate(client: httpx.Client, path: str, params: dict) -> Iterator[dict]:
    """Yield all pages from a Meta cursor-paginated endpoint."""
    page = _get(client, path, params)
    yield page
    while True:
        next_url = page.get("paging", {}).get("next")
        if not next_url:
            break
        resp = client.get(next_url)
        resp.raise_for_status()
        page = resp.json()
        yield page


def run() -> None:
    pull_id = str(uuid.uuid4())
    logger.info("meta_ads.run start pull_id=%s", pull_id)

    creds = get_secrets(["meta-ads-access-token", "meta-ads-account-id"])
    token = creds["meta-ads-access-token"]
    # Strip any existing "act_" prefix — vault value may include it already
    account_id = creds["meta-ads-account-id"].removeprefix("act_")

    with httpx.Client(timeout=30.0) as client:
        _sync_campaigns(client, pull_id, token, account_id)
        _sync_adsets(client, pull_id, token, account_id)
        _sync_insights(client, pull_id, token, account_id)
    logger.info("meta_ads.run complete pull_id=%s", pull_id)


def _sync_campaigns(
    client: httpx.Client, pull_id: str, token: str, account_id: str
) -> None:
    params = {"fields": CAMPAIGN_FIELDS, "access_token": token, "limit": 100}
    count = 0
    for page in _paginate(client, f"/act_{account_id}/campaigns", params):
        write_raw(
            source=SOURCE, pull_id=pull_id, endpoint=f"/act_{account_id}/campaigns",
            response_body=page, response_status=200, connector_version=VERSION,
        )
        for campaign in page.get("data", []):
            upsert_clean(
                source=SOURCE, record_type="campaign",
                source_record_id=campaign["id"], data=campaign, pull_id=pull_id,
            )
            count += 1
    logger.info("meta_ads: %d campaigns synced pull_id=%s", count, pull_id)


def _sync_adsets(
    client: httpx.Client, pull_id: str, token: str, account_id: str
) -> None:
    params = {"fields": ADSET_FIELDS, "access_token": token, "limit": 100}
    count = 0
    for page in _paginate(client, f"/act_{account_id}/adsets", params):
        write_raw(
            source=SOURCE, pull_id=pull_id, endpoint=f"/act_{account_id}/adsets",
            response_body=page, response_status=200, connector_version=VERSION,
        )
        for adset in page.get("data", []):
            upsert_clean(
                source=SOURCE, record_type="adset",
                source_record_id=adset["id"], data=adset, pull_id=pull_id,
            )
            count += 1
    logger.info("meta_ads: %d ad sets synced pull_id=%s", count, pull_id)


def _sync_insights(
    client: httpx.Client, pull_id: str, token: str, account_id: str,
    time_range: dict | None = None,
) -> None:
    if time_range:
        params = {
            "level": "adset",
            "time_range": json.dumps(time_range),
            "fields": INSIGHT_FIELDS,
            "access_token": token,
            "limit": 100,
        }
    else:
        params = {
            "level": "adset",
            "date_preset": "last_30d",
            "fields": INSIGHT_FIELDS,
            "access_token": token,
            "limit": 100,
        }
    count = 0
    for page in _paginate(client, f"/act_{account_id}/insights", params):
        write_raw(
            source=SOURCE, pull_id=pull_id, endpoint=f"/act_{account_id}/insights",
            response_body=page, response_status=200, connector_version=VERSION,
        )
        for insight in page.get("data", []):
            record_id = (
                f"{insight.get('adset_id', insight.get('campaign_id', 'unknown'))}"
                f"_{insight.get('date_start', 'unknown')}"
            )
            upsert_clean(
                source=SOURCE, record_type="adset_insight",
                source_record_id=record_id, data=insight, pull_id=pull_id,
            )
            count += 1
    logger.info("meta_ads: %d insight rows synced pull_id=%s", count, pull_id)


# ---------------------------------------------------------------------------
# Backfill entry point
# ---------------------------------------------------------------------------

def run_backfill(start_date, end_date) -> None:
    """Pull ad-set insights for the specified date range.

    Campaigns and ad sets are structural metadata already synced by run();
    this function only fetches historical performance insights.
    """
    pull_id = str(uuid.uuid4())
    logger.info("meta_ads.run_backfill %s to %s pull_id=%s", start_date, end_date, pull_id)

    creds = get_secrets(["meta-ads-access-token", "meta-ads-account-id"])
    token = creds["meta-ads-access-token"]
    account_id = creds["meta-ads-account-id"].removeprefix("act_")
    time_range = {
        "since": start_date.strftime("%Y-%m-%d"),
        "until": end_date.strftime("%Y-%m-%d"),
    }

    with httpx.Client(timeout=60.0) as client:
        _sync_insights(client, pull_id, token, account_id, time_range=time_range)
    logger.info("meta_ads.run_backfill complete pull_id=%s", pull_id)
