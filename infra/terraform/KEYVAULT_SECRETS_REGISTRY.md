# Key Vault Secrets Registry

All API credentials for the doddl AI OS are stored in Azure Key Vault.
No credential lives in code, `.env` files, or Vercel environment variables
(except `AZURE_KEYVAULT_URI` itself, which is the vault address — not a credential).

## Secret Naming Convention

`{service}-{credential-type}`

Examples: `klaviyo-api-key`, `shopify-client-secret`, `amazon-sp-api-refresh-token`

## Registered Secrets

| Secret Name                         | Service           | Rotation Period | Owner        |
|-------------------------------------|-------------------|-----------------|--------------|
| `klaviyo-api-key`                   | Klaviyo           | 90 days         | Jon Fawcett  |
| `shopify-client-id`                 | Shopify           | 365 days        | Jon Fawcett  |
| `shopify-client-secret`             | Shopify           | 90 days         | Jon Fawcett  |
| `shopify-shop-domain`               | Shopify           | Static          | Jon Fawcett  |
| `amazon-sp-api-client-id`              | Amazon SP-API (shared)    | 365 days  | Jon Fawcett  |
| `amazon-sp-api-client-secret`          | Amazon SP-API (shared)    | 90 days   | Jon Fawcett  |
| `amazon-sp-api-refresh-token`          | Amazon SP-API EU (legacy) | 365 days  | Jon Fawcett  |
| `amazon-sp-api-refresh-token-eu`       | Amazon SP-API EU account  | 365 days  | Jon Fawcett  |
| `amazon-sp-api-refresh-token-na-2`     | Amazon SP-API NA account (US+CA+MX, seller A2J3OJ1QMMOAR5) | 365 days | Jon Fawcett |
| `amazon-sp-api-refresh-token-fe-jp`    | Amazon SP-API FE Japan account (seller A3HUZ3EE07Z6DX) | 365 days | Jon Fawcett |
| `amazon-sp-api-refresh-token-fe-au`    | Amazon SP-API FE Australia account (seller A1LAIASXD1QDDB) | 365 days | Jon Fawcett |
| `amazon-sp-api-refresh-token-fe-sg`    | Amazon SP-API FE Singapore account (seller A3N8BDRT3JKMZ7) | 365 days | Jon Fawcett |
| `amazon-ads-client-id`              | Amazon Advertising | 365 days       | Jon Fawcett  |
| `amazon-ads-client-secret`          | Amazon Advertising | 90 days        | Jon Fawcett  |
| `amazon-ads-refresh-token`          | Amazon Advertising | 365 days       | Jon Fawcett  |
| `amazon-ads-profile-ids`            | Amazon Advertising | Static (optional) | Jon Fawcett  |
| `google-ads-developer-token`        | Google Ads        | 365 days        | Jon Fawcett  |
| `google-ads-client-id`              | Google Ads        | 365 days        | Jon Fawcett  |
| `google-ads-client-secret`          | Google Ads        | 180 days        | Jon Fawcett  |
| `google-ads-refresh-token`          | Google Ads        | 365 days        | Jon Fawcett  |
| `google-ads-login-customer-id`      | Google Ads        | Static          | Jon Fawcett  |
| `google-ads-customer-id`            | Google Ads        | Static          | Jon Fawcett  |
| `meta-ads-access-token`             | Meta Ads          | 60 days         | Jon Fawcett  |
| `meta-ads-account-id`               | Meta Ads          | Static          | Jon Fawcett  |
| `supabase-scheduler-db-url`         | Supabase          | Manual          | Jon Fawcett  |
| `google-sc-client-id`               | Google Search Console | 365 days    | Jon Fawcett  |
| `google-sc-client-secret`           | Google Search Console | 180 days    | Jon Fawcett  |
| `google-sc-refresh-token`           | Google Search Console | 365 days    | Jon Fawcett  |
| `google-sc-site-url`                | Google Search Console | Static      | Jon Fawcett  |
| `google-ga4-client-id`              | Google Analytics 4 | 365 days      | Jon Fawcett  |
| `google-ga4-client-secret`          | Google Analytics 4 | 180 days      | Jon Fawcett  |
| `google-ga4-refresh-token`          | Google Analytics 4 | 365 days      | Jon Fawcett  |
| `google-ga4-property-id`            | Google Analytics 4 | Static        | Jon Fawcett  |
| `semrush-api-key`                   | SEMrush           | 90 days         | Jon Fawcett  |
| `semrush-domain`                    | SEMrush           | Static          | Jon Fawcett  |
| `xero-client-id`                    | Xero              | 365 days        | Jon Fawcett  |
| `xero-client-secret`                | Xero              | 90 days         | Jon Fawcett  |
| `xero-refresh-token`                | Xero              | 60 days (rolling) | Jon Fawcett |
| `xero-tenant-id`                    | Xero              | Static          | Jon Fawcett  |
| `opinew-api-key`                    | Opinew            | 90 days         | Jon Fawcett  |
| `opinew-shop-id`                    | Opinew            | Static          | Jon Fawcett  |
| `clarity-project-id`                | Microsoft Clarity | Static          | Jon Fawcett  |
| `clarity-client-id`                 | Microsoft Clarity | 365 days        | Jon Fawcett  |
| `clarity-client-secret`             | Microsoft Clarity | 180 days        | Jon Fawcett  |
| `clarity-tenant-id`                 | Microsoft Clarity | Static          | Jon Fawcett  |
| `mintsoft-api-key`                  | Mintsoft          | 90 days         | Jon Fawcett  |
| `microsoft-graph-client-secret`     | Microsoft Graph   | 180 days        | Jon Fawcett  |
| `anthropic-api-key`                 | Anthropic         | 90 days         | Jon Fawcett  |
| `supabase-service-role-key-staging` | Supabase staging  | Manual          | Jon Fawcett  |
| `supabase-service-role-key-prod`    | Supabase prod     | Manual          | Jon Fawcett  |
| `zoho-crm-client-secret`            | Zoho CRM          | 90 days         | Jon Fawcett  |

## Rotation Policy

- Secrets have an expiry date set at creation matching the rotation period above.
- Azure Monitor alerts fire 30 days before expiry to jon@doddl.com.
- To rotate: create a new secret version in Key Vault. The connector fetches the
  latest active version on every run — no redeploy required.
- Old versions are disabled, not deleted, for 90 days.

## Environments

| Environment | Vault Name        | URI pattern                                      |
|-------------|-------------------|--------------------------------------------------|
| Staging     | `doddl-kv-staging`| `https://doddl-kv-staging.vault.azure.net/`      |
| Production  | `doddl-kv-prod`   | `https://doddl-kv-prod.vault.azure.net/`         |

Staging and production vaults are completely separate. A staging credential
never touches the production vault and vice versa.
