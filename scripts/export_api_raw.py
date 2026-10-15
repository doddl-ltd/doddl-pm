"""
Export api_raw to Supabase Storage as gzipped JSONL, one file per source.

READ-ONLY against api_raw. This script never truncates, deletes or alters
api_raw. It reads rows via PostgREST and writes them to local .jsonl.gz files,
then uploads those files to a private Storage bucket.

Transport follows connectors/lib/db.py exactly: PostgREST/Storage over HTTP,
headers `Authorization: Bearer <key>` + `apikey: <key>`. No Key Vault, no
psycopg2, no direct Postgres connection.

Resilience (added 2026-07-30 after a ReadTimeout on shopify page 5):
  - every HTTP call retries up to RETRIES times with exponential backoff
  - read timeout raised to 300s
  - resume: an existing .jsonl.gz is validated line-by-line and, if intact,
    reused — paging continues from the next unread offset and new rows are
    appended as a further gzip member. If validation fails the file is
    deleted and that source restarts from offset 0.

Resume is safe with offset paging here because api_raw is append-only and the
sort is `received_at asc, id asc`: any row inserted mid-run sorts after
everything already read, so earlier offsets stay stable.

Credentials come from .env.local:
    NEXT_PUBLIC_SUPABASE_URL      project base URL
    SUPABASE_SERVICE_ROLE_KEY     service-role key for that project
Optional overrides, preferred when present:
    SUPABASE_URL_PROD
    SUPABASE_SERVICE_ROLE_KEY_PROD

Credential values are never printed. Only the project ref is shown.

Usage:
    python scripts/export_api_raw.py --preflight    # Step 1 only, no writes
    python scripts/export_api_raw.py               # full export + upload
"""

import argparse
import gzip
import json
import os
import re
import time
from datetime import datetime, timezone

import requests

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_PATH = os.path.join(REPO_ROOT, ".env.local")
EXPORT_DIR = os.path.join(REPO_ROOT, "exports")
REPORT_DIR = os.path.join(REPO_ROOT, "reports")

BUCKET = "api-raw-archive"
TABLE = "api_raw"
COLUMNS = ["id", "source", "pull_id", "endpoint", "response_body",
           "response_status", "connector_version", "received_at"]

# Page sizes per the brief: shopify bodies average ~941 KB.
SOURCES = {
    "shopify": 25,
    "amazon_sp": 200,
    "google_search_console": 200,
    "meta_ads": 200,
    "google_analytics": 200,
    "klaviyo": 200,
}

TIMEOUT = 300          # read timeout, seconds
RETRIES = 5            # attempts per HTTP call
BACKOFF_START = 2      # seconds, doubles each retry


def load_env():
    if not os.path.isfile(ENV_PATH):
        die(f"{ENV_PATH} not found")
    env = {}
    with open(ENV_PATH, encoding="utf-8-sig") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def die(msg, code=2):
    print(f"\nBLOCKED — {msg}", flush=True)
    raise SystemExit(code)


def project_ref(url):
    m = re.search(r"https://([a-z0-9]+)\.supabase\.co", url or "")
    return m.group(1) if m else None


def key_ref(token):
    """Project ref from the JWT payload. Reads the `ref` claim only."""
    import base64
    try:
        p = token.split(".")[1]
        p += "=" * (-len(p) % 4)
        return json.loads(base64.urlsafe_b64decode(p)).get("ref")
    except Exception:
        return None


