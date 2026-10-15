# Scheduler Bootstrap — Runbook

**For:** Jon — one operator, Sections A through H in a single Cloud Shell session
**Where:** Azure Cloud Shell — <https://shell.azure.com>
**Date written:** 2026-08-03
**Time needed:** about 45 minutes
**Run this:** once, ever

> **This runbook replaces `infra/scheduler/setup.sh`.**
> That script is still in the repo for reference but **must not be run** — it has
> five defects that either stop it partway or leave a deployment that looks fine and
> silently doesn't work. They are listed in "What was wrong with the old script" at the
> bottom. Everything below is corrected.

---

## Before you start

**What you need:**

- A web browser, signed in to Azure with full subscription and Entra ID control.
- Nothing installed on your computer. Everything runs in the browser.

**Ground rules — worth reading, they matter:**

1. **Paste one grey block at a time.** Press Enter. Wait for it to finish. Read the output.
2. **If you see red text, or anything saying `ERROR`, `Forbidden`, `not authorized`, or
   `denied` — STOP.** Do not continue to the next block. Work out what section it's in
   and check the troubleshooting table at the bottom before retrying. Carrying on after
   an error is how you get a half-built system that's hard to unpick.
3. **Every step states what success looks like.** If what you see doesn't match, treat it
   as an error and stop.
4. **Don't close the browser tab** until you reach the end. The tab remembers the settings
   from Section A. If you do lose it, just re-paste Section A and carry on from where you
   were — nothing gets duplicated or broken by re-running.
5. Cloud Shell logs you out after about 20 minutes of doing nothing. Same fix as above.

This is a single continuous session — Sections A through H run one after another with
nothing to hand off in between.

---

## Section A — Open Cloud Shell and set up your session

Go to <https://shell.azure.com>. If it asks **Bash or PowerShell**, choose **Bash**.
If it offers to create storage, accept the default.

Paste this whole block:

```bash
# Settings for this deployment. Nothing is created by this block —
# it just puts the names in place so later commands can use them.
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
az account show --query "{subscription:name, tenant:tenantId, user:user.name}" -o table
```

**What this does:** Sets the names to be used throughout, and points Azure at the right
subscription.

**Success looks like:** A small table showing a subscription name, the tenant ID ending
`...ce86b7d`, and your email address. No red text.

---

Now get the code. **This next bit is important and easy to get wrong.**

```bash
cd ~
rm -rf doddl-pm
git clone https://github.com/D0DDL/doddl-pm
cd doddl-pm
git checkout staging
ls connectors/Dockerfile
```

**What this does:** Downloads the code and switches to the `staging` branch.

**Why the `git checkout staging` line matters:** the scheduler code only exists on the
`staging` branch. The default branch (`main`) has no `connectors` folder at all. Without
that line, later steps fail with "file not found" for no obvious reason.

**Success looks like:** the last line prints exactly `connectors/Dockerfile`.
If it says `No such file or directory`, the branch switch didn't work — **stop**.

---

## Section B — Discovery (nothing is created or changed)

All read-only. Run it anyway even if it looks boring: it checks three assumptions in the
repo that we know are unreliable, and the answers change what you do later.

### B1. Find which resource group actually holds the Key Vault

```bash
az keyvault show --name "$KEYVAULT_NAME" --query "{name:name, resourceGroup:resourceGroup, location:location}" -o table
KEYVAULT_RG=$(az keyvault show --name "$KEYVAULT_NAME" --query resourceGroup -o tsv)
KEYVAULT_ID=$(az keyvault show --name "$KEYVAULT_NAME" --query id -o tsv)
echo "Key Vault resource group: $KEYVAULT_RG"
```

**What this does:** Asks Azure where the Key Vault really lives.

**Why:** The project's configuration files claim the vault is in
`doddl-ai-os-production`. It isn't — that resource group doesn't exist yet, and you're
about to create it in Section C. So the vault is somewhere else, and we need its real
location for Sections D and E rather than trusting the file.

**Success looks like:** a table with the vault name and a resource group name, and a
final line `Key Vault resource group: <something>`. **Write that name down.**

If instead you get `ResourceNotFound`, stop — the vault name may be wrong.

