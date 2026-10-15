# doddl AI OS — Scheduler Deployment

The scheduler runs as an **Azure Container App** with a system-assigned managed identity.  
It uses ManagedIdentityCredential to access Key Vault — no credentials stored in environment variables or code.

## Architecture

```
GitHub push to staging
       │
       ▼
GitHub Actions (deploy-scheduler.yml)
       │  builds Docker image
       │  pushes to Azure Container Registry
       ▼
Azure Container App (doddl-scheduler)
       │  1 replica, always on (min-replicas=1)
       │  system-assigned managed identity
       │  env: AZURE_KEYVAULT_URI
       ▼
Azure Key Vault (doddl-kv-prod)
       │  secrets fetched at runtime per connector job
       ▼
Supabase (api_raw + api_clean tables)
```

## One-time setup (run once, ever)

1. Open **Azure Cloud Shell**: https://shell.azure.com
2. Clone the repo:
   ```bash
   git clone https://github.com/D0DDL/doddl-pm
   cd doddl-pm
   ```
3. Authenticate GitHub CLI:
   ```bash
   gh auth login
   ```
4. Run the setup script:
   ```bash
   bash infra/scheduler/setup.sh
   ```

The script creates:
- Azure Container Registry (`doddlacr`)
- Container App Environment + Container App (`doddl-scheduler`)
- Managed Identity with Key Vault Secrets User role on `doddl-kv-prod`
- GitHub Actions service principal (OIDC, no stored client secret)
- All GitHub secrets required by the workflow

## Ongoing deployments

Any push to the `staging` branch that changes `connectors/**` automatically:
1. Builds a new Docker image tagged with the commit SHA
2. Pushes to ACR
3. Updates the Container App (zero-downtime rolling update)

Manual deploy (without a code push):
- GitHub → Actions → "Deploy Scheduler" → Run workflow

## Monitoring

- **Live logs**: Azure Portal → Container Apps → doddl-scheduler → Log stream
- **Job history**: Azure Portal → Container Apps → doddl-scheduler → Metrics
- **Supabase**: `SELECT * FROM api_raw ORDER BY created_at DESC LIMIT 50;`
- **Alerts**: APScheduler fires `create_incident_task()` on job errors → PM Tool task created

## Connector schedule

| Connector | Interval |
|---|---|
| Shopify | every 15 min |
| Klaviyo | every 30 min |
| Mintsoft | every 30 min |
| Amazon SP-API | every 60 min |
| Amazon Advertising | every 60 min |
| Google Ads | every 60 min |
| Meta Ads | every 60 min |
| Xero | every 60 min |
| Opinew | every 60 min |
| Google Analytics 4 | every 6 hours |
| Google Search Console | every 6 hours |
| Microsoft Clarity | every 6 hours |
| SEMrush | every 24 hours |

## Cost estimate

| Resource | SKU | Est. monthly cost |
|---|---|---|
| Container App | 0.5 vCPU / 1 GB, 1 replica 24/7 | ~£12 |
| Container Registry | Basic | ~£4 |
| **Total** | | **~£16/month** |