class Client:
    def __init__(self, base_url, key):
        self.rest = f"{base_url.rstrip('/')}/rest/v1"
        self.storage = f"{base_url.rstrip('/')}/storage/v1"
        self._h = {"Authorization": f"Bearer {key}", "apikey": key}

    def headers(self, extra=None):
        h = dict(self._h)
        if extra:
            h.update(extra)
        return h

    def _retry(self, label, fn, fatal_code=5):
        """Call fn() with retries. Retries timeouts, connection errors, 429 and 5xx."""
        delay, last = BACKOFF_START, None
        for attempt in range(1, RETRIES + 1):
            try:
                r = fn()
                if r.status_code == 429 or r.status_code >= 500:
                    last = f"HTTP {r.status_code}: {r.text[:200]}"
                else:
                    return r
            except (requests.exceptions.Timeout,
                    requests.exceptions.ConnectionError,
                    requests.exceptions.ChunkedEncodingError) as e:
                last = f"{type(e).__name__}: {str(e)[:200]}"
            if attempt < RETRIES:
                print(f"      {label}: attempt {attempt}/{RETRIES} failed "
                      f"({last}) — retrying in {delay}s", flush=True)
                time.sleep(delay)
                delay *= 2
        die(f"{label} failed after {RETRIES} attempts: {last}", fatal_code)

    def count(self, source=None):
        """Exact row count via PostgREST's Content-Range header."""
        params = {"select": "id", "limit": "1"}
        if source is not None:
            params["source"] = f"eq.{source}"
        r = self._retry(
            f"count({source or 'all'})",
            lambda: requests.get(
                f"{self.rest}/{TABLE}",
                headers=self.headers({"Prefer": "count=exact", "Range-Unit": "items"}),
                params=params, timeout=TIMEOUT),
            fatal_code=4)
        if r.status_code >= 400:
            die(f"PostgREST count failed on {TABLE} "
                f"(HTTP {r.status_code}): {r.text[:300]}", 4)
        cr = r.headers.get("Content-Range", "")
        if "/" not in cr:
            die(f"no Content-Range in PostgREST response (got {cr!r})", 4)
        total = cr.split("/")[-1]
        if total in ("*", ""):
            die("PostgREST returned an unknown exact count", 4)
        return int(total)

    def page(self, source, limit, offset):
        params = {
            "select": ",".join(COLUMNS),
            "source": f"eq.{source}",
            "order": "received_at.asc,id.asc",   # id breaks ties for stable paging
            "limit": str(limit),
            "offset": str(offset),
        }
        r = self._retry(
            f"{source} offset={offset}",
            lambda: requests.get(f"{self.rest}/{TABLE}", headers=self.headers(),
                                 params=params, timeout=TIMEOUT))
        if r.status_code >= 400:
            die(f"page fetch failed for source={source} offset={offset} "
                f"(HTTP {r.status_code}): {r.text[:300]}", 5)
        return r.json()

    # ── Storage ──────────────────────────────────────────────────────────────
    def list_buckets(self):
        r = self._retry("list buckets",
                        lambda: requests.get(f"{self.storage}/bucket",
                                             headers=self.headers(), timeout=TIMEOUT),
                        fatal_code=9)
        if r.status_code >= 400:
            return None, f"HTTP {r.status_code}: {r.text[:300]}"
        return r.json(), None

    def create_bucket(self):
        r = self._retry("create bucket",
                        lambda: requests.post(
                            f"{self.storage}/bucket",
                            headers=self.headers({"Content-Type": "application/json"}),
                            json={"id": BUCKET, "name": BUCKET, "public": False},
                            timeout=TIMEOUT),
                        fatal_code=9)
        return r.status_code, r.text[:300]

    def upload(self, obj_path, local_path):
        def send():
            # Reopen per attempt so a retry restarts the body from byte 0.
            with open(local_path, "rb") as fh:
                return requests.post(
                    f"{self.storage}/object/{BUCKET}/{obj_path}",
                    headers=self.headers({"Content-Type": "application/gzip",
                                          "x-upsert": "true"}),
                    data=fh, timeout=TIMEOUT)
        r = self._retry(f"upload {obj_path}", send, fatal_code=6)
        if r.status_code >= 400:
            die(f"upload failed for {obj_path} (HTTP {r.status_code}): {r.text[:300]}", 6)
        return r.status_code

    def download_size(self, obj_path):
        r = self._retry(f"download {obj_path}",
                        lambda: requests.get(f"{self.storage}/object/{BUCKET}/{obj_path}",
                                             headers=self.headers(), timeout=TIMEOUT),
                        fatal_code=7)
        if r.status_code >= 400:
            die(f"download-back failed for {obj_path} "
                f"(HTTP {r.status_code}): {r.text[:300]}", 7)
        return len(r.content)


# ── Resume ────────────────────────────────────────────────────────────────────

