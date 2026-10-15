# Sales & Traffic Backfill — Azure Container App Job Runbook

**For:** Jon — one operator, Azure Cloud Shell
**Where:** <https://shell.azure.com>
**Date written:** 2026-08-19
**Run this:** once per backfill range you want to run (the job is reusable — re-trigger with a different `BACKFILL_START` for a different range; `BACKFILL_END` now defaults to yesterday and is normally left unset)

> **Update 2026-09-01:** `BACKFILL_END` defaults to yesterday in code — Section D
> no longer sets it. Active scope is now **9 marketplaces** (7 EU + 2 NA), not the
> 15 the measured findings below were written against (BE/PL/SE/TR/AE/SA/JP/MX all
> dropped or paused since — see `ACTIVE_MARKETPLACES` in `amazon_sp_api.py`). The
> per-pair timing and rate-limit findings still hold; only the pair *count* is
> lower. To fill the current gap, run Section D as written with `BACKFILL_START`
> at the last known-good date (`2026-05-01` is always safe — earlier `ok` days
> skip fast).

> This runs `connectors/scheduler/backfill_sales_traffic.py`
> (`python -m connectors.scheduler.backfill_sales_traffic`) as a standalone
> **Azure Container App Job** — not the scheduler's continuously-running
> Container App, and not a local background process. Local background
> processes on this machine have been killed by something outside our control
> three separate times during testing; that's the whole reason this exists as
> a Job instead.

---

## Before you start

**Scope, from the measured Step 1 tests (not assumptions):**

- 15 marketplaces (13 EU, 2 NA) × up to 108 days = up to 1,620 (marketplace, day) pairs for the full 2026-05-01→2026-08-16 range. Japan is permanently out of scope — `FE-JP` has no working credentials in Key Vault (confirmed live, not untested).
- EU and NA run as two parallel threads inside the one job replica — confirmed independent rate-limit buckets (Test 1b).
- **Deliberate pacing (default 65s between `createReport` calls) does NOT reliably avoid 429s** — measured 5/12 (42%) hit rate at a strict 65s gap (Test 1a). The job survives this via the same retry-with-backoff already proven in production (`_fetch_sales_traffic_day`), not via the pacing interval. Don't expect a faster wall-clock time by lowering `BACKFILL_PACE_SECONDS` — the evidence doesn't support that.
- **Revised time estimate: EU alone (1,404 of the 1,620 pairs) at the already-observed real-world ~3.7 min/pair ≈ ~87 hours (~3.6 days).** NA's 216 pairs run in parallel alongside EU and don't add to this, since wall time is `max(EU, NA)`, not the sum. This is well past the ~29 hours a naive 65s-floor calculation would suggest — flagged here so the timeout setting below isn't a surprise.
- **It is idempotent and resumable at any point**, including if it hits the job's own `--replica-timeout`. If that happens, it is not a failure — just start a new execution with the same `BACKFILL_START` (and the same default `BACKFILL_END`); `resume=True` picks up exactly where it left off (already proven locally, three times, across kills and one real crash).

**A real prerequisite this runbook assumes and does not itself perform:** the image at `doddlacr.azurecr.io/doddl-scheduler:latest` must actually contain `connectors/scheduler/backfill_sales_traffic.py`. That file was written and tested locally this session but has **not** been committed, pushed, or built into any image. Section A below rebuilds the image from the current `staging` checkout before creating the job, using the same `az acr build` mechanism as the original scheduler bootstrap (`infra/scheduler/bootstrap-corrected.md` Section C5) — so the file needs to be committed and pushed to `staging` (or otherwise present in whatever you check out in Cloud Shell) before you run Section A, or the build won't include it.

**On `--replica-timeout`'s actual ceiling:** Microsoft's own Container Apps Jobs documentation describes this setting ("the maximum time in seconds to wait for a replica to complete") without stating a hard maximum in what I could fetch. This runbook sets it to `86400` (24 hours) as a reasonably high value, not a confirmed-safe maximum — if `az containerapp job create` rejects it as too high, back it off and expect to re-trigger the job more than once for a full-range backfill, which is fine given the resumability above.

---

## Section A — Rebuild the image with the new orchestrator file

```bash
RESOURCE_GROUP="doddl-ai-os-production"
ACR_NAME="doddlacr"
IMAGE_NAME="doddl-scheduler"
CONTAINER_APP_ENV="doddl-scheduler-env"
KEYVAULT_NAME="doddl-kv-prod"
JOB_NAME="doddl-backfill-sales-traffic"

cd ~
rm -rf doddl-pm
git clone https://github.com/D0DDL/doddl-pm
cd doddl-pm
git checkout staging
ls connectors/scheduler/backfill_sales_traffic.py

az acr build \
  --registry "$ACR_NAME" \
  --image "$IMAGE_NAME:latest" \
  --file connectors/Dockerfile \
  .
```

