"""PM incident task creation on connector job failure (P1-12)."""

import logging

import httpx

from connectors.lib.secrets import get_secret

logger = logging.getLogger(__name__)

# Phase 1: Data Pipeline project
_PM_PROJECT_ID = "10000000-0000-0000-0000-000000000003"


def create_incident_task(job_id: str, exception: Exception) -> None:
    """Create a high-priority incident task in the PM tool for a failed connector job.

    Uses the same vault secrets as breach alerts — same PM URL and service key.
    Fails silently (logs only) so alerting never crashes the scheduler.
    """
    try:
        pm_url = get_secret("breach-alert-pm-api-url")
        service_key = get_secret("breach-alert-agent-service-key")
    except Exception as e:
        logger.error("alerting: failed to fetch PM credentials from vault — %s", e)
        return

    payload = {
        "title": f"CONNECTOR ERROR: {job_id}",
        "description": (
            f"Connector job `{job_id}` failed.\n\n"
            f"**Error:** `{type(exception).__name__}: {exception}`\n\n"
            "Check connector logs for full traceback."
        ),
        "status": "not_started",
        "priority": "high",
        "project_id": _PM_PROJECT_ID,
    }

    try:
        resp = httpx.post(
            f"{pm_url}/api/agent/tasks",
            json=payload,
            headers={
                "Authorization": f"Bearer {service_key}",
                "X-Agent-Id": "connector-error-alerting",
            },
            timeout=10.0,
        )
        resp.raise_for_status()
        logger.info("alerting: incident task created for job %s", job_id)
    except Exception as e:
        logger.error("alerting: failed to create PM incident task for %s — %s", job_id, e)
