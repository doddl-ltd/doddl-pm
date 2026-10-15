#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# doddl AI OS — Scheduler one-time Azure setup
#
# Run this ONCE from Azure Cloud Shell (shell.azure.com).
# It creates all Azure resources and configures GitHub secrets automatically.
#
# Prerequisites (in Azure Cloud Shell — all pre-installed):
#   az, docker, gh (GitHub CLI)
#
# Before running:
#   1. Open https://shell.azure.com
#   2. Clone the repo: git clone https://github.com/D0DDL/doddl-pm
#   3. cd doddl-pm
#   4. gh auth login   (authenticate GitHub CLI)
#   5. bash infra/scheduler/setup.sh
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
SUBSCRIPTION_ID="a674bfa5-c168-480b-9768-046585d01f5f"
TENANT_ID="927d1e2c-7c8d-406f-8640-678dfce86b7d"
LOCATION="uksouth"
RESOURCE_GROUP="doddl-ai-os-production"
ACR_NAME="doddlacr"                           # must be globally unique, lowercase
CONTAINER_APP_ENV="doddl-scheduler-env"
CONTAINER_APP_NAME="doddl-scheduler"
KEYVAULT_NAME="doddl-kv-prod"
KEYVAULT_URI="https://doddl-kv-prod.vault.azure.net/"
GITHUB_REPO="D0DDL/doddl-pm"
IMAGE_NAME="doddl-scheduler"

echo "=== doddl AI OS Scheduler Setup ==="
echo "Subscription : $SUBSCRIPTION_ID"
echo "Resource Group: $RESOURCE_GROUP"
echo "Location     : $LOCATION"
echo ""

az account set --subscription "$SUBSCRIPTION_ID"

# ── 1. Azure Container Registry ───────────────────────────────────────────────
echo "[1/7] Creating Azure Container Registry..."
az acr create \
  --name "$ACR_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --sku Basic \
  --admin-enabled false \
  --tags project=doddl-ai-os environment=production managed_by=manual \
  2>/dev/null || echo "  ACR already exists, skipping."

ACR_LOGIN_SERVER=$(az acr show --name "$ACR_NAME" --query loginServer -o tsv)
echo "  ACR: $ACR_LOGIN_SERVER"

# ── 2. Container App Environment ──────────────────────────────────────────────
echo "[2/7] Creating Container App Environment..."
az containerapp env create \
  --name "$CONTAINER_APP_ENV" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --tags project=doddl-ai-os environment=production \
  2>/dev/null || echo "  Environment already exists, skipping."

# ── 3. Initial image — push placeholder so Container App can be created ────────
echo "[3/7] Building and pushing initial image..."
az acr login --name "$ACR_NAME"

docker build \
  -f connectors/Dockerfile \
  -t "$ACR_LOGIN_SERVER/$IMAGE_NAME:latest" \
  .

docker push "$ACR_LOGIN_SERVER/$IMAGE_NAME:latest"

# ── 4. Container App with system-assigned managed identity ────────────────────
echo "[4/7] Creating Container App..."
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
  --tags project=doddl-ai-os environment=production \
  2>/dev/null || echo "  Container App already exists, skipping."

# Get the Container App managed identity principal ID
CONTAINER_APP_PRINCIPAL=$(az containerapp show \
  --name "$CONTAINER_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "identity.principalId" -o tsv)

echo "  Container App principal ID: $CONTAINER_APP_PRINCIPAL"

# ── 5. Grant Container App managed identity access to Key Vault ───────────────
echo "[5/7] Granting Key Vault Secrets User role to Container App identity..."
KEYVAULT_ID=$(az keyvault show --name "$KEYVAULT_NAME" --query id -o tsv)

az role assignment create \
  --role "Key Vault Secrets User" \
  --assignee "$CONTAINER_APP_PRINCIPAL" \
  --scope "$KEYVAULT_ID" \
  2>/dev/null || echo "  Role assignment already exists."

echo "  Managed identity granted Key Vault Secrets User on $KEYVAULT_NAME"

# ── 6. Service principal for GitHub Actions (OIDC) ───────────────────────────
echo "[6/7] Creating GitHub Actions service principal..."
SP_NAME="doddl-scheduler-github-actions"

# Create SP
SP_APP_ID=$(az ad sp list --display-name "$SP_NAME" --query "[0].appId" -o tsv)
if [ -z "$SP_APP_ID" ]; then
  SP_APP_ID=$(az ad sp create-for-rbac \
    --name "$SP_NAME" \
    --role contributor \
    --scopes "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP" \
    --query appId -o tsv)
  echo "  Created SP: $SP_APP_ID"
else
  echo "  SP already exists: $SP_APP_ID"
fi

# Grant SP AcrPush on the Container Registry
ACR_ID=$(az acr show --name "$ACR_NAME" --query id -o tsv)
az role assignment create \
  --role AcrPush \
  --assignee "$SP_APP_ID" \
  --scope "$ACR_ID" \
  2>/dev/null || echo "  AcrPush role already assigned."

# Add federated credential for GitHub Actions OIDC
SP_OBJECT_ID=$(az ad sp show --id "$SP_APP_ID" --query id -o tsv)
az ad app federated-credential create \
  --id "$SP_OBJECT_ID" \
  --parameters "{
    \"name\": \"github-actions-staging\",
    \"issuer\": \"https://token.actions.githubusercontent.com\",
    \"subject\": \"repo:$GITHUB_REPO:ref:refs/heads/staging\",
    \"audiences\": [\"api://AzureADTokenExchange\"]
  }" 2>/dev/null || echo "  Federated credential already exists."

echo "  SP App ID: $SP_APP_ID"

# ── 7. Set GitHub secrets ──────────────────────────────────────────────────────
echo "[7/7] Setting GitHub Actions secrets..."
gh secret set AZURE_CLIENT_ID      --body "$SP_APP_ID"         --repo "$GITHUB_REPO"
gh secret set AZURE_TENANT_ID      --body "$TENANT_ID"         --repo "$GITHUB_REPO"
gh secret set AZURE_SUBSCRIPTION_ID --body "$SUBSCRIPTION_ID"  --repo "$GITHUB_REPO"
gh secret set ACR_NAME             --body "$ACR_NAME"           --repo "$GITHUB_REPO"
gh secret set ACR_LOGIN_SERVER     --body "$ACR_LOGIN_SERVER"   --repo "$GITHUB_REPO"
gh secret set AZURE_RESOURCE_GROUP --body "$RESOURCE_GROUP"     --repo "$GITHUB_REPO"
gh secret set CONTAINER_APP_NAME   --body "$CONTAINER_APP_NAME" --repo "$GITHUB_REPO"

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Resources created:"
echo "  ACR             : $ACR_LOGIN_SERVER"
echo "  Container App   : $CONTAINER_APP_NAME (in $RESOURCE_GROUP)"
echo "  Managed Identity: $CONTAINER_APP_PRINCIPAL → Key Vault Secrets User"
echo "  GitHub SP       : $SP_APP_ID (OIDC, no secret stored)"
echo ""
echo "GitHub secrets set on $GITHUB_REPO:"
echo "  AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_SUBSCRIPTION_ID"
echo "  ACR_NAME, ACR_LOGIN_SERVER, AZURE_RESOURCE_GROUP, CONTAINER_APP_NAME"
echo ""
echo "Next: push a commit to 'staging' to trigger the first deployment."
echo "Monitor: https://portal.azure.com → Container Apps → $CONTAINER_APP_NAME → Log stream"
