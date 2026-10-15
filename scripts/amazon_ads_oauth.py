"""
Amazon Advertising API OAuth helper — generate and store the LWA refresh token.

Modelled on scripts/amazon_sp_oauth.py. Same interactive flow: the script
prints a consent URL, you open it signed in to the Amazon account that manages
doddl's advertising, approve, and paste the redirect URL back. It then exchanges
the code for a refresh token and writes it to Key Vault.

KEY DIFFERENCE FROM SP-API — the Ads API is NOT region-scoped the way SP-API is.
SP-API needs one refresh token per seller account because each region is a
separate Amazon seller identity. The Ads API uses ONE Login-with-Amazon
authorization: "an authorization code retrieved from any of [the regional auth]
URLs can be used to access the advertising API in any region"
(developer.amazon.com LWA docs — "Applications are not region-specific"). The
connector (connectors/scheduler/jobs/amazon_advertising.py) already proves this
model: it obtains one access token and calls the NA, EU and FE
/v2/profiles endpoints with it, keeping whatever each returns.

So the default is a single token in `amazon-ads-refresh-token`, and --region
only chooses which regional Amazon sign-in page you see. You would only need a
second token if doddl's US advertising is managed under a DIFFERENT Amazon
login (a separate account, not just a separate marketplace) — in which case run
again with --region na --secret-name amazon-ads-refresh-token-na, and the
connector will need a change to load both. STEP 4 below probes all three
regions with the new token so you can see immediately whether that applies.

Usage:
    python scripts/amazon_ads_oauth.py
    python scripts/amazon_ads_oauth.py --region eu           # default
    python scripts/amazon_ads_oauth.py --region na --secret-name amazon-ads-refresh-token-na
    python scripts/amazon_ads_oauth.py --print-only          # skip the KV write, print the token

    --print-only skips the Key Vault write and prints the refresh token to
    stdout instead, for adding it via the portal by hand. The script also
    falls back to this automatically if the KV write fails after retries
    (same RemoteDisconnected-on-write failure mode seen with amazon_sp_oauth.py).

What this script does:
  1. Reads amazon-ads-client-id / amazon-ads-client-secret from Key Vault.
  2. Prints an authorization URL — open it in a browser signed in to the Amazon
     account that manages doddl's Advertising Console.
  3. After you click Allow, Amazon redirects to the registered redirect URI with
     ?code=... in the query string. Paste that full URL here.
  4. Exchanges the code for a refresh token via the LWA token endpoint, then
     probes the NA / EU / FE profile endpoints so you can see which regions the
     one token reaches.
  5. Stores the refresh token in Key Vault (with retry) — or, with --print-only
     or on repeated write failure, prints it instead.

Pre-requisites:
  - AZURE_KEYVAULT_URI must point to doddl-kv-prod.
  - amazon-ads-client-id and amazon-ads-client-secret already in Key Vault.
  - The redirect URI passed here must be registered on the Ads API app
    (https://doddl.com/callback is registered).

Set AZURE_KEYVAULT_URI before running:
    $env:AZURE_KEYVAULT_URI = "https://doddl-kv-prod.vault.azure.net/"
"""

import argparse
import os
import sys
import secrets
import time
import urllib.parse

import httpx

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

# ── App / OAuth constants ───────────────────────────────────────────────────
SCOPE = "advertising::campaign_management"
DEFAULT_REDIRECT_URI = "https://doddl.com/callback"

# LWA token exchange endpoint. Any regional LWA endpoint works regardless of the
# region the token is for; the connector uses this one too.
LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token"

# Regional consent (authorization) URLs. These differ only in which regional
# Amazon sign-in the user sees — the resulting code/token is not region-locked.
AUTH_URLS = {
    "na": "https://www.amazon.com/ap/oa",
    "eu": "https://eu.account.amazon.com/ap/oa",
    "fe": "https://apac.account.amazon.com/ap/oa",
}

# Regional Advertising API hosts — used for the post-auth profile probe (STEP 4).
ADS_API_HOSTS = {
    "na": "https://advertising-api.amazon.com",
    "eu": "https://advertising-api-eu.amazon.com",
    "fe": "https://advertising-api-fe.amazon.com",
}

SECRET_CLIENT_ID = "amazon-ads-client-id"
SECRET_CLIENT_SECRET = "amazon-ads-client-secret"
DEFAULT_REFRESH_TOKEN_SECRET = "amazon-ads-refresh-token"

REGION_NOTES = {
    "eu": "Sign in with the Amazon account that manages doddl's UK/EU advertising.",
    "na": "Sign in with the Amazon account that manages doddl's US/CA advertising "
          "(only a separate token if this is a DIFFERENT Amazon login from EU).",
    "fe": "Sign in with the Amazon account that manages doddl's JP/AU/SG advertising.",
}

# Key Vault write retry
KV_WRITE_ATTEMPTS = 4
KV_WRITE_BACKOFF_S = 3.0


