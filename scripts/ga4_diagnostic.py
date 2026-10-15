"""
GA4 Diagnostic — checks which GA4 property is configured and whether the
OAuth token can access it. Also lists all accessible GA4 accounts/properties.

Usage:
    python scripts/ga4_diagnostic.py
"""

import os
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

import httpx
from connectors.lib.secrets import get_secrets
from connectors.lib.google_auth import refresh_access_token

print("Fetching credentials from Key Vault...")
creds = get_secrets([
    "google-oauth-client-id",
    "google-oauth-client-secret",
    "google-oauth-refresh-token",
    "ga4-property-id",
])

property_id = creds["ga4-property-id"]
print(f"\nGA4 property ID in Key Vault: {property_id}")

print("\nRefreshing access token...")
try:
    access_token = refresh_access_token(
        creds["google-oauth-client-id"],
        creds["google-oauth-client-secret"],
        creds["google-oauth-refresh-token"],
    )
    print("✓ Access token obtained")
except Exception as e:
    print(f"✗ Token refresh failed: {e}")
    sys.exit(1)

headers = {"Authorization": f"Bearer {access_token}"}

# ── 1. Test the configured property directly ──────────────────────────────────
print(f"\n--- Testing property {property_id} (GA4 Data API) ---")
try:
    resp = httpx.post(
        f"https://analyticsdata.googleapis.com/v1beta/properties/{property_id}:runReport",
        headers=headers,
        json={
            "dateRanges": [{"startDate": "2024-01-01", "endDate": "2024-01-01"}],
            "dimensions": [{"name": "date"}],
            "metrics": [{"name": "sessions"}],
            "limit": 1,
        },
        timeout=15.0,
    )
    if resp.status_code == 200:
        print(f"✓ Property {property_id} accessible — 200 OK")
    else:
        print(f"✗ Status {resp.status_code}: {resp.text[:300]}")
except Exception as e:
    print(f"✗ Request failed: {e}")

# ── 2. List all GA4 accounts via Admin API ────────────────────────────────────
print("\n--- Listing accessible GA4 accounts (Admin API) ---")
try:
    resp = httpx.get(
        "https://analyticsadmin.googleapis.com/v1beta/accounts",
        headers=headers,
        timeout=15.0,
    )
    if resp.status_code == 200:
        accounts = resp.json().get("accounts", [])
        if not accounts:
            print("  (no accounts returned — the OAuth token may not have analytics.readonly scope)")
        for acc in accounts:
            print(f"  Account: {acc.get('displayName')}  id={acc.get('name')}")
    else:
        print(f"  Status {resp.status_code}: {resp.text[:300]}")
except Exception as e:
    print(f"  Request failed: {e}")

# ── 3. List all GA4 properties via Admin API ──────────────────────────────────
print("\n--- Listing accessible GA4 properties (Admin API) ---")
try:
    resp = httpx.get(
        "https://analyticsadmin.googleapis.com/v1beta/properties",
        headers=headers,
        params={"filter": "parent:accounts/-"},  # all accounts
        timeout=15.0,
    )
    if resp.status_code == 200:
        properties = resp.json().get("properties", [])
        if not properties:
            print("  (no properties returned)")
        for prop in properties:
            prop_name = prop.get("name", "")
            prop_id = prop_name.split("/")[-1] if "/" in prop_name else prop_name
            print(f"  Property: {prop.get('displayName')}  id={prop_id}  ({prop_name})")
    else:
        print(f"  Status {resp.status_code}: {resp.text[:300]}")
except Exception as e:
    print(f"  Request failed: {e}")

# ── 4. Check token scopes ─────────────────────────────────────────────────────
print("\n--- Checking token scopes ---")
try:
    resp = httpx.get(
        f"https://www.googleapis.com/oauth2/v3/tokeninfo?access_token={access_token}",
        timeout=10.0,
    )
    if resp.status_code == 200:
        info = resp.json()
        print(f"  Scope: {info.get('scope', 'unknown')}")
        print(f"  Email: {info.get('email', 'unknown')}")
        print(f"  Expires in: {info.get('expires_in', '?')}s")
    else:
        print(f"  Status {resp.status_code}: {resp.text[:200]}")
except Exception as e:
    print(f"  Request failed: {e}")
