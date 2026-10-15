"""
Read-only diagnostic audit of the doddl AI OS production Supabase database.

DIAGNOSTIC ONLY. This script issues SELECT statements inside a READ ONLY
transaction and never creates, alters, drops, inserts, updates or deletes
anything. It writes exactly one output file: reports/db-audit-<date>.md

Credential path (approved 2026-07-30):
  connectors/lib/secrets.py -> Azure Key Vault (doddl-kv-prod)
  secret: supabase-scheduler-db-url  (pooler URL, used EXACTLY as stored)
  auth:   DefaultAzureCredential, falling through to AzurePowerShellCredential

AZURE_TENANT_ID is deliberately NOT set by this script. secrets.py switches to
an InteractiveBrowserCredential chain when it is present, which would block on
a browser prompt; leaving it unset keeps DefaultAzureCredential in play so the
live Az PowerShell context is used.

The connection string is never printed, logged or written to the report.

Usage:
    python scripts/db_audit.py
"""

import os
import pickle
import re
import sys
import traceback
from datetime import datetime, timezone
from decimal import Decimal

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

# Vault address (not a credential — see KEYVAULT_SECRETS_REGISTRY.md).
# Set before importing secrets.py, which raises at import time if it is absent.
os.environ.setdefault("AZURE_KEYVAULT_URI", "https://doddl-kv-prod.vault.azure.net/")

import psycopg2
from psycopg2 import sql

from connectors.lib.secrets import get_secret

DB_SECRET = "supabase-scheduler-db-url"
JOBS_DIR = os.path.join(REPO_ROOT, "connectors", "scheduler", "jobs")
SCHEDULER_PY = os.path.join(REPO_ROOT, "connectors", "scheduler", "scheduler.py")
REPORT_DIR = os.path.join(REPO_ROOT, "reports")

SYSTEM_SCHEMAS = ("pg_catalog", "information_schema")

# Preferred timestamp column when a table has several, best-first.
TS_PREFERENCE = [
    "received_at", "created_at", "first_seen_at", "last_updated_at",
    "archived_at", "date_detected", "inserted_at", "updated_at", "ts", "timestamp",
]
SOURCE_COL_CANDIDATES = ("source", "source_name", "connector", "connector_name")

_lines = []


def out(line=""):
    """Print to terminal and buffer for the markdown report."""
    print(line)
    _lines.append(line)


def h1(t):
    out()
    out(f"## {t}")
    out()


def fmt_bytes(n):
    if n is None:
        return "—"
    n = float(n)
    for unit in ("B", "kB", "MB", "GB", "TB"):
        if n < 1024 or unit == "TB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{int(n)} B"
        n /= 1024


def table(rows, headers):
    """Render a markdown/terminal table from a list of row tuples."""
    if not rows:
        return
    cols = [[str(h) for h in headers]] + [[("—" if c is None else str(c)) for c in r] for r in rows]
    widths = [max(len(r[i]) for r in cols) for i in range(len(headers))]
    out("| " + " | ".join(cols[0][i].ljust(widths[i]) for i in range(len(headers))) + " |")
    out("|" + "|".join("-" * (widths[i] + 2) for i in range(len(headers))) + "|")
    for r in cols[1:]:
        out("| " + " | ".join(r[i].ljust(widths[i]) for i in range(len(headers))) + " |")


def q(cur, query, params=None):
    cur.execute(query, params)
    return cur.fetchall()


def safe(section_name, fn, *a, **kw):
    """Run a section; on failure record the error and continue with the rest."""
    try:
        return fn(*a, **kw)
    except Exception as e:
        out()
        out(f"**SECTION FAILED — {section_name}:** `{type(e).__name__}: {e}`")
        out()
        out("```")
        for ln in traceback.format_exc().splitlines()[-6:]:
            out(ln)
        out("```")
        return None


# ── Repo-side facts (no DB) ───────────────────────────────────────────────────