**What this does:** Same checkout-and-build pattern as the original bootstrap (Section A/C5 of `bootstrap-corrected.md`), rebuilding `doddlacr.azurecr.io/doddl-scheduler:latest` from whatever is currently on `staging`.

**Success looks like:** `ls` prints `connectors/scheduler/backfill_sales_traffic.py` (confirms the file is actually in this checkout — **if this errors, stop, the file hasn't been pushed yet**), then `az acr build` ends with `Run ID: ... was successful after ...`.

---

## Section B — Create the job

```bash
CONTAINER_APP_ENV_ID=$(az containerapp env show \
  --name "$CONTAINER_APP_ENV" --resource-group "$RESOURCE_GROUP" \
  --query id -o tsv)
ACR_LOGIN_SERVER=$(az acr show --name "$ACR_NAME" --query loginServer -o tsv)

az containerapp job create \
  --name "$JOB_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --environment "$CONTAINER_APP_ENV_ID" \
  --trigger-type "Manual" \
  --replica-timeout 86400 \
  --replica-retry-limit 0 \
  --replica-completion-count 1 \
  --parallelism 1 \
  --image "$ACR_LOGIN_SERVER/$IMAGE_NAME:latest" \
  --registry-server "$ACR_LOGIN_SERVER" \
  --registry-identity system \
  --cpu 0.5 --memory 1.0Gi \
  --command "python" "-m" "connectors.scheduler.backfill_sales_traffic" \
  --env-vars "AZURE_KEYVAULT_URI=https://doddl-kv-prod.vault.azure.net/" \
  --tags project=doddl-ai-os environment=production purpose=sales-traffic-backfill
```

**What this does:**

- `--environment` points the job at the **same** Container Apps Environment the scheduler app runs in — this is what gives it the same VNet/subnet (`doddl-scheduler-vnet` / `scheduler-infra-subnet`) automatically, since VNet integration is an environment-level setting, not a per-app one. No separate VNet configuration needed.
- `--trigger-type Manual`, `--replica-retry-limit 0`: Azure won't auto-retry a failed/timed-out execution. This is deliberate, per spec — the job is internally resumable; an automatic retry would just start over and burn time re-checking already-`ok` days instead of you deciding when to re-trigger.
- `--replica-timeout 86400`: see the caveat above.
- `--registry-identity system`: gives the job its **own** system-assigned managed identity (distinct from the scheduler app's — identities aren't shared across resources this way). Section C grants it Key Vault access separately.
- `--command`: overrides the image's default `CMD ["python", "-m", "connectors.scheduler.scheduler"]` to run the orchestrator instead.
- **Deliberately no `BACKFILL_START`/`BACKFILL_END`/`BACKFILL_MARKETPLACES` here** — those are supplied per-execution in Section D, not baked into the job definition, so the same job can be re-triggered for different ranges without recreating it. `AZURE_KEYVAULT_URI` is baked in since it never changes.
- No `AZURE_TENANT_ID` — deliberately absent, matching the scheduler app's existing configuration and the documented reason (`reports/scheduler-deploy-prep.md`): with it absent, `DefaultAzureCredential` resolves cleanly via `ManagedIdentityCredential` in a headless container; with it present, a failed managed-identity lookup falls through to an interactive browser credential that can't succeed here.

**Success looks like:** JSON ending `"provisioningState": "Succeeded"`.

---

## Section C — Grant the job's identity Key Vault access

```bash
JOB_PRINCIPAL=$(az containerapp job show \
  --name "$JOB_NAME" --resource-group "$RESOURCE_GROUP" \
  --query "identity.principalId" -o tsv)
echo "JOB_PRINCIPAL = $JOB_PRINCIPAL"

az keyvault set-policy \
  --name "$KEYVAULT_NAME" \
  --object-id "$JOB_PRINCIPAL" \
  --secret-permissions get list
```

**What this does:** Same grant as Section D of the original scheduler bootstrap, for this job's own identity — `doddl-kv-prod` uses access policies, not RBAC (confirmed in that runbook), so this is the call that actually matters, not a role assignment.

**Success looks like:** `JOB_PRINCIPAL = ` followed by a GUID, then JSON ending `"provisioningState": "Succeeded"`.

**No Key Vault firewall change needed here** — the job shares the scheduler environment's VNet (Section B), and that VNet's subnet is already in `doddl-kv-prod`'s `virtual_network_rules` (confirmed present, untouched, throughout this session's local firewall changes).

---

## Section D — Start an execution

