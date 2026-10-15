# Scheduler Deployment Prep

**Date:** 2026-08-03 (revised same day — see Revision history)
**Author:** Claude Code (prep only — nothing deployed, no `az` commands run, nothing pushed)
**Repo:** `C:\Users\JonFawcett\Documents\doddl-pm` (branch `staging`, tip `0e68ecb`)

## Revision history

| Rev | Change |
|---|---|
| 1 | Initial prep: Actions diagnosis, bootstrap gaps, 5 out-of-scope jobs unregistered |
| 2 | Schedules changed to **daily staggered overnight cron**; `amazon_advertising` unregistered (API registration rejected); jobstore query result folded in; Key Vault 403 confirmed live; local-tooling issue recorded as WON'T FIX; corrected runbook written to `infra/scheduler/bootstrap-corrected.md` |
| 3 | **Step 1 conclusion corrected** — GitHub Actions is confirmed enabled on the repo (visually verified: "Allow all actions and reusable workflows"); the "Actions disabled" theory in rev 1 was wrong. Revised cause below. `infra/scheduler/bootstrap-corrected.md` revised to a single-operator runbook — Jon holds full subscription and Entra ID control, no Catherine/Jon rights split |

> Note: `C:\Users\JonFawcett\doddl-pm` is a stale second checkout (no `connectors/`,
> `infra/`, or `.github/`). All work in this report refers to the `Documents\` copy.

## Scope

Out of scope permanently (6): `xero`, `microsoft_clarity`, `mintsoft`, `semrush`,
`opinew`, and — added at rev 2 — `amazon_advertising`.

In scope (7): `shopify`, `amazon_sp_api`, `klaviyo`, `meta_ads`, `google_ads`,
`google_search_console`, `google_analytics`.

`amazon_advertising` was dropped because the **Amazon Advertising API partner
registration was rejected**. No credentials exist, so the connector cannot function.
Left registered it would fail every night and bury genuine failures in the incident log.
The module file is untouched and the registration is commented out, not deleted.

The `api_raw` export and truncate are cancelled and were not resumed. Production
`api_raw` was not read from, written to, or modified.

**Deployment mechanism:** `infra/scheduler/bootstrap-corrected.md` (new at rev 2) is the
runbook to execute. It supersedes `infra/scheduler/setup.sh`, which is left in place for
reference but must not be run — it has five defects, listed in that document.

---

## Step 1 — Why GitHub Actions never fired

### a) Exact trigger

From `.github/workflows/deploy-scheduler.yml` lines 6–12:

```yaml
on:
  push:
    branches: [staging]
    paths:
      - "connectors/**"
      - ".github/workflows/deploy-scheduler.yml"
  workflow_dispatch:
```

- **Branch:** `staging` only. Pushes to `main` never trigger it.
- **Path filter:** a push must touch `connectors/**` or the workflow file itself.
- Plus manual `workflow_dispatch`.

### b) Is the YAML valid?

**Yes — valid.** Verified with a real parser (`yaml.safe_load`): parses clean,
top-level keys `name`, `on`, `env`, `jobs`.

Also ruled out the usual silent-ignore causes:

| Check | Result |
|---|---|
| Byte-order mark | None — first bytes are `6E 61 6D 65` (`name`) |
| Tab characters | None |
| Line endings | LF throughout (0 CRLF) |
| File path / casing | `.github/workflows/deploy-scheduler.yml` — correct |
| Working tree vs commit | Identical, no uncommitted local edits |

The parser reports the `on:` key as boolean `True` — that is YAML 1.1 normalising
`on` to a boolean and is **not** a defect. GitHub's own parser handles this; every
GitHub workflow in existence has this property.

### c) Which branch does the workflow file live on?

- **`staging`: present** — `.github/workflows/deploy-scheduler.yml` is tracked at `0e68ecb`.
- **`main`: absent** — `git ls-tree -r main -- .github` returns nothing. `main` has no
  `.github` directory at all.

`git ls-remote origin` confirms GitHub's `refs/heads/staging` is at
`0e68ecb7704db1b0374e3d56bdf9946b49b35b66` — **the push did reach GitHub.** The
workflow file existed on the branch being pushed, at the pushed commit. That
precondition is satisfied.

### d) Did the 26 May commit touch a path matching the filter?

**Yes — two of them.** `git show --stat 0e68ecb`:

```
.github/workflows/deploy-scheduler.yml |  74 ++++
connectors/Dockerfile                  |  26 ++
infra/scheduler/README.md              |  92 ++++
infra/scheduler/setup.sh               | 175 ++++
```

`connectors/Dockerfile` matches `connectors/**`, and the workflow file matches its
own filter entry. The path filter was satisfied.

Also checked: `refs/remotes/origin/staging` reflog shows **12+ prior `update by push`
entries**, so `staging` was a long-established remote branch. This was an ordinary
update push, not a branch-creation push — path filters evaluate normally, and the
"path filters can't be evaluated on new branch creation" edge case does not apply.

### Most likely cause — REVISED at rev 3

**Rev 1 concluded GitHub Actions was disabled for the repo. This is wrong — corrected
here.** Jon confirmed visually that repo settings show **"Allow all actions and reusable
workflows."** Actions is enabled and unrestricted. The rev 1 conclusion is retracted;
everything else established in (a)–(d) above still holds and is what points to the real
cause below.

**Revised cause: the workflow file and the change that should have triggered it arrived
in the same push, and GitHub does not evaluate a workflow against the push that
introduces it.**

GitHub determines which workflows to run for a push by reading the workflow files as
they exist **at the start of push processing** — effectively the pre-push state of the
branch. Commit `0e68ecb` simultaneously:

- added `.github/workflows/deploy-scheduler.yml` to `staging` for the first time, and
- touched `connectors/Dockerfile`, which is exactly what that new workflow's `paths:`
  filter is meant to catch.

But the workflow didn't exist on `staging` *before* that push — there is nothing earlier
in `git log --all -- .github/workflows/deploy-scheduler.yml` (confirmed in (d)). A
workflow cannot be evaluated against a push that is simultaneously the one creating it.
So GitHub had no `deploy-scheduler.yml` to check the `paths:` filter against at the moment
it decided what to run, and the push produced no run — not because Actions was off, and
not because the filter didn't match, but because there was no workflow definition yet to
match it *with*.

This also explains the *complete* absence of runs, including failed ones: a workflow
that's skipped because it didn't exist yet leaves no run record at all — identical to
what disabled Actions would look like from the outside. That similarity is why rev 1's
theory was plausible and had to be checked directly rather than assumed.

**`origin/staging` has not moved since** — still at `0e68ecb` (confirmed in (c)/(d)
above) — so there has been no second push to give the workflow its first real chance to
fire. **The workflow is therefore probably correct and simply untested.** Nothing found
in Step 1(b)'s YAML validation or the trigger/path checks in (a) and (d) points to an
actual defect in the workflow itself.

**The manual escape hatch still doesn't exist, for an unrelated, still-valid reason.**
`workflow_dispatch` only appears in the Actions UI if the workflow file is on the
repository's **default branch**. The default branch is `main`, and `main` has no
`.github` directory at all (`origin/HEAD → main`, confirmed in (c)). So:

- The "Deploy Scheduler" workflow does not appear in the Actions tab.
- There is no "Run workflow" button.
- `infra/scheduler/README.md` lines 59–60 ("GitHub → Actions → Deploy Scheduler → Run
  workflow") **is wrong** and cannot work as written.

### What this means for the runbook

`bootstrap-corrected.md` builds and deploys everything by hand via `az` — it does not
depend on `deploy-scheduler.yml` firing. So this diagnosis doesn't block the bootstrap.
It matters for **after** the bootstrap: the very next ordinary push to `staging` that
touches `connectors/**` will be the workflow's first real test, since the file now
already exists on the branch. Worth watching that one push closely.

### What to check / do (not done here)

1. **No action needed on the "Actions disabled" theory — retracted.** Confirmed enabled.
2. To get `workflow_dispatch` working, the workflow file must reach `main`. `main` and
   `staging` have diverged (82 commits on `staging` not on `main`; 5 on `main` not on
   `staging`) — so this is a decision for you, not a mechanical merge. **Not actioned.**
3. Consider a small no-op push to `staging` touching `connectors/**` (or use manual
   dispatch once available via item 2) to confirm the workflow actually fires and
   completes, before relying on it for real deployments. **Not actioned — no push made.**

---

## Step 2 — What the bootstrap needs

### Blocking defects in `infra/scheduler/setup.sh`

Four issues would each stop the script or silently produce a broken deployment.
The sequence in 2(a) corrects all four.

**1. The resource group is never created — hard blocker.**
`setup.sh` sets `RESOURCE_GROUP="doddl-ai-os-production"` (line 25) and immediately
uses it on line 44, but there is **no `az group create` anywhere in the file**. You have
confirmed the RG does not exist. Because `az acr create` is wrapped in
`2>/dev/null || echo "  ACR already exists, skipping."`, the real error is discarded and
the script prints a *misleading success message*, then dies two lines later at
`ACR_LOGIN_SERVER=$(az acr show ...)` under `set -euo pipefail`.

**2. The federated credential is created against the wrong object — silent failure.**
Lines 139–147:

```bash
SP_OBJECT_ID=$(az ad sp show --id "$SP_APP_ID" --query id -o tsv)
az ad app federated-credential create --id "$SP_OBJECT_ID" ...
```

`az ad app federated-credential` expects the **application** object ID (or appId), not
the **service principal** object ID. These are different objects with different IDs, so
this call fails — and `2>/dev/null || echo "  Federated credential already exists."`
swallows the error and reports success. The result: OIDC login in the workflow fails at
`azure/login@v2` with `AADSTS70021: No matching federated identity record found`.

**3. Key Vault grant uses RBAC on an access-policy vault — silent no-op.**
Lines 105–109 create a `Key Vault Secrets User` **role assignment**. But
`infra/terraform/modules/keyvault/main.tf` provisions `doddl-kv-prod` with
`azurerm_key_vault_access_policy` resources and **no `enable_rbac_authorization = true`**
— i.e. legacy access-policy mode. On an access-policy vault an RBAC role assignment is
created successfully but grants **no effective data-plane access**. The container would
start, then fail on `get_secret("supabase-scheduler-db-url")` with a 403.

**4. The Key Vault firewall will block the Container App — CONFIRMED LIVE.**
`main.tf` lines 85–89 set `network_acls { default_action = "Deny", bypass = "AzureServices" }`
with empty `ip_rules`. Azure Container Apps egress is **not** covered by the
`AzureServices` bypass — it leaves via the environment's outbound public IP. Unless that
IP is added to `ip_rules` (or a private endpoint / subnet service endpoint is
configured), every Key Vault call from the scheduler times out or 403s. `setup.sh` does
not address this at all.

> **This is no longer a prediction.** On 2026-08-03 a genuine read against the live vault
> was refused:
>
> ```
> HTTP 403 Forbidden
> {"error":{"code":"Forbidden","message":"Client address is not authorized and
>  caller is not a trusted service.\r\nClient address: 86.173.70.241
>  Caller: appid=1950a258-227b-4e31-a9cf-717495945fc2;
>          oid=6286e79b-0ac1-4840-a92c-383002c42548;..."}}
> ```
>
> `default_action = "Deny"` is enforced on `doddl-kv-prod` right now, with an empty
> allow-list. Two things worth noting from that response:
>
> - The `oid` is Jon's entry in `admin_object_ids` (`terraform.tfvars:8`), so the
>   **data-plane access policy is correct** — this is purely the network ACL.
> - The `appid` `1950a258-...` is Microsoft Azure PowerShell, i.e. an ordinary
>   interactive caller was refused. A Container App will be refused identically.
>
> Section E of `bootstrap-corrected.md` is therefore **mandatory**, not precautionary.

**5. `docker build` cannot run in Azure Cloud Shell — found at rev 2.**
`setup.sh:69-74` (and `deploy-scheduler.yml:48`, which is fine because GitHub runners do
have Docker) call `docker build`. **Azure Cloud Shell has no Docker daemon**, so the
documented "run this once from Cloud Shell" path fails with "Cannot connect to the Docker
daemon" regardless of everything else. The runbook uses `az acr build` instead, which
performs the build server-side inside ACR and needs no local Docker.

> ⚠️ **Unresolved, and it affects the commands below.** Terraform declares
> `doddl-kv-prod` in RG `doddl-ai-os-production` — but that RG does not exist while the
> vault does. So the production Terraform was never applied as written, and the vault
> actually lives in some **other** resource group I cannot determine without running
> `az`. The sequence below discovers it at runtime rather than hard-coding a guess.
> Related: fixing items 3 and 4 by hand with `az` creates **drift** against
> `infra/terraform`. The cleaner path is to make those two changes in Terraform and
> apply. Your call — flagging, not choosing.

### a) Corrected command sequence for Azure Cloud Shell

All values filled in from the repo. `doddlacr` must be **globally** unique — if step 2
reports the name is taken, pick another and carry it through consistently.

```bash
# ── 0. Preflight ─────────────────────────────────────────────────────────────
SUBSCRIPTION_ID="a674bfa5-c168-480b-9768-046585d01f5f"
TENANT_ID="927d1e2c-7c8d-406f-8640-678dfce86b7d"
LOCATION="uksouth"
RESOURCE_GROUP="doddl-ai-os-production"
ACR_NAME="doddlacr"
CONTAINER_APP_ENV="doddl-scheduler-env"
CONTAINER_APP_NAME="doddl-scheduler"
KEYVAULT_NAME="doddl-kv-prod"
KEYVAULT_URI="https://doddl-kv-prod.vault.azure.net/"
GITHUB_REPO="D0DDL/doddl-pm"
IMAGE_NAME="doddl-scheduler"
SP_NAME="doddl-scheduler-github-actions"

az account set --subscription "$SUBSCRIPTION_ID"
az extension add --name containerapp --upgrade
az provider register --namespace Microsoft.App --wait
az provider register --namespace Microsoft.OperationalInsights --wait
az provider register --namespace Microsoft.ContainerRegistry --wait

# Confirm the ACR name is globally available before going further
az acr check-name --name "$ACR_NAME" -o table

# Discover where doddl-kv-prod ACTUALLY lives (Terraform's claim is unreliable)
KEYVAULT_RG=$(az keyvault show --name "$KEYVAULT_NAME" --query resourceGroup -o tsv)
KEYVAULT_ID=$(az keyvault show --name "$KEYVAULT_NAME" --query id -o tsv)
echo "Key Vault $KEYVAULT_NAME is in RG: $KEYVAULT_RG"

# Is the vault RBAC or access-policy? Determines step 6.
KV_RBAC=$(az keyvault show --name "$KEYVAULT_NAME" \
  --query properties.enableRbacAuthorization -o tsv)
echo "Key Vault RBAC mode: $KV_RBAC   (false/empty => access policies)"

# ── 1. Resource group (MISSING from setup.sh) ────────────────────────────────
az group create \
  --name "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --tags project=doddl-ai-os environment=production managed_by=manual

# ── 2. Azure Container Registry ──────────────────────────────────────────────
az acr create \
  --name "$ACR_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --sku Basic \
  --admin-enabled false \
  --tags project=doddl-ai-os environment=production managed_by=manual

ACR_LOGIN_SERVER=$(az acr show --name "$ACR_NAME" --query loginServer -o tsv)
ACR_ID=$(az acr show --name "$ACR_NAME" --query id -o tsv)
echo "ACR: $ACR_LOGIN_SERVER"

# ── 3. Container App environment ─────────────────────────────────────────────
az containerapp env create \
  --name "$CONTAINER_APP_ENV" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --tags project=doddl-ai-os environment=production

# ── 4. Build and push the first image ────────────────────────────────────────
# Run from the repo root, on the staging branch (main has no connectors/).
az acr login --name "$ACR_NAME"
docker build -f connectors/Dockerfile -t "$ACR_LOGIN_SERVER/$IMAGE_NAME:latest" .
docker push "$ACR_LOGIN_SERVER/$IMAGE_NAME:latest"

# ── 5. Container App with system-assigned managed identity ───────────────────
# Only AZURE_KEYVAULT_URI is set — deliberately NOT AZURE_TENANT_ID (see note below).
az containerapp create \
  --name "$CONTAINER_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --environment "$CONTAINER_APP_ENV" \
  --image "$ACR_LOGIN_SERVER/$IMAGE_NAME:latest" \
  --registry-server "$ACR_LOGIN_SERVER" \
  --registry-identity system \
  --min-replicas 1 --max-replicas 1 \
  --cpu 0.5 --memory 1.0Gi \
  --env-vars "AZURE_KEYVAULT_URI=$KEYVAULT_URI" \
  --tags project=doddl-ai-os environment=production

CONTAINER_APP_PRINCIPAL=$(az containerapp show \
  --name "$CONTAINER_APP_NAME" --resource-group "$RESOURCE_GROUP" \
  --query "identity.principalId" -o tsv)
echo "Container App MI principal: $CONTAINER_APP_PRINCIPAL"

# ── 6. Grant the managed identity read access to Key Vault ───────────────────
# Pick ONE branch based on $KV_RBAC from step 0.
if [ "$KV_RBAC" = "true" ]; then
  az role assignment create \
    --role "Key Vault Secrets User" \
    --assignee-object-id "$CONTAINER_APP_PRINCIPAL" \
    --assignee-principal-type ServicePrincipal \
    --scope "$KEYVAULT_ID"
else
  # Access-policy vault — an RBAC role assignment here would be a silent no-op.
  az keyvault set-policy \
    --name "$KEYVAULT_NAME" \
    --object-id "$CONTAINER_APP_PRINCIPAL" \
    --secret-permissions get list
fi

# ── 7. Open the Key Vault firewall to the Container App egress IP ────────────
# default_action=Deny + bypass=AzureServices does NOT cover Container Apps egress.
CAE_OUTBOUND_IP=$(az containerapp env show \
  --name "$CONTAINER_APP_ENV" --resource-group "$RESOURCE_GROUP" \
  --query "properties.staticIp" -o tsv)
echo "Container App env outbound IP: $CAE_OUTBOUND_IP"

az keyvault network-rule add \
  --name "$KEYVAULT_NAME" \
  --resource-group "$KEYVAULT_RG" \
  --ip-address "$CAE_OUTBOUND_IP"

# ── 8. Service principal for GitHub Actions OIDC ─────────────────────────────
SP_APP_ID=$(az ad sp list --display-name "$SP_NAME" --query "[0].appId" -o tsv)
if [ -z "$SP_APP_ID" ]; then
  SP_APP_ID=$(az ad sp create-for-rbac \
    --name "$SP_NAME" \
    --role contributor \
    --scopes "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP" \
    --query appId -o tsv)
fi
echo "SP appId: $SP_APP_ID"

az role assignment create --role AcrPush --assignee "$SP_APP_ID" --scope "$ACR_ID"

# FIXED: use the APPLICATION object id, not the service principal object id.
APP_OBJECT_ID=$(az ad app show --id "$SP_APP_ID" --query id -o tsv)
az ad app federated-credential create \
  --id "$APP_OBJECT_ID" \
  --parameters "{
    \"name\": \"github-actions-staging\",
    \"issuer\": \"https://token.actions.githubusercontent.com\",
    \"subject\": \"repo:$GITHUB_REPO:ref:refs/heads/staging\",
    \"audiences\": [\"api://AzureADTokenExchange\"]
  }"

# Verify it landed — do not trust a swallowed error
az ad app federated-credential list --id "$APP_OBJECT_ID" -o table

# ── 9. GitHub repository secrets ─────────────────────────────────────────────
gh secret set AZURE_CLIENT_ID       --body "$SP_APP_ID"          --repo "$GITHUB_REPO"
gh secret set AZURE_TENANT_ID       --body "$TENANT_ID"          --repo "$GITHUB_REPO"
gh secret set AZURE_SUBSCRIPTION_ID --body "$SUBSCRIPTION_ID"    --repo "$GITHUB_REPO"
gh secret set ACR_NAME              --body "$ACR_NAME"           --repo "$GITHUB_REPO"
gh secret set ACR_LOGIN_SERVER      --body "$ACR_LOGIN_SERVER"   --repo "$GITHUB_REPO"
gh secret set AZURE_RESOURCE_GROUP  --body "$RESOURCE_GROUP"     --repo "$GITHUB_REPO"
gh secret set CONTAINER_APP_NAME    --body "$CONTAINER_APP_NAME" --repo "$GITHUB_REPO"

gh secret list --repo "$GITHUB_REPO"
```

**Why `AZURE_TENANT_ID` must not be set on the Container App:**
`connectors/lib/secrets.py` lines 38–54 — when `AZURE_TENANT_ID` is present it builds a
`ChainedTokenCredential(ManagedIdentityCredential(), InteractiveBrowserCredential(...))`.
In a headless container, if managed identity fails the chain falls through to an
*interactive browser* credential, which cannot succeed and will hang or throw a
confusing error. With the variable absent it uses `DefaultAzureCredential()`, which
resolves managed identity cleanly. Note this is the opposite of the GitHub secret, where
`AZURE_TENANT_ID` **is** required.

### b) Azure permissions required — and who can do what

> **Superseded at rev 3.** This table was written from rev 1's assumption of a
> Catherine/Jon rights split. Jon has confirmed full control of the Azure subscription
> and Entra ID — **there is no split.** `infra/scheduler/bootstrap-corrected.md` now runs
> as one continuous session, Sections A–H, no handover. The table below is kept as a
> record of which Azure permission each step actually needs (still accurate on that
> narrower point), not as a division of labour.

| # | Action | Permission required | Non-admin? |
|---|---|---|---|
| 0 | `az provider register` (Microsoft.App, OperationalInsights, ContainerRegistry) | Contributor/Owner at **subscription** scope | covered — Jon has subscription control |
| 1 | `az group create` | Contributor/Owner at **subscription** scope | covered |
| 2 | `az acr create` | Contributor on the RG | covered |
| 3 | `az containerapp env create` | Contributor on the RG | covered |
| 4 | image build (`az acr build` in the runbook) | `AcrPush`/Contributor on the ACR | covered |
| 5 | `az containerapp create --registry-identity system` | Contributor on RG **plus** `User Access Administrator`/`Owner` on the ACR scope — az implicitly creates an `AcrPull` role assignment for the new identity | covered — Jon has Entra ID control |
| 6 | Key Vault grant — `az keyvault set-policy` | Control-plane `Microsoft.KeyVault/vaults/write` → **Key Vault Contributor** or Contributor on the vault | covered |
| 7 | `az keyvault network-rule add` | Same control-plane right as #6 | covered |
| 8a | `az ad sp create-for-rbac` | Entra ID **Application Developer** role, or tenant setting "users can register applications = Yes" | covered |
| 8b | `--role contributor --scopes <RG>` role assignment | `User Access Administrator`/`Owner` on the RG | covered |
| 8c | `AcrPush` role assignment for the SP | `User Access Administrator`/`Owner` on the ACR | covered |
| 8d | `az ad app federated-credential create` | **Owner** of the app registration (the creator is an owner by default — automatic since the same operator runs 8a) | covered |
| 9 | `gh secret set` | **Admin** on `D0DDL/doddl-pm` | confirm Jon holds repo admin — the one item not implied by Azure/Entra control |

Originally flagged here: Jon's Key Vault access per `terraform.tfvars` `admin_object_ids`
is data-plane only (secret get/list/set/delete), which is a **different** right from the
control-plane access needed for steps 6 and 7. With full subscription/Entra control
confirmed, that gap is closed by the broader grant — but it's why rev 1 raised the
question rather than assuming it.

### c) GitHub repository secrets the workflow expects

All seven, cross-checked against every `${{ secrets.* }}` reference in
`deploy-scheduler.yml`. All seven are required — the workflow has no defaults or
fallbacks.

| Secret name | Value after bootstrap | Source |
|---|---|---|
| `AZURE_CLIENT_ID` | appId of `doddl-scheduler-github-actions` | Step 8 output `$SP_APP_ID` |
| `AZURE_TENANT_ID` | `927d1e2c-7c8d-406f-8640-678dfce86b7d` | `setup.sh:23`, `terraform.tfvars:1` |
| `AZURE_SUBSCRIPTION_ID` | `a674bfa5-c168-480b-9768-046585d01f5f` | `setup.sh:22` |
| `ACR_NAME` | `doddlacr` | `setup.sh:26` (confirm globally unique) |
| `ACR_LOGIN_SERVER` | `doddlacr.azurecr.io` | `az acr show --query loginServer` (step 2) |
| `AZURE_RESOURCE_GROUP` | `doddl-ai-os-production` | `setup.sh:25` |
| `CONTAINER_APP_NAME` | `doddl-scheduler` | `setup.sh:28` |

Used at: `AZURE_CLIENT_ID`/`AZURE_TENANT_ID`/`AZURE_SUBSCRIPTION_ID` lines 34–36;
`ACR_NAME` line 40; `ACR_LOGIN_SERVER` lines 45–46; `CONTAINER_APP_NAME` lines 63, 71;
`AZURE_RESOURCE_GROUP` lines 64, 72.

**No Supabase or connector API secret is needed in GitHub.** Those are fetched from
Key Vault at runtime by the container's managed identity. The scheduler's own DB
connection comes from the Key Vault secret `supabase-scheduler-db-url`
(`scheduler.py:55`), which is registered as manually-managed in
`infra/terraform/KEYVAULT_SECRETS_REGISTRY.md:41`. Confirm it has a value before
deploying — it is the very first Key Vault call the scheduler makes at startup, and a
missing value kills the process immediately.

---

## Step 3 — Five out-of-scope jobs unregistered

Edited `connectors/scheduler/scheduler.py` only. Commented out, not deleted; each block
carries `# out of scope 2026-08-03 — re-enable by uncommenting` on the line above.

| Job | Was | Status | Reason |
|---|---|---|---|
| `semrush-sync` | interval, 24 h | commented out | out of scope |
| `xero-sync` | interval, 60 min | commented out | out of scope |
| `opinew-sync` | interval, 60 min | commented out | out of scope |
| `microsoft-clarity-sync` | interval, 6 h | commented out | out of scope |
| `mintsoft-sync` | interval, 30 min | commented out | out of scope |
| `amazon-advertising-sync` | interval, 60 min | commented out (rev 2) | **API registration rejected — no credentials exist** |

`amazon-advertising-sync` carries the same `# out of scope 2026-08-03 — re-enable by
uncommenting` marker plus a three-line note recording why, so whoever revisits it knows
it is blocked on Amazon approval rather than on a decision about scope. Its commented
block retains a `04:30` cron slot, so re-enabling it needs only an uncomment and it
lands after Google Analytics without disturbing the other seven.

**No connector module was touched.** All 14 files under `connectors/scheduler/jobs/`
are unmodified.

The `from connectors.scheduler.jobs import (...)` block at `scheduler.py:154` was left
intact, deliberately: none of the five modules performs a Key Vault fetch or any other
side effect at import time (verified — all `get_secret`/`get_secrets` calls are inside
functions), so the unused imports are harmless and re-enabling a connector is now a
single uncomment with nothing else to remember.

Verification at rev 2:

```
python -m py_compile connectors/scheduler/scheduler.py   → OK
active    scheduler.add_job( calls  → 7
commented scheduler.add_job( calls  → 6
out-of-scope markers                → 6
active trigger="interval"           → 0
active trigger="cron"               → 7
active timezone="Europe/London"     → 7
active misfire_grace_time=7200      → 7  (all standardised)
line endings: LF preserved (0 CRLF)
```

### 7 jobs still registered

| # | Job ID | Name | Schedule (Europe/London) |
|---|---|---|---|
| 1 | `shopify-sync` | Shopify orders + products sync | daily 01:00 |
| 2 | `amazon-sp-api-sync` | Amazon SP-API orders + inventory sync | daily 01:30 |
| 3 | `klaviyo-sync` | Klaviyo campaigns + flows sync | daily 02:00 |
| 4 | `meta-ads-sync` | Meta Ads campaign + ad set + insights sync | daily 02:30 |
| 5 | `google-ads-sync` | Google Ads campaign + ad group performance sync | daily 03:00 |
| 6 | `google-search-console-sync` | Google Search Console search analytics sync | daily 03:30 |
| 7 | `google-analytics-sync` | Google Analytics 4 traffic + pages sync | daily 04:00 |

### Persisted job store — checked, clean, no cleanup needed

Commenting out a registration does not by itself remove a job already persisted in the
store: `SQLAlchemyJobStore(tablename="apscheduler_jobs")` on Supabase
(`scheduler.py:58`) keeps jobs across restarts by design, and nothing calls `remove_job`.
So a stale row for an out-of-scope connector would still fire on deploy.

**Checked on 2026-08-03 — the store is empty in both projects.**

```sql
select id, next_run_time from apscheduler_jobs order by id;
```

| Project | `public.apscheduler_jobs` | Rows |
|---|---|---|
| production `ikcjciscttsvpxoijnqe` | exists | **0** |
| staging `iknwprxycshrickpswjz` | exists | **0** |

Both databases were swept via `pg_class` across **all** schemas for any other jobstore —
tables matching `%apscheduler%` / `%scheduler_job%`, or carrying a `next_run_time` column
— in case the store lived under a different name or schema. Only the one table in each,
both empty. Not a schema-qualification false negative.

**Verdict: nothing to clean up.** None of the six out-of-scope job IDs is persisted
anywhere, so commenting out the registrations is sufficient. No `remove_job()` call is
needed and no database write was made.

Two notes:

- The table *exists* but is empty in both, so something did initialise the jobstore at
  some point without leaving registered jobs behind — consistent with a scheduler process
  that started and was stopped before or during `register_jobs()`. Either way the store
  is clean now.
- The authoritative target is whichever database `supabase-scheduler-db-url` points at,
  which could not be read (see *Known local-tooling issue*). Both candidate projects were
  therefore checked, and since both are empty the conclusion holds regardless.

Run via the Supabase Management API with `SUPABASE_ACCESS_TOKEN` (sanctioned by
`CLAUDE.md` Hard Rule 3), read-only `SELECT` only.

---

## Step 4 — Daily schedules (changed at rev 2)

All seven jobs converted from `IntervalTrigger` to `CronTrigger`: **one run per source per
day, staggered overnight UK time.** `timezone="Europe/London"` is set explicitly on every
job, `misfire_grace_time` standardised to `7200` on all seven, `coalesce=True` retained.

| Job ID | Trigger (as written) | Frequency in plain English |
|---|---|---|
| `shopify-sync` | `trigger="cron", hour=1, minute=0, timezone="Europe/London"` | Daily at 01:00 UK |
| `amazon-sp-api-sync` | `trigger="cron", hour=1, minute=30, timezone="Europe/London"` | Daily at 01:30 UK |
| `klaviyo-sync` | `trigger="cron", hour=2, minute=0, timezone="Europe/London"` | Daily at 02:00 UK |
| `meta-ads-sync` | `trigger="cron", hour=2, minute=30, timezone="Europe/London"` | Daily at 02:30 UK |
| `google-ads-sync` | `trigger="cron", hour=3, minute=0, timezone="Europe/London"` | Daily at 03:00 UK |
| `google-search-console-sync` | `trigger="cron", hour=3, minute=30, timezone="Europe/London"` | Daily at 03:30 UK |
| `google-analytics-sync` | `trigger="cron", hour=4, minute=0, timezone="Europe/London"` | Daily at 04:00 UK |

`amazon-advertising-sync` holds a commented-out `04:30` slot for whenever Amazon approves
the partner registration.

### Verified by instantiating the triggers

Not read off the source — the same `CronTrigger(hour=…, minute=…, timezone="Europe/London")`
objects were constructed under APScheduler 3.10.4 and their next fire times computed from
a reference instant in both British Summer Time and GMT:

| Job | Fires (BST, summer) | in UTC | Fires (GMT, winter) | in UTC |
|---|---|---|---|---|
| `shopify-sync` | 01:00 BST | 00:00 | 01:00 GMT | 01:00 |
| `amazon-sp-api-sync` | 01:30 BST | 00:30 | 01:30 GMT | 01:30 |
| `klaviyo-sync` | 02:00 BST | 01:00 | 02:00 GMT | 02:00 |
| `meta-ads-sync` | 02:30 BST | 01:30 | 02:30 GMT | 02:30 |
| `google-ads-sync` | 03:00 BST | 02:00 | 03:00 GMT | 03:00 |
| `google-search-console-sync` | 03:30 BST | 02:30 | 03:30 GMT | 03:30 |
| `google-analytics-sync` | 04:00 BST | 03:00 | 04:00 GMT | 04:00 |

In both seasons: **7 distinct fire times, minimum gap 30 minutes, no concurrency.**

The explicit per-job timezone is what makes that hold. The scheduler itself is built with
`timezone="UTC"` (`scheduler.py:84`); without the per-job override the jobs would be
pinned to UTC and the whole run window would drift an hour against local time twice a
year. As written the stagger stays at 01:00–04:00 local all year, absorbing the shift in
UTC terms instead.

### Consequences of the change

1. **Frequency drops sharply, by design.** Shopify goes from 96 runs/day to 1; the hourly
   connectors from 24 to 1; GSC and GA4 from 4 to 1. Data is now at most ~24 h stale, and
   any given day's figures land in the early hours of the next.
2. **First run is the night after deploy.** `CronTrigger` fires at the next matching wall
   time, so a deploy at 10:00 means nothing runs until 01:00 the following morning.
   Health must be judged from the startup log (`Scheduler running — 7 jobs registered`),
   not from data appearing — this is written into Section H of the runbook.
3. **`misfire_grace_time=7200` now means something different.** With a daily schedule, a
   restart more than 2 h after a job's slot skips that day's run entirely rather than
   catching up. If the container is down 01:00–04:00 for maintenance, that day's data is
   simply missed. Raising the grace window or adding a manual catch-up path is a
   follow-up decision, not made here.
4. **Jitter is no longer needed.** The previous concern — four connectors firing on the
   same hour boundary — is resolved by the 30-minute stagger, so no `jitter` was added.
5. **`misfire_grace_time` inconsistency resolved.** All seven are now `7200`; `shopify-sync`
   was previously the odd one out at `3600`.

Two docstrings in `scheduler.py` contradicted the code after this change and were
corrected in the same file: the module docstring claimed "NOT cron-based: uses
IntervalTrigger or DateTrigger with explicit jitter" (lines 10–11), and the `register_jobs`
docstring said "Each job specifies an IntervalTrigger" and referenced `misfire_grace_time=3600`.

---

## Known local-tooling issue — WON'T FIX

**Local Key Vault access from Jon's machine is broken. Deliberately not being fixed.**
Recorded so it isn't rediagnosed from scratch next time.

Two independent faults, either of which alone breaks it:

**1. `Az.Accounts 5.4.0` is incompatible with `azure-identity 1.17.1`.**
`AzurePowerShellCredential` shells out to `Get-AzAccessToken` and parses the result as
plain text. Az.Accounts 5.x returns the token as a `SecureString` by default and has
**removed the `-AsPlainText` switch entirely** (remaining parameters: `ResourceUrl`,
`ResourceTypeName`, `TenantId`, `AsSecureString`, `DefaultProfile`). azure-identity
therefore captures the literal string `System.Security.SecureString` and sends it as a
bearer token, and Key Vault rejects it:

```
401 Unauthorized — "Error validating token: 'S2S12086'"
```

`DefaultAzureCredential` fails the same way, since it falls through to the same
credential. **Everything on this path is currently broken locally:** `scripts/db_audit.py`,
`scripts/data_coverage.py`, `scripts/kv_test.py`. It worked on 30 July, so Az.Accounts has
been upgraded since.

**2. The Key Vault firewall denies Jon's IP** — see the 403 under Step 2 defect #4.
`86.173.70.241` is a dynamic residential address, so it will keep changing even if
allow-listed once.

**Why WON'T FIX:** upgrading `azure-identity` is a package change under `CLAUDE.md` Hard
Rule 6, and allow-listing an IP is a production control-plane change to a Key Vault that
also creates drift against `infra/terraform`. Neither is justified to service local
diagnostics.

**Consequences to be aware of:**

- **Production is unaffected.** The container authenticates with
  `ManagedIdentityCredential` (`connectors/lib/secrets.py:38-56`), which does not go
  through PowerShell. Fault 1 is a local-tooling problem only.
- **Fault 2 is not local-only** — it is the same firewall that will block the Container
  App, which is why Section E of the runbook is mandatory.
- **Database work must use the Supabase Management API** with `SUPABASE_ACCESS_TOKEN`
  (Hard Rule 3), as was done for the jobstore check. Note `api.supabase.com` sits behind
  Cloudflare and rejects default library user-agents with `403 error code: 1010` — send a
  normal `User-Agent` header.
- **`supabase-scheduler-db-url` cannot be read locally**, so which database the scheduler
  targets is still unconfirmed from this machine.

**If it ever needs fixing:** upgrade `azure-identity` (fault 1) *and* allow-list the
current IP (fault 2). Fixing only one leaves it broken.

---

## Summary of changes made

| File | Change | Rev |
|---|---|---|
| `connectors/scheduler/scheduler.py` | 5 out-of-scope registrations commented out | 1 |
| `connectors/scheduler/scheduler.py` | 7 jobs → daily `CronTrigger` + `Europe/London`, `misfire_grace_time` standardised to 7200, `amazon-advertising-sync` commented out, 2 stale docstrings corrected | 2 |
| `reports/scheduler-deploy-prep.md` | This report | 1, updated 2 |
| `infra/scheduler/bootstrap-corrected.md` | Corrected runbook (new at rev 2; revised to single-operator, no rights split, at rev 3) | 2, 3 |

`infra/scheduler/setup.sh` deliberately **not** modified — left in place, superseded by the
runbook.

Nothing deployed. No `az` command run. Nothing committed or pushed. No connector module
modified. Production `api_raw` untouched. No database write of any kind.

## Open items needing your decision

1. **Decide how the workflow reaches `main`** if you want `workflow_dispatch` usable
   (`main` and `staging` have diverged 5 / 82 commits).
2. **Decide `az` vs Terraform** for the Key Vault access policy and firewall rule. The
   runbook uses `az` for speed; that creates drift against `infra/terraform`, which still
   declares access policies and an empty `ip_rules`. If Terraform is later applied as
   written it would **revoke** both.
3. **Reconcile the Terraform/reality mismatch** — `doddl-kv-prod` is not in the resource
   group Terraform claims. Section B1 of the runbook discovers the real one at runtime,
   but the config should be corrected afterwards.
4. **Run the bootstrap** — `infra/scheduler/bootstrap-corrected.md` is now a single
   continuous Cloud Shell session, Sections A–H, since Jon holds full subscription and
   Entra ID control. No handoff step remains.
5. **Watch the first real push to `staging` that touches `connectors/**`** after the
   bootstrap — per the revised Step 1 finding, `deploy-scheduler.yml` has never actually
   fired, so that push is its first real test, not a known-working path.
6. **Decide the missed-run policy** — with daily cron, a >2 h outage over the 01:00–04:00
   window silently loses that day (item 3 under Step 4).
7. **Amazon Advertising** — re-enable `amazon-advertising-sync` (uncomment, 04:30 slot
   ready) once the partner registration is approved.

**Closed since rev 1:** whether Actions is enabled (confirmed enabled — the rev 1 theory
was wrong, see Step 1), the `apscheduler_jobs` stale-row check (0 rows in both projects,
nothing to clean up), and the first-run-delay/jitter question (resolved by the 30-minute
stagger).