def connector_modules():
    """Return {module_name: SOURCE literal or None} for every job module."""
    mods = {}
    if not os.path.isdir(JOBS_DIR):
        return mods
    for fn in sorted(os.listdir(JOBS_DIR)):
        if not fn.endswith(".py") or fn == "__init__.py":
            continue
        mod = fn[:-3]
        src = None
        with open(os.path.join(JOBS_DIR, fn), "r", encoding="utf-8", errors="replace") as fh:
            m = re.search(r'^\s*SOURCE\s*=\s*["\']([^"\']+)["\']', fh.read(), re.M)
            if m:
                src = m.group(1)
        mods[mod] = src
    return mods


def registered_jobs():
    """Parse scheduler.py add_job() calls -> {module: job_id}."""
    if not os.path.isfile(SCHEDULER_PY):
        return {}
    with open(SCHEDULER_PY, "r", encoding="utf-8", errors="replace") as fh:
        src = fh.read()
    found = {}
    for m in re.finditer(r'add_job\(\s*func=(\w+)\.run\b(.*?)\bid=["\']([^"\']+)["\']', src, re.S):
        found[m.group(1)] = m.group(3)
    return found


# ── DB sections ───────────────────────────────────────────────────────────────

def base_tables(cur):
    """Every base table in every non-system schema."""
    return q(cur, """
        select n.nspname, c.relname, c.oid,
               pg_total_relation_size(c.oid) as total_bytes
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where c.relkind = 'r'
          and n.nspname not in %s
          and n.nspname not like 'pg_toast%%'
          and n.nspname not like 'pg_temp%%'
        order by n.nspname, c.relname
    """, (SYSTEM_SCHEMAS,))


def section_1_inventory(cur, tables):
    h1("1. Schema inventory — all non-system schemas")
    rows = []
    for schema, tname, _oid, total_bytes in tables:
        try:
            n = q(cur, sql.SQL("select count(*) from {}.{}").format(
                sql.Identifier(schema), sql.Identifier(tname)))[0][0]
        except Exception as e:
            cur.connection.rollback()
            n = f"ERR: {type(e).__name__}"
        rows.append((schema, tname, n, total_bytes))

    numeric = [r for r in rows if isinstance(r[2], int)]
    errored = [r for r in rows if not isinstance(r[2], int)]
    numeric.sort(key=lambda r: r[2], reverse=True)

    out(f"Base tables found: **{len(rows)}** across "
        f"**{len({r[0] for r in rows})}** schema(s). Sorted by exact row count, descending.")
    out()
    table([(s, t, f"{n:,}", fmt_bytes(b)) for s, t, n, b in numeric],
          ["schema", "table", "exact rows", "size on disk"])
    if errored:
        out()
        out("Uncountable (permission or lock):")
        table([(s, t, n, fmt_bytes(b)) for s, t, n, b in errored],
              ["schema", "table", "error", "size on disk"])
    total = sum(r[3] or 0 for r in rows)
    out()
    out(f"Sum of table sizes (incl. indexes/TOAST): **{fmt_bytes(total)}**")
    return {(r[0], r[1]) for r in rows}


def columns_of(cur, schema, tname):
    return q(cur, """
        select column_name, data_type
        from information_schema.columns
        where table_schema = %s and table_name = %s
        order by ordinal_position
    """, (schema, tname))


def pick_ts(cols):
    ts = [c for c, d in cols if d.startswith("timestamp") or d == "date"]
    for pref in TS_PREFERENCE:
        if pref in ts:
            return pref
    return ts[0] if ts else None