```bash
az containerapp job start \
  --name "$JOB_NAME" --resource-group "$RESOURCE_GROUP" \
  --yaml - <<'EOF'
containers:
- name: main
  image: doddlacr.azurecr.io/doddl-scheduler:latest
  command: ["python", "-m", "connectors.scheduler.backfill_sales_traffic"]
  resources:
    cpu: 0.5
    memory: 1.0Gi
  env:
  - name: AZURE_KEYVAULT_URI
    value: "https://doddl-kv-prod.vault.azure.net/"
  - name: BACKFILL_START
    value: "2026-05-01"
EOF
```

**What this does:** Starts one execution with `BACKFILL_START` overridden for this run — per-execution overrides replace the whole template for that execution only (per Microsoft's docs: "the job's entire template configuration is replaced," which is why `AZURE_KEYVAULT_URI`, image, command, and resources are repeated here even though they're already on the job definition).

**`BACKFILL_END` is deliberately not set.** It defaults to yesterday (`today - 1 day`) in `backfill_sales_traffic.py`. Amazon's sales/traffic data for a day isn't final until that marketplace's day has closed, so yesterday is the furthest forward worth requesting, and leaving it unset means the range always reaches up to yesterday instead of stopping at a date someone typed once. An earlier version of this runbook pinned `BACKFILL_END=2026-08-16`; that value went stale and silently capped the backfill while nightly data had also stopped landing — hence the default. Only set `BACKFILL_END` to reproduce a historical run or to deliberately stop short of yesterday. The run is idempotent and keyed by `(marketplace_id, date)`, so re-triggering with the same `BACKFILL_START` and the (moving) default end just fills whatever days have appeared since — already-`ok` days are skipped fast.

`BACKFILL_MARKETPLACES` is deliberately omitted — defaults to `ACTIVE_MARKETPLACES` (currently 9). To backfill a subset instead, add e.g.:
```yaml
  - name: BACKFILL_MARKETPLACES
    value: "A1F83G8C2ARO7P,A1PA6795UKMFR9"
```

To resume after a timeout or a manual stop, run this **exact same command again unchanged** — `resume=True` is not a flag you set, it's how `run_sales_traffic_backfill`/`_fetch_sales_traffic_day` already work.

**Success looks like:** the command returns without error and prints the started execution's name.

---

## Section E — Watch progress and read logs

```bash
az containerapp job execution list \
  --name "$JOB_NAME" --resource-group "$RESOURCE_GROUP" \
  --query "[].{name:name, status:properties.status, start:properties.startTime}" -o table
```

**Success looks like:** one row, `status` moving `Running` → `Succeeded` (or `Failed`/`Stopped` if it hit the timeout — see "if something goes wrong" below).

**Read logs** (the orchestrator's own progress lines — `amazon_sp_backfill: DONE account=... marketplace=... date=... rows=... | N of M pairs complete, X% done, est. Yh remaining` — appear here):

```bash
az containerapp job logs show \
  --name "$JOB_NAME" --resource-group "$RESOURCE_GROUP" --follow
```

If that command isn't available in your CLI version, use the portal instead: **portal.azure.com → Container Apps Jobs → doddl-backfill-sales-traffic → Execution history → (execution) → Console logs**, matching the fallback the original scheduler runbook uses for the same reason.

---

## If something goes wrong

| What you see | What it means | Do |
|---|---|---|
| Execution status `Failed` almost immediately, no `PLAN:` log line | `BACKFILL_START` missing, `BACKFILL_START`/`BACKFILL_END` malformed, or `BACKFILL_MARKETPLACES` contains an unknown marketplace_id (`BACKFILL_END` unset is fine — it defaults to yesterday) | The orchestrator calls `SystemExit` with a specific message for each — read the log, fix the YAML in Section D, re-run |
| `amazon_sp_backfill: account=... — no token obtainable, skipping this account entirely` | That account's refresh token secret is missing/wrong in Key Vault | Same as the FE-JP finding this session — check the secret exists before assuming it's a job-config problem |
| Execution status `Failed`/`Stopped` after running for a long time, no Python traceback in the logs | Hit `--replica-timeout` (86400s) | **Not a failure to fix — expected for the full range.** Re-run Section D unchanged; resume picks up where it left off |
| A Python traceback in the logs | An actual unhandled exception — the known ones (bad upsert values, AccountSkipped) are already caught inside `_fetch_sales_traffic_day`/this orchestrator, so a traceback here is a *new* failure mode, not one already covered | Read the traceback, it's the real cause — don't assume it's the timeout |
| `Client address is not authorized` / `ForbiddenByFirewall` on a Key Vault call | The job's outbound path isn't actually covered by the VNet rule (e.g., wrong environment was used in Section B) | Re-check Section B used the *same* `$CONTAINER_APP_ENV` as the scheduler app, not a new one |

**Re-running is always safe** — same reasoning as the original scheduler bootstrap: nothing here deletes anything, and `resume=True` means re-triggering never duplicates work, it only continues it.
