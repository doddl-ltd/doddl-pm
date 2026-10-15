"""
Google OAuth2 flow — captures refresh token for GA4 + Search Console access.

This script:
1. Opens the Google OAuth authorization URL in your browser
2. Starts a local server on localhost:8765 to catch the callback
3. Exchanges the authorization code for tokens
4. Saves the refresh token to Azure Key Vault as 'google-oauth-refresh-token'

Scopes granted:
  - https://www.googleapis.com/auth/analytics.readonly  (GA4 Data API)
  - https://www.googleapis.com/auth/webmasters.readonly (Search Console API)

Prerequisites:
  - 'http://localhost:8765/callback' must be in the OAuth client's Authorized redirect URIs
    (Google Cloud Console -> APIs & Services -> Credentials -> doddl-ai-os -> Edit)
  - AZURE_KEYVAULT_URI must be set

Usage:
    python scripts/google_oauth.py
"""

import os
import sys
import secrets
import webbrowser
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler
from threading import Thread

import httpx

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

from connectors.lib.secrets import get_secrets

REDIRECT_URI = "http://localhost:8765/callback"
PORT = 8765

SCOPES = " ".join([
    "https://www.googleapis.com/auth/analytics.readonly",
    "https://www.googleapis.com/auth/webmasters.readonly",
    "https://www.googleapis.com/auth/adwords",
])

_code = None
_state_received = None


class CallbackHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        global _code, _state_received
        parsed = urllib.parse.urlparse(self.path)
        params = dict(urllib.parse.parse_qsl(parsed.query))
        _code = params.get("code")
        _state_received = params.get("state")

        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(b"""
        <html><body style="font-family:sans-serif;padding:40px">
        <h2>Google OAuth complete</h2>
        <p>Authorization code received. You can close this tab and return to the terminal.</p>
        </body></html>
        """)

    def log_message(self, format, *args):
        pass


def _save_to_vault(name: str, value: str) -> None:
    try:
        from connectors.lib.secrets import _get_client
        client = _get_client()
        client.set_secret(name, value)
        vault_uri = os.environ["AZURE_KEYVAULT_URI"]
        print(f"[OK] Saved '{name}' to Key Vault: {vault_uri}")
    except Exception as e:
        print(f"[FAIL] Could not save '{name}' to Key Vault: {e}")
        print(f"       Value (save manually): {value[:20]}...")


def main():
    vault_uri = os.environ.get("AZURE_KEYVAULT_URI")
    if not vault_uri:
        print("ERROR: AZURE_KEYVAULT_URI is not set.")
        sys.exit(1)

    print("Fetching OAuth credentials from Key Vault...")
    creds = get_secrets(["google-oauth-client-id", "google-oauth-client-secret"])
    client_id = creds["google-oauth-client-id"]
    client_secret = creds["google-oauth-client-secret"]

    state = secrets.token_urlsafe(16)

    auth_url = (
        "https://accounts.google.com/o/oauth2/v2/auth"
        f"?client_id={client_id}"
        f"&redirect_uri={REDIRECT_URI}"
        f"&response_type=code"
        f"&scope={urllib.parse.quote(SCOPES)}"
        f"&access_type=offline"
        f"&prompt=consent"
        f"&state={state}"
    )

    server = HTTPServer(("localhost", PORT), CallbackHandler)
    thread = Thread(target=server.handle_request, daemon=True)
    thread.start()

    print(f"\nOpening Google authorization in your browser...")
    print(f"If the browser doesn't open, visit:\n  {auth_url}\n")
    webbrowser.open(auth_url)

    thread.join(timeout=120)
    server.server_close()

    if not _code:
        print("\nERROR: No authorization code received within 2 minutes.")
        sys.exit(1)

    if _state_received != state:
        print("\nERROR: State mismatch (CSRF check failed).")
        sys.exit(1)

    print("Authorization code received. Exchanging for tokens...")

    resp = httpx.post(
        "https://oauth2.googleapis.com/token",
        data={
            "code": _code,
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": REDIRECT_URI,
            "grant_type": "authorization_code",
        },
        timeout=15.0,
    )
    resp.raise_for_status()
    data = resp.json()

    refresh_token = data.get("refresh_token")
    if not refresh_token:
        print(f"ERROR: No refresh_token in response: {data}")
        print("Tip: revoke app access at myaccount.google.com/permissions and re-run.")
        sys.exit(1)

    print(f"\nRefresh token obtained (first 20 chars): {refresh_token[:20]}...")
    print(f"Scope granted: {data.get('scope', 'unknown')}")

    _save_to_vault("google-oauth-refresh-token", refresh_token)
    _save_to_vault("google-ads-refresh-token", refresh_token)

    print("\nDone. GA4, Search Console, and Google Ads connectors will use this refresh token.")


if __name__ == "__main__":
    main()