def section_2_raw_by_source(cur, tables):
    h1("2. Raw layer by source")
    out("Source and timestamp columns discovered via `information_schema` — not assumed.")
    out()
    hits = []
    for schema, tname, _oid, _b in tables:
        cols = columns_of(cur, schema, tname)
        names = [c for c, _ in cols]
        scol = next((c for c in SOURCE_COL_CANDIDATES if c in names), None)
        if scol:
            hits.append((schema, tname, scol, pick_ts(cols)))

    if not hits:
        out("**No table in any non-system schema carries a source/connector column.**")
        return
    out(f"Tables carrying a source-style column: "
        + ", ".join(f"`{s}.{t}` (source col `{sc}`, ts col `{tc or 'none'}`)" for s, t, sc, tc in hits))

    for schema, tname, scol, tscol in hits:
        out()
        out(f"### `{schema}.{tname}` — grouped by `{scol}`")
        out()
        if tscol:
            stmt = sql.SQL(
                "select {s}::text, count(*), min({t})::text, max({t})::text "
                "from {sch}.{tbl} group by 1 order by 2 desc"
            ).format(s=sql.Identifier(scol), t=sql.Identifier(tscol),
                     sch=sql.Identifier(schema), tbl=sql.Identifier(tname))
            hdr = [scol, "rows", f"earliest {tscol}", f"latest {tscol}"]
        else:
            stmt = sql.SQL("select {s}::text, count(*) from {sch}.{tbl} group by 1 order by 2 desc").format(
                s=sql.Identifier(scol), sch=sql.Identifier(schema), tbl=sql.Identifier(tname))
            hdr = [scol, "rows"]
        try:
            rows = q(cur, stmt)
        except Exception as e:
            cur.connection.rollback()
            out(f"query failed: `{type(e).__name__}: {e}`")
            continue
        if not rows:
            out("**Table is empty — zero rows, so no sources present.**")
        else:
            table([tuple(("{:,}".format(c) if isinstance(c, int) else c) for c in r) for r in rows], hdr)