### B2. Check the container registry name is available

```bash
az acr check-name --name "$ACR_NAME" -o table
```

**What this does:** Container registry names must be unique across the whole of Azure,
not just doddl. This checks whether `doddlacr` is free.

**Success looks like:** `NameAvailable` is `True`.

**If `NameAvailable` is `False`:** the name is taken by someone else. Pick another and
tell Jon which you used, because it has to match later:

```bash
# ONLY run this if doddlacr was unavailable
ACR_NAME="doddlacr2"
az acr check-name --name "$ACR_NAME" -o table
```

### B3. Check how the Key Vault controls access

```bash
az keyvault show --name "$KEYVAULT_NAME" --query "{rbacMode:properties.enableRbacAuthorization, defaultAction:properties.networkAcls.defaultAction, allowedIPs:properties.networkAcls.ipRules}" -o json
```

**What this does:** Checks two things — which permission system the vault uses, and
whether its firewall is switched on.

**Expected result:**

```json
{
  "rbacMode": null,          // or false — means it uses "access policies"
  "defaultAction": "Deny",   // firewall IS on, blocking everything by default
  "allowedIPs": []           // nothing allowed through yet
}
```

**Why this matters:** those two answers drive Sections D and E.

- `rbacMode` being `null`/`false` means Section D must use `az keyvault set-policy`.
  Granting a "role" instead would appear to succeed and give no actual access.
- `defaultAction: "Deny"` means Section E is **mandatory**. This is confirmed, not
  theoretical — on 2026-08-03 a real attempt to read this vault was refused with
  `403 Forbidden — Client address is not authorized`. Skip Section E and the scheduler
  will start and then fail to read its database password.

**If `rbacMode` comes back `true`**, the vault has been changed since this was written —
stop and tell Jon, because Section D would need a different command.

---

## Section C — Create the infrastructure

### C1. Turn on the Azure features this needs

```bash
az extension add --name containerapp --upgrade
az provider register --namespace Microsoft.App --wait
az provider register --namespace Microsoft.OperationalInsights --wait
az provider register --namespace Microsoft.ContainerRegistry --wait
az provider show --namespace Microsoft.App --query registrationState -o tsv
```

**What this does:** Switches on the Azure services used here. Container Apps is off by
default on new subscriptions.

**Success looks like:** the last line prints `Registered`. This block can take 2–3
minutes — that's normal.

### C2. Create the resource group

```bash
az group create \
  --name "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --tags project=doddl-ai-os environment=production managed_by=manual
```

**What this does:** Creates the folder in Azure that holds everything else.

**Success looks like:** a block of JSON containing `"provisioningState": "Succeeded"`.

> This step was **completely missing** from the old script, which is the main reason it
> could never have worked.

### C3. Create the container registry

```bash
az acr create \
  --name "$ACR_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --sku Basic \
  --admin-enabled false \
  --tags project=doddl-ai-os environment=production managed_by=manual

ACR_LOGIN_SERVER=$(az acr show --name "$ACR_NAME" --query loginServer -o tsv)
ACR_ID=$(az acr show --name "$ACR_NAME" --query id -o tsv)
echo "ACR_LOGIN_SERVER = $ACR_LOGIN_SERVER"
```

**What this does:** Creates the private store for the application image.

**Success looks like:** `ACR_LOGIN_SERVER = doddlacr.azurecr.io` (or your alternative
name). It's needed again in Section G, but it's already saved in this shell session as
`$ACR_LOGIN_SERVER`.

### C4. Create the Container App environment

```bash
az containerapp env create \
  --name "$CONTAINER_APP_ENV" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --tags project=doddl-ai-os environment=production
```

**What this does:** Creates the hosting environment the scheduler runs inside.

**Success looks like:** JSON ending with `"provisioningState": "Succeeded"`.
**This one is slow — up to 5 minutes.** Leave it alone until the prompt comes back.

### C5. Build the application image

```bash
az acr build \
  --registry "$ACR_NAME" \
  --image "$IMAGE_NAME:latest" \
  --file connectors/Dockerfile \
  .
```

