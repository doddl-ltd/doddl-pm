"""
Amazon SP-API OAuth helper — generate and store LWA refresh tokens.

Run this once per seller account to produce the refresh token that the
connector needs. Each account (EU, EU-2, NA, FE-JP, FE-AU, FE-SG) has
its own token because each is a separate Amazon seller identity.

Usage:
    python scripts/amazon_sp_oauth.py --account eu
    python scripts/amazon_sp_oauth.py --account eu-2
    python scripts/amazon_sp_oauth.py --account na
    python scripts/amazon_sp_oauth.py --account fe-jp
    python scripts/amazon_sp_oauth.py --account fe-au
    python scripts/amazon_sp_oauth.py --account fe-sg

    Add --print-only to any of the above to skip the Key Vault write and
    print the refresh token to stdout instead, for adding it via the portal
    by hand — added 2026-08-25 after the SDK write started failing with
    RemoteDisconnected on the write path specifically (read access already
    confirmed working). Not a permanent replacement for the normal path.

What this script does:
  1. Reads your LWA client_id and client_secret from Key Vault.
  2. Prints an authorization URL — open it in a browser while logged in to
     the target seller account on Seller Central.
  3. After you click Confirm, Amazon redirects your browser to a URL that
     contains ?spapi_oauth_code=...  Paste that full URL here.
  4. Exchanges the code for a refresh token via the LWA token endpoint.
  5. Stores the refresh token in Key Vault under the correct secret name —
     or, with --print-only, prints it instead and skips the write.

Pre-requisites:
  - AZURE_KEYVAULT_URI must point to doddl-kv-prod.
  - amazon-sp-api-client-id and amazon-sp-api-client-secret must already
    be in Key Vault (from the "View" link on the Solution Provider Portal).
  - The SP-API app must have an OAuth redirect URI registered. Use any URL
    you control — even https://localhost — the script only reads the code
    from the redirected URL, it does not need the server to be running.

Set AZURE_KEYVAULT_URI before running:
    $env:AZURE_KEYVAULT_URI = "https://doddl-kv-prod.vault.azure.net/"
"""

import argparse
import os
import sys
import secrets
import urllib.parse

import httpx

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

# ── App registration details ────────────────────────────────────────────────
APP_ID = "amzn1.sp.solution.9b36ab59-7298-4c1c-899e-598727e325e5"

# Seller Central authorization URLs per region
SELLERCENTRAL_URLS = {
    "eu":    "https://sellercentral.amazon.co.uk",
    "eu-2":  "https://sellercentral.amazon.co.uk",  # same region login front-end — confirm at login time
    "na":    "https://sellercentral.amazon.com",   # covers US + CA + MX (seller A2J3OJ1QMMOAR5)
    "fe-jp": "https://sellercentral.amazon.co.jp",
    "fe-au": "https://sellercentral.amazon.com.au",
    "fe-sg": "https://sellercentral.amazon.sg",
}

# Key Vault secret name that will be written for each account
SECRET_NAMES = {
    "eu":    "amazon-sp-api-refresh-token-eu",
    "eu-2":  "amazon-sp-api-refresh-token-eu-2",   # Doddl Europe — separate seller account, added 2026-08-25
    "na":    "amazon-sp-api-refresh-token-na-2",   # US/CA/MX share one seller account
    "fe-jp": "amazon-sp-api-refresh-token-fe-jp",
    "fe-au": "amazon-sp-api-refresh-token-fe-au",
    "fe-sg": "amazon-sp-api-refresh-token-fe-sg",
}