def resume_state(path, expected):
    """
    Inspect an existing partial export.

    Returns (rows_present, reusable). A file is reusable only if every line is
    newline-terminated valid JSON and the count does not exceed `expected`.
    """
    if not os.path.exists(path):
        return 0, True
    n = 0
    try:
        with gzip.open(path, "rt", encoding="utf-8") as fh:
            for line in fh:
                if not line.endswith("\n"):
                    return n, False          # truncated final write
                json.loads(line)
                n += 1
    except Exception:
        return n, False
    if n > expected:
        return n, False                      # more local rows than the table has
    return n, True


def export_source(cli, src, limit, expected):
    os.makedirs(EXPORT_DIR, exist_ok=True)
    path = os.path.join(EXPORT_DIR, f"api_raw_{src}.jsonl.gz")

    have, reusable = resume_state(path, expected)
    if not reusable:
        if os.path.exists(path):
            os.remove(path)
            print(f"    {src}: existing file failed validation "
                  f"({have} readable lines) — DELETED, restarting from offset 0", flush=True)
        have = 0
    elif have >= expected > 0:
        print(f"    {src}: already complete on disk ({have:,} rows) — skipping fetch", flush=True)
        return path, have, "already complete"
    elif have > 0:
        print(f"    {src}: RESUMING from existing file — {have:,} rows already on disk, "
              f"continuing at offset {have:,}", flush=True)

    mode = "at" if have > 0 else "wt"
    disposition = "resumed" if have > 0 else "fresh"
    written, offset, page_no = have, have, 0

    with gzip.open(path, mode, encoding="utf-8") as out:
        while written < expected:
            rows = cli.page(src, limit, offset)
            if not rows:
                break
            page_no += 1
            for row in rows:
                out.write(json.dumps(row, separators=(",", ":"), default=str) + "\n")
            written += len(rows)
            offset += len(rows)
            print(f"    {src}: page {page_no:>4}  rows {written:,}/{expected:,}", flush=True)
            if len(rows) < limit:
                break
    return path, written, disposition


def verify_gzip(path):
    n = 0
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        for _ in fh:
            n += 1
    return n


# ── Steps ─────────────────────────────────────────────────────────────────────