**What this does:** Builds the scheduler into a runnable image. The build happens inside
Azure, not in your browser session.

**Success looks like:** a long stream of build output, ending with
`Run ID: ... was successful after ...`. Takes 3–5 minutes. Lines beginning `Step 1/9`,
`Step 2/9` and so on are normal progress, not errors.

> The old script used `docker build` here. **That cannot work** — Azure Cloud Shell has
> no Docker engine, so it fails with "Cannot connect to the Docker daemon". `az acr build`
> does the same job inside Azure instead.

Confirm the image arrived:

```bash
az acr repository show-tags --name "$ACR_NAME" --repository "$IMAGE_NAME" -o table
```

**Success looks like:** a list containing `latest`.

### C6. Create the Container App

```bash
az containerapp create \
  --name "$CONTAINER_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --environment "$CONTAINER_APP_ENV" \
  --image "$ACR_LOGIN_SERVER/$IMAGE_NAME:latest" \
  --registry-server "$ACR_LOGIN_SERVER" \
  --registry-identity system \
  --min-replicas 1 \
  --max-replicas 1 \
  --cpu 0.5 \
  --memory 1.0Gi \
  --env-vars "AZURE_KEYVAULT_URI=$KEYVAULT_URI" \
  --tags project=doddl-ai-os environment=production

CONTAINER_APP_PRINCIPAL=$(az containerapp show \
  --name "$CONTAINER_APP_NAME" --resource-group "$RESOURCE_GROUP" \
  --query "identity.principalId" -o tsv)
echo "CONTAINER_APP_PRINCIPAL = $CONTAINER_APP_PRINCIPAL"
```

**What this does:** Creates the always-on service that runs the scheduler, and gives it
an Azure identity of its own so it can read passwords from the Key Vault without any
password being stored anywhere.

**Success looks like:** JSON ending `"provisioningState": "Succeeded"`, then
`CONTAINER_APP_PRINCIPAL = ` followed by a long ID with dashes.

**If `CONTAINER_APP_PRINCIPAL` prints as empty, stop** — the next two sections depend on it.

> **Expect errors in the app's logs at this point.** The scheduler will start, try to
> read its database password, and be refused — because Sections D and E haven't run yet.
> That is expected and harmless. Section F2 restarts it once access is in place.

---

## Section D — Let the scheduler read the Key Vault

```bash
az keyvault set-policy \
  --name "$KEYVAULT_NAME" \
  --object-id "$CONTAINER_APP_PRINCIPAL" \
  --secret-permissions get list
```

**What this does:** Gives the scheduler permission to read secrets from the Key Vault —
read-only, secrets only. It cannot change or delete anything.

**Success looks like:** JSON ending `"provisioningState": "Succeeded"`.

Check it took effect:

```bash
az keyvault show --name "$KEYVAULT_NAME" \
  --query "properties.accessPolicies[?objectId=='$CONTAINER_APP_PRINCIPAL'].permissions.secrets" -o json
```

**Success looks like:** `[["get","list"]]`. If you get `[]`, the permission didn't
apply — stop.

> The old script used a "role assignment" here instead. On this vault that command
> **succeeds while granting nothing at all** — the worst kind of failure, because
> everything looks correct and the scheduler still can't start. Section B3 confirmed the
> vault uses access policies, which is what `set-policy` above sets.

---

## Section E — Open the Key Vault firewall to the scheduler

The Key Vault refuses all network traffic by default. Permission alone (Section D) is not
enough — the traffic has to be allowed in as well.

```bash
CAE_OUTBOUND_IP=$(az containerapp env show \
  --name "$CONTAINER_APP_ENV" --resource-group "$RESOURCE_GROUP" \
  --query "properties.staticIp" -o tsv)
echo "Container App outbound IP = $CAE_OUTBOUND_IP"
```

**What this does:** Finds the fixed internet address the scheduler's traffic comes from.

**Success looks like:** an address like `20.108.x.x`. **If it's empty, stop** — the next
command would silently do nothing useful.

```bash
az keyvault network-rule add \
  --name "$KEYVAULT_NAME" \
  --resource-group "$KEYVAULT_RG" \
  --ip-address "$CAE_OUTBOUND_IP"
```

