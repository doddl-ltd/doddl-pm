"""Shared Google OAuth2 token refresh helper.

Used by Google Search Console and Google Analytics 4 connectors.
No SDK required — just a POST to the Google token endpoint.
"""

import httpx

TOKEN_URL = "https://oauth2.googleapis.com/token"


def refresh_access_token(client_id: str, client_secret: str, refresh_token: str) -> str:
    """Exchange a refresh token for a short-lived access token.

    Raises httpx.HTTPStatusError on failure (e.g. revoked token, bad creds).
    """
    resp = httpx.post(
        TOKEN_URL,
        data={
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        },
        timeout=15.0,
    )
    resp.raise_for_status()
    return resp.json()["access_token"]
