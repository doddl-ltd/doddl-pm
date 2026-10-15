"""Microsoft Clarity connector — session metrics sync.

Pulls daily engagement metrics (sessions, pageviews, rage clicks, dead clicks,
JS errors etc.) from the Microsoft Clarity Data Export API using a long-lived
JWT token.

Secrets required:
  clarity-api-token   — Clarity Data Export JWT (generated in Clarity Settings -> Data Export)
  clarity-project-id  — Clarity project ID (alphanumeric, from dashboard URL)
"""

import logging
import uuid
from datetime import date, timedelta

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from connectors.lib.secrets import get_secrets
from connectors.lib.db import write_raw, upsert_clean

logger = logging.getLogger(__name__)

VERSION = "1.2.0"
SOURCE = "microsoft_clarity"
API_BASE = "https://clarity.microsoft.com/api/exports/v1"


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    retry=retry_if_exception_type(httpx.HTTPStatusError),
    reraise=True,
)
def _get(client: httpx.Client, path: str, params=None) -> dict:
    resp = client.get(f"{API_BASE}{path}", params=params)
    if not resp.is_success:
        logger.error("clarity: %s %s -> %s", resp.status_code, path, resp.text)
    resp.raise_for_status()
    return resp.json()


def run() -> None:
    pull_id = str(uuid.uuid4())
    logger.info("microsoft_clarity.run start pull_id=%s", pull_id)

    creds = get_secrets([
        "clarity-api-token",
        "clarity-project-id",
    ])

    project_id = creds["clarity-project-id"]

    with httpx.Client(
        headers={"Authorization": f"Bearer {creds['clarity-api-token']}"},
        timeout=30.0,
    ) as client:
        _sync_metrics(client, pull_id, project_id)

    logger.info("microsoft_clarity.run complete pull_id=%s", pull_id)


def _sync_metrics(
    client: httpx.Client, pull_id: str, project_id: str,
    start_date=None, end_date=None,
) -> None:
    """Sync daily engagement metrics for the specified date range."""
    if end_date is None:
        end_date = date.today() - timedelta(days=1)
    if start_date is None:
        start_date = end_date - timedelta(days=30)

    # Clarity requires metrics as repeated query params, not comma-joined
    # httpx sends a list value as ?metrics=X&metrics=Y&...
    METRICS = [
        "TotalSessionCount",
        "TotalPageViewCount",
        "TotalEngagedSessionCount",
        "DeadClickCount",
        "RageClickCount",
        "ExcessiveScrollCount",
        "QuickBackCount",
        "JsErrorCount",
    ]
    params = [
        ("startDate", start_date.strftime("%Y-%m-%d")),
        ("endDate", end_date.strftime("%Y-%m-%d")),
        ("granularity", "daily"),
    ] + [("metrics", m) for m in METRICS]

    data = _get(client, f"/projects/{project_id}/metrics", params)

    write_raw(
        source=SOURCE, pull_id=pull_id, endpoint="/metrics",
        response_body=data, response_status=200, connector_version=VERSION,
    )

    metrics = data.get("metrics", [])
    count = 0
    for metric_day in metrics:
        day = metric_day.get("date", "unknown")
        record = {"date": day, **metric_day}
        upsert_clean(
            source=SOURCE, record_type="daily_metrics",
            source_record_id=f"{project_id}_{day}",
            data=record, pull_id=pull_id,
        )
        count += 1

    logger.info("microsoft_clarity: %d metric days synced pull_id=%s", count, pull_id)


# ---------------------------------------------------------------------------
# Backfill entry point
# ---------------------------------------------------------------------------

def run_backfill(start_date, end_date) -> None:
    """Pull daily engagement metrics for the specified date range."""
    pull_id = str(uuid.uuid4())
    logger.info("microsoft_clarity.run_backfill %s to %s pull_id=%s", start_date, end_date, pull_id)

    creds = get_secrets(["clarity-api-token", "clarity-project-id"])
    project_id = creds["clarity-project-id"]

    with httpx.Client(
        headers={"Authorization": f"Bearer {creds['clarity-api-token']}"},
        timeout=30.0,
    ) as client:
        _sync_metrics(client, pull_id, project_id, start_date, end_date)
    logger.info("microsoft_clarity.run_backfill complete pull_id=%s", pull_id)