**What this does:** Adds that address to the Key Vault's list of allowed callers.

**Success looks like:** JSON including your IP under `ipRules`.

Confirm:

```bash
az keyvault network-rule list --name "$KEYVAULT_NAME" --resource-group "$KEYVAULT_RG" -o json
```

**Success looks like:** your `$CAE_OUTBOUND_IP` appears in the list.

> **This step is confirmed necessary, not a precaution.** On 2026-08-03 a genuine attempt
> to read this vault returned
> `403 Forbidden — Client address is not authorized and caller is not a trusted service`.
> The vault is set to `Deny` by default with an empty allow-list. Azure's "trusted
> Microsoft services" exemption does **not** cover Container Apps, so without this step
> the scheduler cannot reach the vault no matter what permissions it has.

---

## Section F — Set up automatic deployments from GitHub

### F1. Create the deployment identity

```bash
SP_APP_ID=$(az ad sp list --display-name "$SP_NAME" --query "[0].appId" -o tsv)
if [ -z "$SP_APP_ID" ]; then
  SP_APP_ID=$(az ad sp create-for-rbac \
    --name "$SP_NAME" \
    --role contributor \
    --scopes "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP" \
    --query appId -o tsv)
  echo "Created new identity."
else
  echo "Identity already existed — reusing it."
fi
echo "SP_APP_ID = $SP_APP_ID"
```

**What this does:** Creates the identity GitHub uses to deploy updates.

**Success looks like:** `SP_APP_ID = ` followed by an ID with dashes. It's already saved
in this shell session as `$SP_APP_ID` — needed again in Section G.

You may see a warning about a created secret or password. **Ignore it and do not copy it
down.** This setup deliberately uses no password (see F3).

Give it permission to upload images:

```bash
az role assignment create --role AcrPush --assignee "$SP_APP_ID" --scope "$ACR_ID"
```

**Success looks like:** JSON containing `"roleDefinitionId"`.
If it says the assignment already exists, that's fine — carry on.

### F2. Restart the scheduler now that it has access

```bash
az containerapp revision restart \
  --name "$CONTAINER_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --revision $(az containerapp show --name "$CONTAINER_APP_NAME" \
      --resource-group "$RESOURCE_GROUP" --query "properties.latestRevisionName" -o tsv)
```

**What this does:** Restarts the scheduler so it retries the Key Vault now that Sections
D and E have granted access. This clears the expected errors from Section C6.

**Success looks like:** the command completes without red text.

### F3. Connect GitHub to Azure — the step the old script got wrong

```bash
APP_OBJECT_ID=$(az ad app show --id "$SP_APP_ID" --query id -o tsv)
echo "APP_OBJECT_ID = $APP_OBJECT_ID"
```

**What this does:** Looks up the correct internal ID for the next command.

**Success looks like:** `APP_OBJECT_ID = ` followed by an ID with dashes. It will be
**different** from `SP_APP_ID` — that's correct and is the whole point.

> **Why this matters.** Azure keeps two separate records for a deployment identity: an
> **application** record and a **service principal** record. They have different IDs and
> are easy to confuse. The old script fetched the *service principal* ID and used it here,
> where Azure requires the *application* ID. The command then failed — and because the
> script hid its own errors, it printed a success message anyway. The result would have
> been a GitHub deployment that fails every time with
> `AADSTS70021: No matching federated identity record found`, with nothing explaining why.
> The line above fetches the correct one.

```bash
az ad app federated-credential create \
  --id "$APP_OBJECT_ID" \
  --parameters '{
    "name": "github-actions-staging",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:D0DDL/doddl-pm:ref:refs/heads/staging",
    "audiences": ["api://AzureADTokenExchange"]
  }'
```

**What this does:** Lets GitHub prove who it is to Azure using a short-lived token
instead of a stored password. Nothing secret is created or needs storing.

**Success looks like:** JSON containing `"name": "github-actions-staging"`.

Now confirm it actually exists — do not skip this:

```bash
az ad app federated-credential list --id "$APP_OBJECT_ID" \
  --query "[].{name:name, subject:subject}" -o table
```

**Success looks like:** exactly one row:

