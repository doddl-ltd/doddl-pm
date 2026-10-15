"""
Quick check — does Key Vault have all Google Ads secrets?
Run: python scripts/check_google_ads_secrets.py
"""
import os, sys
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

from connectors.lib.secrets import _get_client

client = _get_client()

secrets_needed = [
    "google-ads-developer-token",
    "google-ads-client-id",
    "google-ads-client-secret",
    "google-ads-refresh-token",
    "google-ads-login-customer-id",
    "google-ads-customer-id",
]

print("Checking Google Ads secrets in Key Vault...\n")
all_ok = True
for name in secrets_needed:
    try:
        s = client.get_secret(name)
        val = s.value or ""
        print(f"  ✓ {name:<40}  ({val[:12]}...)")
    except Exception as e:
        msg = str(e)
        if "SecretNotFound" in msg or "404" in msg:
            print(f"  ✗ {name:<40}  MISSING")
        else:
            print(f"  ✗ {name:<40}  ERROR: {msg[:60]}")
        all_ok = False

print()
print("All present ✓" if all_ok else "Some secrets are missing — see above.")