# Which Seller Central account to log in to
ACCOUNT_NOTES = {
    # Corrected 2026-08-25 — this used to claim A95LVHANDHOSF covers all 13 EU
    # markets. It doesn't: DE/FR/NL/PL/BE/IT/ES/IE/SE actually belong to a
    # second seller (A1TR5EU9D7ZMRC, "eu-2" below) that this app was never
    # authorised against. The old wording is exactly the wrong assumption
    # that caused those marketplaces to silently return zero real rows.
    "eu":    "Log in as your UK seller account (seller A95LVHANDHOSF, UK only)",
    "eu-2":  "Log in as Doddl Europe (seller A1TR5EU9D7ZMRC, covers DE/FR/NL/PL/BE/IT/ES/IE/SE)",
    "na":    "Log in as your NA seller account (seller A2J3OJ1QMMOAR5, covers US/CA/MX)",
    "fe-jp": "Log in as your Japan seller account (seller A3HUZ3EE07Z6DX)",
    "fe-au": "Log in as your Australia seller account (seller A1LAIASXD1QDDB)",
    "fe-sg": "Log in as your Singapore seller account (seller A3N8BDRT3JKMZ7)",
}

LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token"


def main() -> None:
    vault_uri = os.environ.get("AZURE_KEYVAULT_URI")
    if not vault_uri:
        print("ERROR: AZURE_KEYVAULT_URI is not set.")
        print("  Run:  $env:AZURE_KEYVAULT_URI = \"https://doddl-kv-prod.vault.azure.net/\"")
        sys.exit(1)

    parser = argparse.ArgumentParser(description="Generate SP-API refresh token for one seller account")
    parser.add_argument(
        "--account",
        required=True,
        choices=list(SELLERCENTRAL_URLS.keys()),
        help="Which seller account to authorise",
    )
    parser.add_argument(
        "--print-only",
        action="store_true",
        help="Skip the Key Vault write and print the refresh token to stdout instead "
             "(added 2026-08-25 — the SDK write was failing with RemoteDisconnected on "
             "the write path specifically, not a permissions issue, so this is a "
             "workaround for adding the secret manually via the portal, not a "
             "permanent alternative).",
    )
    args = parser.parse_args()
    account = args.account.lower()

    # ── Load LWA credentials from Key Vault ────────────────────────────────
    from connectors.lib.secrets import get_secret

    print(f"\n{'='*60}")
    print(f"SP-API OAuth — account: {account.upper()}")
    print(f"{'='*60}")
    print("\nFetching LWA credentials from Key Vault...")

    try:
        client_id     = get_secret("amazon-sp-api-client-id")
        client_secret = get_secret("amazon-sp-api-client-secret")
    except Exception as exc:
        print(f"\nERROR: Could not load LWA credentials from Key Vault: {exc}")
        print("  Make sure you have added these secrets first:")
        print("    amazon-sp-api-client-id")
        print("    amazon-sp-api-client-secret")
        print("  (Click 'View' under LWA credentials on the Solution Provider Portal)")
        sys.exit(1)

    print("  client_id loaded OK")

    # ── Prompt for redirect URI ─────────────────────────────────────────────
    print("\nWhat redirect URI is registered in your SP-API app?")
    print("  (Go to Solution Provider Portal → Edit App → OAuth redirect URI)")
    print("  Common values: https://localhost  or  https://doddl.com")
    redirect_uri = input("  Redirect URI: ").strip()
    if not redirect_uri:
        redirect_uri = "https://localhost"
        print(f"  Using default: {redirect_uri}")

    # ── Build authorization URL ─────────────────────────────────────────────
    state = secrets.token_urlsafe(16)
    sc_base = SELLERCENTRAL_URLS[account]
    auth_url = (
        f"{sc_base}/apps/authorize/consent"
        f"?application_id={APP_ID}"
        f"&state={state}"
        f"&version=beta"
    )

    print(f"\n{'─'*60}")
    print(f"STEP 1 — Open this URL in a browser:")
    print(f"  {auth_url}")
    print(f"\n  {ACCOUNT_NOTES[account]}")
    print(f"  Click 'Confirm' to authorize the app.")
    print(f"{'─'*60}")

    # ── Collect redirect URL ────────────────────────────────────────────────
    print("\nSTEP 2 — After clicking Confirm, your browser will redirect to:")
    print(f"  {redirect_uri}?spapi_oauth_code=...&state=...&selling_partner_id=...")
    print("\n  Paste the full redirect URL here (even if the page doesn't load):")
    redirect_received = input("  URL: ").strip()

    parsed = urllib.parse.urlparse(redirect_received)
    params = urllib.parse.parse_qs(parsed.query)

    if "spapi_oauth_code" not in params:
        print("\nERROR: Could not find spapi_oauth_code in the URL.")
        print("  Make sure you pasted the full URL including the query string.")
        sys.exit(1)

    oauth_code = params["spapi_oauth_code"][0]
    returned_state = params.get("state", [""])[0]

    if returned_state != state:
        print(f"\nWARNING: state mismatch (expected {state}, got {returned_state})")
        print("  This could mean CSRF — ensure you used the URL printed above.")
        confirm = input("  Continue anyway? [y/N]: ").strip().lower()
        if confirm != "y":
            sys.exit(1)

    print(f"\n  Code received: {oauth_code[:20]}...")

    # ── Exchange code for refresh token ─────────────────────────────────────
    print("\nSTEP 3 — Exchanging code for refresh token...")
    resp = httpx.post(
        LWA_TOKEN_URL,
        data={
            "grant_type": "authorization_code",
            "code": oauth_code,
            "redirect_uri": redirect_uri,
            "client_id": client_id,
            "client_secret": client_secret,
        },
        timeout=15.0,
    )
    if not resp.is_success:
        print(f"\nERROR: LWA token exchange failed: HTTP {resp.status_code}")
        print(f"  {resp.text}")
        sys.exit(1)

    token_data = resp.json()
    refresh_token = token_data.get("refresh_token")
    if not refresh_token:
        print(f"\nERROR: No refresh_token in response: {token_data}")
        sys.exit(1)

    print("  Refresh token obtained.")

    secret_name = SECRET_NAMES[account]

    if args.print_only:
        # Skips the Key Vault write entirely — added 2026-08-25 because the
        # SDK write was failing with RemoteDisconnected on the write path
        # specifically (read-path access already confirmed working via the
        # client_id/client_secret fetch above), not a permissions problem.
        print(f"\nSTEP 4 — skipped (--print-only). Add this secret via the portal instead:")
        print(f"  Vault:       {vault_uri}")
        print(f"  Secret name: {secret_name}")
        print(f"\n{'─'*60}")
        print(refresh_token)
        print(f"{'─'*60}\n")
        print(f"SUCCESS — token obtained for {account.upper()}, not yet stored.")
        print(f"  Add it as '{secret_name}' in the portal, then the connector will use it.")
        return

    # ── Store in Key Vault ──────────────────────────────────────────────────
    print(f"\nSTEP 4 — Storing refresh token in Key Vault as '{secret_name}'...")

    from azure.keyvault.secrets import SecretClient
    from azure.identity import DefaultAzureCredential

    kv_client = SecretClient(vault_url=vault_uri, credential=DefaultAzureCredential())
    kv_client.set_secret(secret_name, refresh_token)

    print(f"  Stored: {secret_name}")
    print(f"\n{'='*60}")
    print(f"SUCCESS — {account.upper()} account is now configured.")
    print(f"  Secret: {secret_name}")
    print(f"  The connector will use this token on its next run.")
    print(f"{'='*60}\n")

    # If more accounts remain, suggest the next one
    all_accounts = list(SELLERCENTRAL_URLS.keys())
    idx = all_accounts.index(account)
    if idx + 1 < len(all_accounts):
        next_account = all_accounts[idx + 1]
        print(f"Next account to configure:")
        print(f"  python scripts/amazon_sp_oauth.py --account {next_account}")
    else:
        print("All accounts configured — run the backfill when ready:")
        print("  python scripts/run_backfill.py --connector amazon")

    # NA note
    if account == "na":
        print()
        print("Note: This token covers US, CA, and MX (all share seller A2J3OJ1QMMOAR5).")


if __name__ == "__main__":
    main()