| name | subject |
|---|---|
| github-actions-staging | repo:D0DDL/doddl-pm:ref:refs/heads/staging |

**If the table is empty, stop.** This is precisely where the old script silently failed.

> Note: this trusts only the `staging` branch, which is what the deployment workflow uses.
> Deployments from any other branch will be refused by design.

---

## Section G — GitHub repository secrets

Needs **admin** on the `D0DDL/doddl-pm` repository.

```bash
gh auth login
```

Choose **GitHub.com**, then **HTTPS**, then **Login with a web browser**, and follow the
one-time code prompt.

```bash
gh secret set AZURE_CLIENT_ID       --body "$SP_APP_ID"          --repo "$GITHUB_REPO"
gh secret set AZURE_TENANT_ID       --body "$TENANT_ID"          --repo "$GITHUB_REPO"
gh secret set AZURE_SUBSCRIPTION_ID --body "$SUBSCRIPTION_ID"    --repo "$GITHUB_REPO"
gh secret set ACR_NAME              --body "$ACR_NAME"           --repo "$GITHUB_REPO"
gh secret set ACR_LOGIN_SERVER      --body "$ACR_LOGIN_SERVER"   --repo "$GITHUB_REPO"
gh secret set AZURE_RESOURCE_GROUP  --body "$RESOURCE_GROUP"     --repo "$GITHUB_REPO"
gh secret set CONTAINER_APP_NAME    --body "$CONTAINER_APP_NAME" --repo "$GITHUB_REPO"

gh secret list --repo "$GITHUB_REPO"
```

**Success looks like:** all seven names listed, each with a recent "Updated" time.

### The complete list of GitHub secrets

All seven are required. The deployment workflow has no fallbacks — a missing one fails
the deployment.

| Secret name | Value | Where it comes from |
|---|---|---|
| `AZURE_CLIENT_ID` | the deployment identity's app ID | `$SP_APP_ID`, Section F1 |
| `AZURE_TENANT_ID` | `927d1e2c-7c8d-406f-8640-678dfce86b7d` | fixed, Section A |
| `AZURE_SUBSCRIPTION_ID` | `a674bfa5-c168-480b-9768-046585d01f5f` | fixed, Section A |
| `ACR_NAME` | `doddlacr` (or your alternative) | Section B2 / C3 |
| `ACR_LOGIN_SERVER` | `doddlacr.azurecr.io` | `$ACR_LOGIN_SERVER`, Section C3 |
| `AZURE_RESOURCE_GROUP` | `doddl-ai-os-production` | fixed, Section A |
| `CONTAINER_APP_NAME` | `doddl-scheduler` | fixed, Section A |

**No Supabase or connector API keys go into GitHub.** Those stay in the Key Vault and are
fetched by the scheduler at runtime. Nothing here should ever ask you to put a Supabase
key or an API key into GitHub.

---

## Section H — Verify it worked

All read-only.

### H1. Is it running?

```bash
az containerapp show \
  --name "$CONTAINER_APP_NAME" --resource-group "$RESOURCE_GROUP" \
  --query "{name:name, running:properties.runningStatus, provisioned:properties.provisioningState, image:properties.template.containers[0].image, replicas:properties.template.scale.minReplicas}" -o table
```

**Success looks like:** `running` = `Running` and `provisioned` = `Succeeded`.

### H2. Is a copy actually alive?

```bash
az containerapp replica list \
  --name "$CONTAINER_APP_NAME" --resource-group "$RESOURCE_GROUP" \
  --query "[].{replica:name, state:properties.runningState}" -o table
```

**Success looks like:** one row with state `Running`.

### H3. Read the logs — the real test

```bash
az containerapp logs show \
  --name "$CONTAINER_APP_NAME" --resource-group "$RESOURCE_GROUP" \
  --tail 60
```

**Success looks like** these two lines:

```
doddl AI OS connector scheduler starting
Scheduler running — 7 jobs registered. Missed run recovery: coalesce=True, grace=3600s per job (unless overridden)
```

**The number must be 7.** If it says a different number, check `connectors/scheduler/scheduler.py`
in the repo for what's actually registered before assuming the deployment is wrong.

