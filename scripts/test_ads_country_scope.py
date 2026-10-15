"""Pin the UK/GB equivalence in the Amazon Ads profile scope filter.

    python scripts/test_ads_country_scope.py

WHY THIS TEST EXISTS
ACTIVE_AD_COUNTRIES is derived from the SP-API ACCOUNTS table, which spells the
United Kingdom "UK" and is mapped to "GB". The Advertising API's /v2/profiles
spells it "UK" and never "GB" (verified live 2026-09-07 across all 28 profiles).
Comparing the two directly dropped both UK profiles — including the one holding
388 campaigns and GBP 3,981 of 30-day spend — before amazon-ads-profile-ids was
consulted, and the run still logged success.

That failure is invisible in production: the connector reports "scoped 28 -> 13
profiles" and completes. Nothing errors, no row is written for the UK, and the
Ads tab shows a marketplace-shaped hole. So the equivalence is pinned here
rather than left to a comment.

No pytest in this repo; plain asserts, non-zero exit on failure.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("AZURE_KEYVAULT_URI", "https://doddl-kv-prod.vault.azure.net/")

from connectors.scheduler.jobs.amazon_advertising import (  # noqa: E402
    ACTIVE_AD_COUNTRIES,
    _ads_country,
)

FAILED = []


def check(name, cond, detail=""):
    if cond:
        print(f"  PASS  {name}")
    else:
        FAILED.append(name)
        print(f"  FAIL  {name}" + (f"\n        {detail}" if detail else ""))


# The 19 countryCodes /v2/profiles actually returned on 2026-09-07.
LIVE_COUNTRY_CODES = [
    "AE", "AU", "BE", "CA", "DE", "ES", "FR", "IE", "IT",
    "JP", "MX", "NL", "PL", "SA", "SE", "SG", "TR", "UK", "US",
]
# The nine in reporting scope, as ACTIVE_AD_COUNTRIES spells them.
EXPECTED_IN_SCOPE = {"CA", "DE", "ES", "FR", "GB", "IE", "IT", "NL", "US"}


def main():
    print("\nThe Ads API says UK; the scope set says GB")
    check("the Ads API spelling normalises to the scope spelling", _ads_country("UK") == "GB")
    check("lowercase and whitespace are handled", _ads_country(" uk ") == "GB")
    check("None does not explode", _ads_country(None) == "")
    check("codes that agree pass through untouched",
          all(_ads_country(c) == c for c in ["US", "DE", "FR", "IE", "IT", "NL", "ES", "CA"]))
    check("the scope set really does hold GB, not UK",
          "GB" in ACTIVE_AD_COUNTRIES and "UK" not in ACTIVE_AD_COUNTRIES,
          f"ACTIVE_AD_COUNTRIES={sorted(ACTIVE_AD_COUNTRIES)}")

    print("\nThe regression itself: a UK profile must survive the scope filter")
    check("normalised UK is in scope", _ads_country("UK") in ACTIVE_AD_COUNTRIES)
    check("comparing the RAW code would still fail (the bug, pinned)",
          "UK" not in ACTIVE_AD_COUNTRIES,
          "if this ever passes, the scope set changed and this test needs rewriting, not deleting")

    print("\nAgainst the real 19 country codes /v2/profiles returned")
    kept = {c for c in LIVE_COUNTRY_CODES if _ads_country(c) in ACTIVE_AD_COUNTRIES}
    check("exactly the nine reporting marketplaces are kept",
          {_ads_country(c) for c in kept} == EXPECTED_IN_SCOPE,
          f"kept={sorted(kept)} -> {sorted(_ads_country(c) for c in kept)}")
    check("UK is among them", "UK" in kept, f"kept={sorted(kept)}")
    check("out-of-scope markets are still dropped",
          not ({"AE", "AU", "BE", "JP", "MX", "PL", "SA", "SE", "SG", "TR"} & kept),
          f"leaked={sorted({'AE','AU','BE','JP','MX','PL','SA','SE','SG','TR'} & kept)}")

    print(f"\n{'FAILED: ' + ', '.join(FAILED) if FAILED else 'ALL PASSED'}\n")
    sys.exit(1 if FAILED else 0)


if __name__ == "__main__":
    main()
