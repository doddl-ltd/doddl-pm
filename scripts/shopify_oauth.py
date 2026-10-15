"""
Shopify OAuth flow — captures store access token for the doddl-ai-os app.

This script:
1. Opens the Shopify OAuth authorization URL in your browser
2. Starts a local server on localhost:3456 to catch the callback
3. Exchanges the authorization code for an access token
4. Saves the token to Azure Key Vault as 'shopify-access-token'

Prerequisites:
  - 'http://localhost:3456/callback' must be in the app's Allowed Redirect URLs
    (Partners Dashboard → doddl-ai-os → Configuration)
  - doddl-ai-os must be UNINSTALLED from doddl-ltd.myshopify.com first
  - AZURE_KEYVAULT_URI must be set

Usage:
    python scripts/shopify_oauth.py
"""

import os
import sys
import secrets
import hashlib
import hmac
import urllib.parse
import webbrowser
from http.server import HTTPServer, BaseHTTPRequestHandler
from threading import Thread

import httpx

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

from connectors.lib.secrets import get_secrets

SHOP = "doddl-ltd.myshopify.com"
SCOPES = "read_orders,read_products,read_customers,read_analytics"
REDIRECT_URI = "http://localhost:3456/callback"
PORT = 3456

# Received via callback
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
        <h2>Shopify OAuth complete</h2>
        <p>Authorization code received. You can close this tab and return to the terminal.</p>
        </body></html>
        """)

    def log_message(self, format, *args):
        pass  # suppress server log noise


def _save_token_to_vault(token: str) -> None:
    try:
        from azure.keyvault.secrets import SecretClient
        from azure.identity import DefaultAzureCredential
        vault_uri = os.environ["AZURE_KEYVAULT_URI"]
        client = SecretClient(vault_url=vault_uri, credential=DefaultAzureCredential())
        client.set_secret("shopify-access-token", token)
        print(f"\n[OK] Saved 'shopify-access-token' to Key Vault: {vault_uri}")
    except Exception as e:
        print(f"\n[FAIL] Could not save to Key Vault: {e}")
        print(f"       Token (save manually): {token}")


def main():
    vault_uri = os.environ.get("AZURE_KEYVAULT_URI")
    if not vault_uri:
        print("ERROR: AZURE_KEYVAULT_URI is not set.")
        sys.exit(1)

    print("Fetching app credentials from Key Vault...")
    creds = get_secrets(["shopify-client-id", "shopify-client-secret"])
    client_id = creds["shopify-client-id"]
    client_secret = creds["shopify-client-secret"]

    # Generate a random state for CSRF protection
    state = secrets.token_urlsafe(16)

    auth_url = (
        f"https://{SHOP}/admin/oauth/authorize"
        f"?client_id={client_id}"
        f"&scope={SCOPES}"
        f"&redirect_uri={REDIRECT_URI}"
        f"&state={state}"
    )

    # Start local callback server in background
    server = HTTPServer(("localhost", PORT), CallbackHandler)
    thread = Thread(target=server.handle_request, daemon=True)
    thread.start()

    print(f"\nOpening Shopify authorization in your browser...")
    print(f"If the browser doesn't open, visit:\n  {auth_url}\n")
    webbrowser.open(auth_url)

    # Wait for callback
    thread.join(timeout=120)
    server.server_close()

    if not _code:
        print("\nERROR: No authorization code received within 2 minutes.")
        sys.exit(1)

    # Validate state
    if _state_received != state:
        print(f"\nERROR: State mismatch (CSRF check failed).")
        sys.exit(1)

    print(f"Authorization code received. Exchanging for access token...")

    # Exchange code for access token
    resp = httpx.post(
        f"https://{SHOP}/admin/oauth/access_token",
        json={
            "client_id": client_id,
            "client_secret": client_secret,
            "code": _code,
        },
        timeout=15.0,
    )
    resp.raise_for_status()
    data = resp.json()
    token = data.get("access_token")

    if not token:
        print(f"ERROR: No access_token in response: {data}")
        sys.exit(1)

    print(f"\nAccess token obtained (first 10 chars): {token[:10]}...")
    print(f"Scopes granted: {data.get('scope', 'unknown')}")

    _save_token_to_vault(token)

    print("\nDone. Update shopify.py to use 'shopify-access-token' secret.")


if __name__ == "__main__":
    main()
