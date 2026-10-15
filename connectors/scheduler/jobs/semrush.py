"""SEMrush connector — domain analytics and keyword rankings sync.

Pulls organic search overview, top organic keywords and backlink summary
for the doddl domain. Data is non-incremental (point-in-time snapshot).

Secrets required:
  semrush-api-key  — SEMrush API key (from Account → API Units)
  semrush-domain   — Root domain to query, e.g. doddl.com
"""

import logging
import uuid
from datetime import date

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from connectors.lib.secrets import get_secrets
from connectors.lib.db import write_raw, upsert_clean

logger = logging.getLogger(__name__)

VERSION = "1.0.0"
SOURCE = "semrush"
API_BASE = "https://api.semrush.com"


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    retry=retry_if_exception_type(httpx.HTTPStatusError),
    reraise=True,
)
def _get(client: httpx.Client, params: dict) -> str:
    resp = client.get(API_BASE, params=params)
    resp.raise_for_status()
    return resp.text


def _parse_csv(text: str) -> list[dict]:
    """Parse SEMrush semicolon-delimited CSV response into list of dicts."""
    lines = [l for l in text.strip().splitlines() if l]
    if len(lines) < 2:
        return []
    headers = lines[0].split(";")
    rows = []
    for line in lines[1:]:
        values = line.split(";")
        rows.append(dict(zip(headers, values)))
    return rows


def run() -> None:
    pull_id = str(uuid.uuid4())
    logger.info("semrush.run start pull_id=%s", pull_id)

    creds = get_secrets(["semrush-api-key", "semrush-domain"])
    api_key = creds["semrush-api-key"]
    domain = creds["semrush-domain"]

    with httpx.Client(timeout=30.0) as client:
        _sync_domain_overview(client, pull_id, api_key, domain)
        _sync_organic_keywords(client, pull_id, api_key, domain)
        _sync_backlinks_overview(client, pull_id, api_key, domain)
    logger.info("semrush.run complete pull_id=%s", pull_id)


def _sync_domain_overview(
    client: httpx.Client, pull_id: str, api_key: str, domain: str
) -> None:
    params = {
        "type": "domain_ranks",
        "key": api_key,
        "domain": domain,
        "database": "uk",
        "export_columns": "Dn,Rk,Or,Ot,Oc,Ad,At,Ac,Sh,Sv",
        "display_limit": 1,
    }
    text = _get(client, params)
    rows = _parse_csv(text)

    write_raw(
        source=SOURCE, pull_id=pull_id, endpoint="domain_ranks",
        response_body={"raw": text, "rows": rows},
        response_status=200, connector_version=VERSION,
    )
    snapshot_date = date.today().isoformat()
    for row in rows:
        row["snapshot_date"] = snapshot_date
        upsert_clean(
            source=SOURCE, record_type="domain_overview",
            source_record_id=f"{domain}_{snapshot_date}",
            data=row, pull_id=pull_id,
        )
    logger.info("semrush: domain overview synced pull_id=%s", pull_id)


def _sync_organic_keywords(
    client: httpx.Client, pull_id: str, api_key: str, domain: str
) -> None:
    params = {
        "type": "domain_organic",
        "key": api_key,
        "domain": domain,
        "database": "uk",
        "export_columns": "Ph,Po,Pp,Pd,Nq,Cp,Ur,Tr,Tc,Co,Nr,Td",
        "display_limit": 1000,
        "display_sort": "tr_desc",
    }
    text = _get(client, params)
    rows = _parse_csv(text)

    write_raw(
        source=SOURCE, pull_id=pull_id, endpoint="domain_organic",
        response_body={"raw": text, "count": len(rows)},
        response_status=200, connector_version=VERSION,
    )
    snapshot_date = date.today().isoformat()
    for row in rows:
        keyword = row.get("Keyword", row.get("Ph", "unknown"))
        row["snapshot_date"] = snapshot_date
        upsert_clean(
            source=SOURCE, record_type="organic_keyword",
            source_record_id=f"{domain}_{keyword}_{snapshot_date}",
            data=row, pull_id=pull_id,
        )
    logger.info("semrush: %d organic keywords synced pull_id=%s", len(rows), pull_id)


def _sync_backlinks_overview(
    client: httpx.Client, pull_id: str, api_key: str, domain: str
) -> None:
    params = {
        "type": "backlinks_overview",
        "key": api_key,
        "target": domain,
        "target_type": "root_domain",
        "export_columns": "ascore,total,domains_num,urls_num,ips_num,ipclassc_num,follows_num,nofollows_num",
    }
    text = _get(client, params)
    rows = _parse_csv(text)

    write_raw(
        source=SOURCE, pull_id=pull_id, endpoint="backlinks_overview",
        response_body={"raw": text, "rows": rows},
        response_status=200, connector_version=VERSION,
    )
    snapshot_date = date.today().isoformat()
    for row in rows:
        row["snapshot_date"] = snapshot_date
        upsert_clean(
            source=SOURCE, record_type="backlinks_overview",
            source_record_id=f"{domain}_{snapshot_date}",
            data=row, pull_id=pull_id,
        )
    logger.info("semrush: backlinks overview synced pull_id=%s", pull_id)
