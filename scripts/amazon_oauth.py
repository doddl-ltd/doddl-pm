"""
Amazon SP-API OAuth flow — captures LWA refresh token for the doddl-ai-os app.

This script:
1. Starts a local server on localhost:3457 to catch the OAuth callback
2. Opens the Seller Central authorization URL in your browser
3. You click "Authorize" in Seller Central (logged in as the doddl seller account)
4. Amazon redirects to localhost with spapi_oauth_code
5. Script exchanges that code for access_token + refresh_token via LWA
6. Saves refresh_token to Azure Key Vault as 'amazon-sp-api-refresh-token'

Prerequisites:
  - App must be approved in SPP (doddl ai os is already approved)
  - 'http://localhost:3457/callback' must be added as the app's OAuth redirect URI
    in SPP: doddl ai os → Edit App → OAuth Redirect URI
  - AZURE_KEYVAULT_URI must be set

Usage:
    set AZURE_KEYVAULT_URI=https://doddl-kv-prod.vault.azure.net/
    python scripts/amazon_oauth.py
"""

import os
import sys
import secrets
import urllib.parse
import webbrowser
from http.server import HTTPServer, BaseHTTPRequestHandler
from threading import Thread

import httpx

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

from connectors.lib.secrets import get_secrets

# Amazon UK Seller Central
SELLER_CENTRAL_URL = "https://sellercentral.amazon.co.uk"
LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token"
REDIRECT_URI = "http://localhost:3457/callback"
PORT = 3457

_oauth_code = None
_state_received = None
_selling_partner_id = None


class CallbackHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        global _oauth_code, _state_received, _selling_partner_id
        parsed = urllib.parse.urlparse(self.path)
        params = dict(urllib.parse.parse_qsl(parsed.query))
        _oauth_code = params.get("spapi_oauth_code")
        _state_received = params.get("state")
        _selling_partner_id = params.get("selling_partner_id")

        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(b"""
        <html><body style="font-family:sans-serif;padding:40px;background:#0f0f0f;color:#fff">
        <h2>Amazon SP-API OAuth complete</h2>
        <p>Authorization code received. You can close this tab and return to the terminal.</p>
        </body></html>
        """)

    def log_message(self, format, *args):
        pass


def _save_to_vault(secret_name: str, value: str, vault_uri: str) -> None:
    try:
        from azure.keyvault.secrets import SecretClient
        from azure.identity import DefaultAzureCredential
        client = SecretClient(vault_url=vault_uri, credential=DefaultAzureCredential())
        client.set_secret(secret_name, value)
        print(f"  [OK] Saved '{secret_name}' to {vault_uri}")
    except Exception as e:
        print(f"  [FAIL] Could not save '{secret_name}': {e}")
        print(f"         Value (save manually): {value[:20]}...")


def main():
    vault_uri = os.environ.get("AZURE_KEYVAULT_URI")
    if not vault_uri:
        print("ERROR: AZURE_KEYVAULT_URI is not set.")
        sys.exit(1)

    print("Fetching app credentials from Key Vault...")
    creds = get_secrets([
        "amazon-sp-api-client-id",
        "amazon-sp-api-client-secret",
    ])
    client_id = creds["amazon-sp-api-client-id"]
    client_secret = creds["amazon-sp-api-client-secret"]

    state = secrets.token_urlsafe(16)

    # Seller Central authorization URL
    auth_url = (
        f"{SELLER_CENTRAL_URL}/apps/authorize/consent"
        f"?application_id={client_id}"
        f"&state={state}"
        f"&version=beta"
    )

    # Start local callback server
    server = HTTPServer(("localhost", PORT), CallbackHandler)
    thread = Thread(target=server.handle_request, daemon=True)
    thread.start()

    print(f"\nOpening Amazon Seller Central authorization in your browser...")
    print(f"Make sure you are logged in as the doddl seller account.\n")
    print(f"If the browser doesn't open, visit:\n  {auth_url}\n")
    webbrowser.open(auth_url)

    print("Waiting for authorization (up to 3 minutes)...")
    thread.join(timeout=180)
    server.server_close()

    if not _oauth_code:
        print("\nERROR: No authorization code received within 3 minutes.")
        print("If Amazon redirected to a different URL, copy the full URL and")
        print("look for '?spapi_oauth_code=...' in it, then re-run this script")
        print("after adding http://localhost:3457/callback as the OAuth redirect URI.")
        sys.exit(1)

    if _state_received != state:
        print(f"\nERROR: State mismatch (CSRF check failed).")
        sys.exit(1)

    print(f"Authorization code received.")
    if _selling_partner_id:
        print(f"Selling Partner ID: {_selling_partner_id}")

    # Exchange code for tokens via LWA
    print("Exchanging authorization code for tokens...")
    resp = httpx.post(
        LWA_TOKEN_URL,
        data={
            "grant_type": "authorization_code",
            "code": _oauth_code,
            "redirect_uri": REDIRECT_URI,
            "client_id": client_id,
            "client_secret": client_secret,
        },
        timeout=15.0,
    )
    resp.raise_for_status()
    data = resp.json()

    refresh_token = data.get("refresh_token")
    access_token = data.get("access_token")

    if not refresh_token:
        print(f"ERROR: No refresh_token in response: {data}")
        sys.exit(1)

    print(f"\nTokens obtained:")
    print(f"  refresh_token (first 20): {refresh_token[:20]}...")
    print(f"  access_token  (first 20): {access_token[:20] if access_token else 'none'}...")

    print(f"\nSaving to vault: {vault_uri}")
    _save_to_vault("amazon-sp-api-refresh-token", refresh_token, vault_uri)

    # Also save to staging vault if different
    staging_uri = "https://doddl-kv-staging.vault.azure.net/"
    if staging_uri != vault_uri:
        print(f"\nSaving to staging vault: {staging_uri}")
        _save_to_vault("amazon-sp-api-refresh-token", refresh_token, staging_uri)

    print("\nDone. amazon-sp-api-refresh-token is now in Key Vault.")
    print("The Amazon SP-API connector will pick it up on the next run.")


if __name__ == "__main__":
    main()