def _probe_region(region: str, access_token: str, client_id: str) -> None:
    """Call one region's /v2/profiles and print what comes back. Best-effort."""
    host = ADS_API_HOSTS[region]
    try:
        resp = httpx.get(
            f"{host}/v2/profiles",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Amazon-Advertising-API-ClientId": client_id,
            },
            timeout=15.0,
        )
    except Exception as exc:
        print(f"  {region.upper():3} — probe failed ({exc})")
        return

    if resp.status_code in (401, 403):
        print(f"  {region.upper():3} — no access (HTTP {resp.status_code}) — "
              f"this token's account has no advertising profile in {region.upper()}")
        return
    if not resp.is_success:
        print(f"  {region.upper():3} — HTTP {resp.status_code}: {resp.text[:200]}")
        return

    body = resp.json()
    profiles = body if isinstance(body, list) else []
    print(f"  {region.upper():3} — {len(profiles)} profile(s)")
    for p in profiles[:8]:
        country = p.get("countryCode", "?")
        pid = p.get("profileId", "?")
        name = p.get("accountInfo", {}).get("name", "")
        acct_type = p.get("accountInfo", {}).get("type", "")
        print(f"        [{country}] profileId={pid}  {name} {acct_type}".rstrip())
    if len(profiles) > 8:
        print(f"        ... and {len(profiles) - 8} more")


