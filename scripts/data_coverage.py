"""
Quick diagnostic — how much data do we have per connector?
Connects directly to Supabase (bypassing the pooler) to run aggregation queries.

Usage:
    python scripts/data_coverage.py
"""

import os
import sys
import urllib.parse

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

import psycopg2
from connectors.lib.secrets import get_secret

# Get the scheduler DB URL (pooler format) and convert to a direct connection.
# Pooler URL:  postgresql://postgres.{ref}:{password}@aws-0-{region}.pooler.supabase.com:5432/postgres
# Direct URL:  postgresql://postgres:{password}@db.{ref}.supabase.co:5432/postgres
pooler_url = get_secret("supabase-scheduler-db-url")
parsed     = urllib.parse.urlparse(pooler_url)
password   = urllib.parse.unquote(parsed.password or "")

# Extract project ref from username (postgres.ikcjciscttsvpxoijnqe → ikcjciscttsvpxoijnqe)
username = parsed.username or ""
project_ref = username.split(".")[-1] if "." in username else "ikcjciscttsvpxoijnqe"

direct_url = (
    f"postgresql://postgres:{urllib.parse.quote(password, safe='')}"
    f"@db.{project_ref}.supabase.co:5432/postgres"
    f"?sslmode=require"
)

print(f"Connecting directly to db.{project_ref}.supabase.co ...")
conn = psycopg2.connect(direct_url)
cur  = conn.cursor()

cur.execute("""
    SELECT
        source,
        COUNT(*)                                AS rows,
        MIN((data->>'date')::date)              AS earliest,
        MAX((data->>'date')::date)              AS latest,
        MAX((data->>'date')::date)
            - MIN((data->>'date')::date)        AS days_covered
    FROM api_clean
    WHERE data->>'date' IS NOT NULL
    GROUP BY source
    ORDER BY source;
""")

rows = cur.fetchall()

print(f"\n{'Connector':<25} {'Rows':>10} {'Earliest':>12} {'Latest':>12} {'Days':>6}")
print("─" * 70)
for source, count, earliest, latest, days in rows:
    print(
        f"{source:<25} {count:>10,} "
        f"{str(earliest):>12} "
        f"{str(latest):>12} "
        f"{str(days or '?'):>6}"
    )

# Also show sources with no date field
cur.execute("""
    SELECT source, COUNT(*) AS rows
    FROM api_clean
    WHERE data->>'date' IS NULL
    GROUP BY source ORDER BY source;
""")
nodates = cur.fetchall()
if nodates:
    print(f"\n  (no date field)")
    for source, count in nodates:
        print(f"  {source:<25} {count:>10,} rows")

cur.close()
conn.close()