You should also see seven `JOB ADDED` lines, one per connector:
`shopify-sync`, `amazon-sp-api-sync`, `klaviyo-sync`, `meta-ads-sync`, `google-ads-sync`,
`google-search-console-sync`, `google-analytics-sync`.

**Bad signs — go back and check the relevant section rather than improvising a fix:**

| What you see | What it means |
|---|---|
| `Forbidden` / `Client address is not authorized` | Section E didn't take effect |
| `ClientAuthenticationError` / `403` on a secret | Section D didn't take effect |
| `AZURE_KEYVAULT_URI ... is not set` | the setting in C6 didn't apply |
| container restarting over and over | it's crashing on startup |

**Watch the logs live** (useful when waiting for a run; press `Ctrl+C` to stop):

```bash
az containerapp logs show \
  --name "$CONTAINER_APP_NAME" --resource-group "$RESOURCE_GROUP" --follow
```

Or in the browser: **portal.azure.com → Container Apps → doddl-scheduler → Log stream**.

### H4. When will it actually do something?

**Nothing runs immediately, and that is correct.** The connectors are on a daily
overnight schedule, UK time:

| Time (UK) | Connector |
|---|---|
| 01:00 | Shopify |
| 01:30 | Amazon SP-API |
| 02:00 | Klaviyo |
| 02:30 | Meta Ads |
| 03:00 | Google Ads |
| 03:30 | Google Search Console |
| 04:00 | Google Analytics 4 |

So the first real activity is the night after you finish. At H3 you are confirming it
started cleanly and is waiting — not that it has fetched data. Check the logs again the
following morning.

---

## A note on secrets encountered along the way

Nothing in this runbook produces a password that needs storing anywhere. It uses OIDC —
GitHub and Azure exchange short-lived tokens, not a stored credential. Section F1 may
print a warning about a created secret or password when it creates the service principal
— **ignore it, do not copy it down**; nothing here uses it.

If any step ever shows something labelled `password`, `clientSecret`, or
`Encrypted Value` that isn't accounted for above, stop and work out where it came from
before going further — it shouldn't be needed anywhere in this process.

---

## What was wrong with the old script

For the record. Any one of these would have caused a failed or broken deployment.

| # | Defect in `infra/scheduler/setup.sh` | Effect | Fixed in |
|---|---|---|---|
| 1 | No `az group create` at all | Stops partway — after printing a misleading success | C2 |
| 2 | `docker build` in Cloud Shell | Impossible — Cloud Shell has no Docker engine | C5 (`az acr build`) |
| 3 | Key Vault granted via RBAC role | Succeeds while granting nothing; scheduler can't read its password | D (`set-policy`) |
| 4 | Key Vault firewall never opened | Confirmed 403 on 2026-08-03; scheduler blocked at the network layer | E |
| 5 | Federated credential used the service principal ID, not the application ID | GitHub deployments fail with `AADSTS70021` | F3 |

**A sixth problem, running through all of the above:** the old script wrapped commands in
`2>/dev/null || echo "... already exists, skipping."`, which threw away the real error and
printed reassuring text instead. Combined with `set -euo pipefail`, it would die later at
a confusing place with the actual cause already discarded. **No command in this runbook
hides its errors** — every step tells you what success looks like, and asks you to stop if
you don't see it.

---

## If something goes wrong

1. **Stop.** Don't run further steps.
2. Read the whole error message, including the command that produced it.
3. Check the table below before retrying.

Common ones:

| Message | Meaning | Do |
|---|---|---|
| `AuthorizationFailed` | Full subscription/Entra control was confirmed, so this points at a scope or resource-name typo, not a missing right | Re-check the command against the block above |
| `ResourceNotFound` | An earlier step didn't complete | Re-run the earlier section first |
| `already exists` | Something was created before | Safe — carry on |
| `NameAvailable: False` (B2) | Registry name taken | Use the B2 alternative, and use that name consistently from then on |
| Session timed out / tab closed | Cloud Shell logged you out | Re-paste Section A, continue where you left off |

**Re-running a whole section is safe.** Nothing here deletes anything, and creating
something twice just reports that it already exists.