def preflight(cli, ref):
    print("=== STEP 1: PRE-FLIGHT ===")
    print(f"target project ref : {ref}")
    print(f"PostgREST base     : {cli.rest}")
    print()
    print("(b) foreign keys referencing api_raw")
    print("    pg_constraint is NOT reachable over PostgREST: pg_catalog is not an")
    print("    exposed schema, and public.exec_sql(text) returns void so it cannot")
    print("    return rows. Reporting as instructed rather than substituting a path.")
    print()
    print("(c) row counts")
    total = cli.count()
    print(f"    api_raw TOTAL : {total:,}")
    per = {}
    for src in SOURCES:
        n = cli.count(src)
        per[src] = n
        print(f"      {src:<24} {n:,}")
    named = sum(per.values())
    if named != total:
        print(f"    NOTE: named sources sum to {named:,} but table total is "
              f"{total:,} — {total - named:,} row(s) belong to other sources.")
    return total, per


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--preflight", action="store_true",
                    help="run Step 1 only; create nothing, upload nothing")
    args = ap.parse_args()

    env = load_env()
    url = env.get("SUPABASE_URL_PROD") or env.get("NEXT_PUBLIC_SUPABASE_URL")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY_PROD") or env.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        die("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env.local", 2)

    u_ref, k_ref = project_ref(url), key_ref(key)
    if u_ref and k_ref and u_ref != k_ref:
        die(f"URL project ref ({u_ref}) does not match the service-role key's "
            f"ref ({k_ref}) — refusing to run against a mismatched pair", 2)

    cli = Client(url, key)
    total, per = preflight(cli, u_ref or "unknown")

    if args.preflight:
        print("\n--preflight set: stopping before Step 2. Nothing created, nothing uploaded.")
        return

    if total == 0:
        die("api_raw contains 0 rows in this project — nothing to export. "
            "Refusing to create a bucket and upload empty archives.", 8)

    print("\n=== STEP 2: BUCKET ===")
    buckets, err = cli.list_buckets()
    if err:
        die(f"could not list Storage buckets: {err}", 9)
    names = {b.get("name") for b in buckets}
    if BUCKET in names:
        print(f"bucket '{BUCKET}' already exists — using it")
    else:
        code, body = cli.create_bucket()
        if code >= 400:
            die(f"bucket creation failed (HTTP {code}): {body}", 9)
        print(f"bucket '{BUCKET}' created (private)")

    print("\n=== STEP 3: EXPORT ===")
    results = {}
    for src, limit in SOURCES.items():
        exp = per.get(src, 0)
        if exp == 0:
            print(f"  {src}: 0 rows expected — skipping")
            results[src] = {"expected": 0, "exported": 0, "path": None,
                            "disposition": "no rows"}
            continue
        print(f"  {src}: expecting {exp:,} rows, page size {limit}")
        path, written, disposition = export_source(cli, src, limit, exp)
        results[src] = {"expected": exp, "exported": written, "path": path,
                        "disposition": disposition}

    print("\n=== STEP 4: VERIFY ===")
    mismatches = []
    for src, r in results.items():
        if not r["path"]:
            continue
        lines = verify_gzip(r["path"])
        r["lines"] = lines
        r["bytes"] = os.path.getsize(r["path"])
        ok = lines == r["expected"]
        print(f"  {src:<24} expected {r['expected']:,}  gzip lines {lines:,}  "
              f"{'OK' if ok else 'MISMATCH'}")
        if not ok:
            mismatches.append(f"{src} (expected {r['expected']:,}, got {lines:,})")
    if mismatches:
        die("row count mismatch in: " + "; ".join(mismatches) +
            " — stopping before upload as instructed", 10)

    print("\n=== STEP 5: UPLOAD ===")
    for src, r in results.items():
        if not r["path"]:
            continue
        obj = f"2026-07-30/api_raw_{src}.jsonl.gz"
        cli.upload(obj, r["path"])
        remote = cli.download_size(obj)
        r["object"] = obj
        r["remote_bytes"] = remote
        r["verified"] = remote == r["bytes"]
        print(f"  {src:<24} {obj}  local {r['bytes']:,} B  remote {remote:,} B  "
              f"{'MATCH' if r['verified'] else 'SIZE MISMATCH'}", flush=True)

    print("\n=== STEP 6: REPORT ===")
    os.makedirs(REPORT_DIR, exist_ok=True)
    rp = os.path.join(REPORT_DIR, "api-raw-export-2026-07-30.md")
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%SZ")
    all_ok = all(r.get("verified") for r in results.values() if r["path"])
    lines = [
        "# api_raw export to Supabase Storage — 2026-07-30", "",
        f"- Generated: `{now}` (UTC)",
        f"- Project ref: `{u_ref}`",
        f"- Bucket: `{BUCKET}` (private)",
        "- Transport: PostgREST + Storage API over HTTP (per `connectors/lib/db.py`)",
        f"- `api_raw` total rows at export time: **{total:,}**",
        f"- Retry policy: {RETRIES} attempts per call, exponential backoff, {TIMEOUT}s read timeout",
        "", "| source | rows expected | rows exported | compressed size | storage path | verified |",
        "|---|---|---|---|---|---|",
    ]
    for src, r in results.items():
        if not r["path"]:
            lines.append(f"| {src} | 0 | 0 | — | — | n/a (no rows) |")
            continue
        lines.append(
            f"| {src} | {r['expected']:,} | {r['lines']:,} | {r['bytes']:,} B | "
            f"`{BUCKET}/{r['object']}` | {'Y' if r['verified'] else 'N'} |")
    lines += [
        "",
        "## Notes",
        "",
        f"- Overall upload verification: **{'all files match' if all_ok else 'ONE OR MORE MISMATCHES'}**",
        "- Each file was re-read from gzip and its line count compared to the PostgREST "
        "row count for that source before any upload occurred.",
        "- Each uploaded object was downloaded back and its byte length compared to the local file.",
        "- Per-source resume disposition: "
        + ", ".join(f"{s} = {r['disposition']}" for s, r in results.items()),
        "",
        "`api_raw` was not modified by this export — every database call was a read.",
        "",
    ]
    with open(rp, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    print(f"report written: {os.path.relpath(rp, REPO_ROOT)}")

    if all_ok:
        print("\nAll sources verified. Statement for Jon to run manually "
              "(NOT run by this script):")
        print("\n  truncate table api_raw;\n")
    else:
        print("\nVerification did not fully pass — no truncate statement is printed.")


if __name__ == "__main__":
    main()