def _store_with_retry(vault_uri: str, secret_name: str, value: str) -> bool:
    """Write to Key Vault, retrying transient failures. Returns True on success."""
    # Reuse connectors.lib.secrets' client: when AZURE_TENANT_ID is set it builds
    # a tenant-scoped chain with a persisted token cache, which is what the reads
    # in this script already authenticated with. A bare DefaultAzureCredential
    # would fall through to the Azure CLI, which is not installed here.
    from connectors.lib.secrets import _get_client

    last_exc: Exception | None = None
    for attempt in range(1, KV_WRITE_ATTEMPTS + 1):
        try:
            _get_client().set_secret(secret_name, value)
            return True
        except Exception as exc:  # noqa: BLE001 — any failure is a retry candidate
            last_exc = exc
            wait = KV_WRITE_BACKOFF_S * attempt
            print(f"  write attempt {attempt}/{KV_WRITE_ATTEMPTS} failed: {exc}")
            if attempt < KV_WRITE_ATTEMPTS:
                print(f"  retrying in {wait:.0f}s...")
                time.sleep(wait)
    print(f"\n  Key Vault write failed after {KV_WRITE_ATTEMPTS} attempts ({last_exc}).")
    return False


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate the Amazon Advertising API refresh token and store it in Key Vault",
    )
    parser.add_argument(
        "--region",
        choices=list(AUTH_URLS.keys()),
        default="eu",
        help="Which regional Amazon sign-in page to use for consent (default: eu). "
             "The token itself is not region-locked; this only picks the login screen.",
    )
    parser.add_argument(
        "--secret-name",
        default=DEFAULT_REFRESH_TOKEN_SECRET,
        help=f"Key Vault secret to write (default: {DEFAULT_REFRESH_TOKEN_SECRET}). "
             f"Only override if storing a SECOND account's token, e.g. "
             f"amazon-ads-refresh-token-na.",
    )
    parser.add_argument(
        "--redirect-uri",
        default=DEFAULT_REDIRECT_URI,
        help=f"Redirect URI registered on the Ads API app (default: {DEFAULT_REDIRECT_URI}).",
    )
    parser.add_argument(
        "--print-only",
        action="store_true",
        help="Skip the Key Vault write and print the refresh token to stdout instead, "
             "for adding it via the portal by hand.",
    )
    args = parser.parse_args()

    # Windows consoles default to cp1252; Amazon profile names are not confined
    # to it. Degrade unprintable characters instead of raising.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:  # noqa: BLE001 — older/redirected streams
            pass

    region = args.region.lower()
    secret_name = args.secret_name.strip()
    redirect_uri = args.redirect_uri.strip()

    vault_uri = os.environ.get("AZURE_KEYVAULT_URI")
    if not vault_uri:
        print("ERROR: AZURE_KEYVAULT_URI is not set.")
        print('  Run:  $env:AZURE_KEYVAULT_URI = "https://doddl-kv-prod.vault.azure.net/"')
        sys.exit(1)

    # ── Load LWA credentials from Key Vault ────────────────────────────────
    from connectors.lib.secrets import get_secret

    print(f"\n{'='*60}")
    print(f"Amazon Advertising API OAuth — region: {region.upper()}")
    print(f"{'='*60}")
    print("\nFetching Advertising API credentials from Key Vault...")

    try:
        client_id = get_secret(SECRET_CLIENT_ID)
        client_secret = get_secret(SECRET_CLIENT_SECRET)
    except Exception as exc:
        print(f"\nERROR: Could not load credentials from Key Vault: {exc}")
        print("  These secrets must exist first:")
        print(f"    {SECRET_CLIENT_ID}")
        print(f"    {SECRET_CLIENT_SECRET}")
        sys.exit(1)

    print("  client_id loaded OK")

    # ── Build authorization URL ────────────────────────────────────────────
    state = secrets.token_urlsafe(16)
    params = {
        "client_id": client_id,
        "scope": SCOPE,
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "state": state,
    }
    auth_url = AUTH_URLS[region] + "?" + urllib.parse.urlencode(params)

    print(f"\n{'-'*60}")
    print("STEP 1 — Open this URL in a browser:")
    print(f"\n  {auth_url}\n")
    print(f"  {REGION_NOTES[region]}")
    print("  Click 'Allow' to grant campaign management access.")
    print(f"{'-'*60}")

    # ── Collect redirect URL ──────────────────────────────────────────────
    print("\nSTEP 2 — After clicking Allow, your browser redirects to:")
    print(f"  {redirect_uri}?code=...&scope=...&state=...")
    print("\n  Paste the full redirect URL here (even if the page doesn't load):")
    redirect_received = input("  URL: ").strip()

    parsed = urllib.parse.urlparse(redirect_received)
    qs = urllib.parse.parse_qs(parsed.query)

    if "code" not in qs:
        print("\nERROR: Could not find 'code' in the redirect URL.")
        print("  Paste the full URL including the query string (it contains ?code=...).")
        sys.exit(1)

    auth_code = qs["code"][0]
    returned_state = qs.get("state", [""])[0]

    if returned_state != state:
        print(f"\nWARNING: state mismatch (expected {state}, got {returned_state})")
        print("  Could indicate CSRF — make sure you used the URL printed above.")
        if input("  Continue anyway? [y/N]: ").strip().lower() != "y":
            sys.exit(1)

    print(f"\n  Code received: {auth_code[:20]}...")

    # ── Exchange code for refresh token ──────────────────────────────────
    print("\nSTEP 3 — Exchanging code for refresh token...")
    resp = httpx.post(
        LWA_TOKEN_URL,
        data={
            "grant_type": "authorization_code",
            "code": auth_code,
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
    access_token = token_data.get("access_token")
    if not refresh_token:
        print(f"\nERROR: No refresh_token in response: {token_data}")
        sys.exit(1)

    print("  Refresh token obtained.")

    # ── Probe all three regions with the new token ───────────────────────
    print("\nSTEP 4 — Checking which regions this one token reaches")
    print("  (this is the 'does NA need its own token' check):")
    if access_token:
        for r in ("na", "eu", "fe"):
            try:
                _probe_region(r, access_token, client_id)
            except Exception as exc:  # noqa: BLE001 — STEP 4 is diagnostics only.
                # A probe must never abort the run: the refresh token is only in
                # memory at this point and STEP 5 has not stored it yet.
                print(f"  {r.upper():3} — probe error ({type(exc).__name__}: {exc})")
        print("\n  If NA shows profiles above, the single token covers NA — no second")
        print("  authorisation needed. If NA shows 'no access' AND doddl runs US ads,")
        print("  US advertising is under a separate Amazon login: re-run with")
        print("    --region na --secret-name amazon-ads-refresh-token-na")
        print("  and the connector will need a change to load both tokens.")
    else:
        print("  (no access_token in the response — skipping the probe)")

    # ── Store (or print) the refresh token ──────────────────────────────
    if args.print_only:
        print(f"\nSTEP 5 — skipped (--print-only). Add this secret via the portal:")
        print(f"  Vault:       {vault_uri}")
        print(f"  Secret name: {secret_name}")
        print(f"\n{'-'*60}")
        print(refresh_token)
        print(f"{'-'*60}\n")
        print("SUCCESS — token obtained, not yet stored.")
        return

    print(f"\nSTEP 5 — Storing refresh token in Key Vault as '{secret_name}' (with retry)...")
    if _store_with_retry(vault_uri, secret_name, refresh_token):
        print(f"  Stored: {secret_name}")
        print(f"\n{'='*60}")
        print("SUCCESS — Amazon Advertising API refresh token is in Key Vault.")
        print(f"  Secret: {secret_name}")
        print(f"{'='*60}\n")
        print("Next: the connector is still disabled. To wire it up:")
        print("  - confirm STEP 4 showed the profiles you expect")
        print("  - test:  python scripts/run_backfill.py --connector amazon_ads   (short range)")
        print("  - then uncomment the amazon_advertising add_job block in")
        print("    connectors/scheduler/scheduler.py and redeploy the scheduler")
    else:
        print("\n  Falling back to print-only so the token is not lost:")
        print(f"  Add it as '{secret_name}' in the portal at {vault_uri}")
        print(f"\n{'-'*60}")
        print(refresh_token)
        print(f"{'-'*60}\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