def section_28_scheduler(cur, tables):
    h1("2.8 Scheduler deployment state")

    # (a)/(b) repo-side deployment config
    out("### (a)+(b) Deployment configuration present in the repo")
    out()
    candidates = {
        "connectors/Dockerfile": "Dockerfile for the scheduler image",
        ".github/workflows/deploy-scheduler.yml": "GitHub Actions build+deploy pipeline",
        "infra/scheduler/setup.sh": "One-time Azure bootstrap (ACR, Container App, OIDC, GH secrets)",
        "infra/scheduler/provision.py": "Provisioning helper",
        "infra/scheduler/README.md": "Deployment runbook",
        "fly.toml": "Fly.io", "railway.json": "Railway", "render.yaml": "Render",
        "docker-compose.yml": "Docker Compose", "Procfile": "Heroku-style",
    }
    rows = []
    for rel, desc in candidates.items():
        rows.append((rel, "YES" if os.path.exists(os.path.join(REPO_ROOT, *rel.split("/"))) else "no", desc))
    table(rows, ["path", "exists", "what it is"])

    # (c) apscheduler_jobs contents
    out()
    out("### (c) `apscheduler_jobs` contents")
    out()
    loc = [(s, t) for s, t, _o, _b in tables if t == "apscheduler_jobs"]
    if not loc:
        out("**HEADLINE: the `apscheduler_jobs` table DOES NOT EXIST in any non-system schema.**")
        return set()
    schema, tname = loc[0]
    rows = q(cur, sql.SQL("select id, next_run_time, job_state from {}.{} order by next_run_time nulls last").format(
        sql.Identifier(schema), sql.Identifier(tname)))
    if not rows:
        out(f"**HEADLINE: `{schema}.{tname}` EXISTS but is EMPTY — zero registered jobs.**")
        out()
        out("The table was created by migration `12-apscheduler-jobs-table.sql`. APScheduler "
            "writes a row per job on `add_job()`, so an empty table means `register_jobs()` "
            "has never executed against this database.")
        return set()

    out(f"`{schema}.{tname}` contains **{len(rows)}** row(s).")
    out()
    disp, ids = [], set()
    for jid, nrt, jstate in rows:
        ids.add(jid)
        if nrt is None:
            when = "paused (null)"
        else:
            f = float(nrt) if isinstance(nrt, Decimal) else float(nrt)
            when = datetime.fromtimestamp(f, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%SZ")
        trig, name = "unreadable", "—"
        try:
            # Own job store, written by our own scheduler; APScheduler pickles the
            # job STATE DICT (not the Job object), so trigger is a plain attribute.
            st = pickle.loads(bytes(jstate))
            trig = str(st.get("trigger", "—"))
            name = str(st.get("name", "—"))
        except Exception as e:
            trig = f"unpickle failed: {type(e).__name__}"
        disp.append((jid, name, when, trig))
    table(disp, ["job id", "name", "next run time (UTC)", "trigger"])
    return ids


def section_4_run_history(cur, tables):
    h1("4. Connector run history")
    pat = re.compile(r"(run|pull|job|fail|error|log|sync|incident|history)", re.I)
    found = [(s, t) for s, t, _o, _b in tables
             if pat.search(t) and t not in ("apscheduler_jobs",)]
    if found:
        out("Candidate run/log tables discovered by name pattern:")
        out()
        rows = []
        for s, t in found:
            n = q(cur, sql.SQL("select count(*) from {}.{}").format(sql.Identifier(s), sql.Identifier(t)))[0][0]
            cols = ", ".join(c for c, _ in columns_of(cur, s, t))
            rows.append((f"{s}.{t}", f"{n:,}", cols[:110] + ("…" if len(cols) > 110 else "")))
        table(rows, ["table", "rows", "columns"])
    else:
        out("**No dedicated connector run-log / pull-log / failure table exists** in any "
            "non-system schema. No such table is defined in `lib/migrations/` either.")

    # Derived history from api_raw, which records response_status per pull_id.
    raw = [(s, t) for s, t, _o, _b in tables if t == "api_raw"]
    out()
    out("### Derived from `api_raw` (`pull_id` = one connector run)")
    out()
    if not raw:
        out("`api_raw` does not exist — no run history can be derived.")
        return
    s, t = raw[0]
    rows = q(cur, sql.SQL("""
        with per_pull as (
          select source, pull_id,
                 max(received_at) as ran_at,
                 max(case when response_status >= 400 then 1 else 0 end) as failed
          from {sch}.{tbl} group by source, pull_id
        )
        select source, count(*) as runs,
               sum(case when failed = 0 then 1 else 0 end) as successes,
               sum(failed) as failures,
               max(ran_at)::text as last_run
        from per_pull group by source order by runs desc
    """).format(sch=sql.Identifier(s), tbl=sql.Identifier(t)))
    if not rows:
        out("**`api_raw` is empty — zero connector runs have ever been recorded.**")
        return
    table([(r[0], f"{r[1]:,}", f"{r[2]:,}", f"{r[3]:,}", r[4]) for r in rows],
          ["source", "total runs", "successes", "failures", "last run (UTC)"])

    errs = q(cur, sql.SQL("""
        select distinct on (source) source, received_at::text, response_status,
               left(response_body::text, 300)
        from {sch}.{tbl} where response_status >= 400
        order by source, received_at desc
    """).format(sch=sql.Identifier(s), tbl=sql.Identifier(t)))
    out()
    if errs:
        out("Most recent error per source (response body truncated to 300 chars):")
        out()
        table([(e[0], e[1], e[2], (e[3] or "").replace("\n", " ").replace("|", "\\|")) for e in errs],
              ["source", "when (UTC)", "status", "last error"])
    else:
        out("No rows with `response_status >= 400` — no recorded connector failures.")


def section_5_baselines(cur, tables):
    h1("5. Baselines")
    found = [(s, t) for s, t, _o, _b in tables if "baseline" in t.lower()]
    if not found:
        out("**No baselines table exists** in any non-system schema, and none is defined "
            "in `lib/migrations/`.")
        return
    for s, t in found:
        cols = columns_of(cur, s, t)
        names = [c for c, _ in cols]
        n = q(cur, sql.SQL("select count(*) from {}.{}").format(sql.Identifier(s), sql.Identifier(t)))[0][0]
        out(f"### `{s}.{t}` — {n:,} rows")
        out()
        out("Columns: " + ", ".join(f"`{c}`" for c in names))
        out()
        for label, cands in (("distinct metrics", ("metric", "metric_name", "kpi")),
                             ("distinct sources", SOURCE_COL_CANDIDATES)):
            col = next((c for c in cands if c in names), None)
            if col:
                vals = q(cur, sql.SQL("select count(distinct {}) from {}.{}").format(
                    sql.Identifier(col), sql.Identifier(s), sql.Identifier(t)))[0][0]
                out(f"- {label} (`{col}`): **{vals}**")
            else:
                out(f"- {label}: no matching column")
        tscol = pick_ts(cols)
        if tscol:
            lo, hi = q(cur, sql.SQL("select min({t})::text, max({t})::text from {sch}.{tbl}").format(
                t=sql.Identifier(tscol), sch=sql.Identifier(s), tbl=sql.Identifier(t)))[0]
            out(f"- date range (`{tscol}`): **{lo or '—'} → {hi or '—'}**")


def section_6_phase0(cur, tables):
    h1("6. Phase 0 artefacts")
    present = {t: s for s, t, _o, _b in tables}
    targets = [
        ("breach_log", "GDPR breach register (migration 09)"),
        ("identity_map", "identity mapping table"),
        ("api_raw_archive", "archival job target — `archive_old_api_raw()` (migration 08)"),
    ]
    rows = []
    for t, desc in targets:
        if t in present:
            s = present[t]
            n = q(cur, sql.SQL("select count(*) from {}.{}").format(sql.Identifier(s), sql.Identifier(t)))[0][0]
            rows.append((t, "YES", f"{s}", f"{n:,}", desc))
        else:
            rows.append((t, "**NO**", "—", "—", desc))
    table(rows, ["table", "exists", "schema", "rows", "notes"])

    out()
    try:
        jobs = q(cur, "select jobname, schedule, active from cron.job order by jobname")
        if jobs:
            out("`cron.job` (pg_cron) entries:")
            out()
            table([(j[0], j[1], str(j[2])) for j in jobs], ["job name", "schedule", "active"])
        else:
            out("`cron.job` is readable but **empty — no pg_cron jobs scheduled**.")
    except Exception as e:
        cur.connection.rollback()
        out(f"`cron.job` not readable: `{type(e).__name__}: {str(e).strip()}`")


def section_7_tier(cur):
    h1("7. Supabase tier signal — size and connection limits")
    size = q(cur, "select pg_database_size(current_database()), current_database()")[0]
    out(f"- Current database (`{size[1]}`) size: **{fmt_bytes(size[0])}** ({size[0]:,} bytes)")
    for guc in ("max_connections", "superuser_reserved_connections", "server_version"):
        try:
            v = q(cur, "select current_setting(%s)", (guc,))[0][0]
            out(f"- `{guc}`: **{v}**")
        except Exception as e:
            cur.connection.rollback()
            out(f"- `{guc}`: unavailable ({type(e).__name__})")
    try:
        tot, act, idle = q(cur, """
            select count(*),
                   count(*) filter (where state = 'active'),
                   count(*) filter (where state = 'idle')
            from pg_stat_activity
        """)[0]
        out(f"- Backends currently connected: **{tot}** (active {act}, idle {idle})")
    except Exception as e:
        cur.connection.rollback()
        out(f"- `pg_stat_activity`: unavailable ({type(e).__name__})")
    try:
        lim = q(cur, "select datconnlimit from pg_database where datname = current_database()")[0][0]
        out(f"- Per-database connection limit (`datconnlimit`): **{'unlimited (-1)' if lim == -1 else lim}**")
    except Exception:
        cur.connection.rollback()
    try:
        who, rl = q(cur, "select current_user, rolconnlimit from pg_roles where rolname = current_user")[0]
        out(f"- Connection limit for role `{who}` (`rolconnlimit`): "
            f"**{'unlimited (-1)' if rl == -1 else rl}**")
    except Exception:
        cur.connection.rollback()
    out()
    out("> Note: this session is via the Supabase **connection pooler**, so the values above "
        "describe the Postgres instance behind the pooler, not the pooler's own client limit.")


def section_3_crossref(cur, tables, job_ids):
    h1("3. Cross-reference — one row per connector")
    mods = connector_modules()
    reg = registered_jobs()

    data_counts = {}
    for tname in ("api_clean", "api_raw"):
        loc = [(s, t) for s, t, _o, _b in tables if t == tname]
        if not loc:
            continue
        s, t = loc[0]
        try:
            for src, n in q(cur, sql.SQL("select source::text, count(*) from {}.{} group by 1").format(
                    sql.Identifier(s), sql.Identifier(t))):
                data_counts.setdefault(src, {})[tname] = n
        except Exception:
            cur.connection.rollback()

    rows = []
    for mod in sorted(mods):
        src = mods[mod]
        job_id = reg.get(mod)
        counts = data_counts.get(src, {}) if src else {}
        raw_n, clean_n = counts.get("api_raw", 0), counts.get("api_clean", 0)
        if raw_n or clean_n:
            data = f"YES (raw {raw_n:,} / clean {clean_n:,})"
        else:
            data = "NO"
        rows.append((
            mod,
            src or "—",
            "YES",
            f"YES ({job_id})" if job_id else "NO",
            "YES" if job_id and job_id in job_ids else "NO",
            data,
        ))
    table(rows, ["connector module", "SOURCE", "CODE EXISTS", "JOB REGISTERED",
                 "JOB IN apscheduler_jobs", "DATA IN SUPABASE"])
    out()
    out(f"Modules on disk: **{len(mods)}**. Registered in `scheduler.py`: **{len(reg)}**. "
        f"Rows in `apscheduler_jobs`: **{len(job_ids)}**.")

    orphans = sorted(job_ids - set(reg.values()))
    if orphans:
        out()
        out("Job ids in the DB with no matching `add_job()` in `scheduler.py`: "
            + ", ".join(f"`{o}`" for o in orphans))

    unknown = sorted(k for k in data_counts if k not in {v for v in mods.values() if v})
    if unknown:
        out()
        out("`source` values present in the data with no matching connector module: "
            + ", ".join(f"`{u}`" for u in unknown))


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    started = datetime.now(timezone.utc)
    out(f"# Supabase production database audit — {started.strftime('%Y-%m-%d')}")
    out()
    out(f"- Generated: `{started.strftime('%Y-%m-%d %H:%M:%SZ')}` (UTC)")
    out("- Mode: **read-only diagnostic** (READ ONLY transaction; no DDL, no DML)")
    out(f"- Credential: Key Vault secret `{DB_SECRET}` from `doddl-kv-prod` (value never printed)")
    out("- Connection: Supabase **pooler URL exactly as stored** (not rewritten to a direct host)")

    try:
        dsn = get_secret(DB_SECRET)
    except Exception as e:
        print(f"\nBLOCKED — could not read '{DB_SECRET}' from Key Vault: {type(e).__name__}: {e}")
        raise SystemExit(2)

    try:
        conn = psycopg2.connect(dsn)
    except Exception as e:
        print(f"\nBLOCKED — connection refused by the pooler: {type(e).__name__}: {e}")
        raise SystemExit(3)
    del dsn

    try:
        # Driver-level read-only enforcement: every transaction begins READ ONLY,
        # so the server rejects any accidental write.
        conn.set_session(readonly=True, autocommit=False)
        cur = conn.cursor()
        ro = q(cur, "select current_setting('transaction_read_only'), version()")[0]
        out(f"- Session `transaction_read_only`: **{ro[0]}**")
        out(f"- Server: `{ro[1].split(' on ')[0]}`")

        tables = base_tables(cur)
        safe("1 schema inventory", section_1_inventory, cur, tables)
        safe("2 raw layer by source", section_2_raw_by_source, cur, tables)
        job_ids = safe("2.8 scheduler state", section_28_scheduler, cur, tables)
        safe("4 run history", section_4_run_history, cur, tables)
        safe("5 baselines", section_5_baselines, cur, tables)
        safe("6 phase 0 artefacts", section_6_phase0, cur, tables)
        safe("7 tier signal", section_7_tier, cur)
        safe("3 cross-reference", section_3_crossref, cur, tables, job_ids or set())
    finally:
        conn.rollback()
        conn.close()

    os.makedirs(REPORT_DIR, exist_ok=True)
    path = os.path.join(REPORT_DIR, f"db-audit-{started.strftime('%Y-%m-%d')}.md")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(_lines) + "\n")
    print(f"\nReport written: {os.path.relpath(path, REPO_ROOT)}")


if __name__ == "__main__":
    main()
