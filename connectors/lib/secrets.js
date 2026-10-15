/**
 * Runtime credential fetcher — Azure Key Vault.
 *
 * No credential is stored in code or env files. Connectors call getSecret()
 * to retrieve API keys at runtime. The vault URI comes from a single env var
 * (AZURE_KEYVAULT_URI) set in Vercel; the vault stores everything else.
 *
 * Auth: DefaultAzureCredential tries, in order:
 *   1. Managed Identity (when running in Azure)
 *   2. Azure CLI credentials (local development)
 *   3. Environment variables ARM_CLIENT_ID / ARM_CLIENT_SECRET / ARM_TENANT_ID
 *
 * Required packages (install in connectors/):
 *   npm install @azure/keyvault-secrets @azure/identity
 */

const { SecretClient } = require('@azure/keyvault-secrets');
const { DefaultAzureCredential } = require('@azure/identity');

const VAULT_URI = process.env.AZURE_KEYVAULT_URI;
if (!VAULT_URI) {
  throw new Error('AZURE_KEYVAULT_URI environment variable is not set');
}

let _client = null;

function getClient() {
  if (!_client) {
    _client = new SecretClient(VAULT_URI, new DefaultAzureCredential());
  }
  return _client;
}

/**
 * Fetch a secret value from Key Vault.
 * @param {string} name  Secret name as stored in Key Vault (e.g. "klaviyo-api-key")
 * @returns {Promise<string>} Secret value
 */
async function getSecret(name) {
  const secret = await getClient().getSecret(name);
  if (!secret.value) {
    throw new Error(`Secret "${name}" exists in Key Vault but has no value`);
  }
  return secret.value;
}

/**
 * Fetch multiple secrets in parallel.
 * @param {string[]} names
 * @returns {Promise<Record<string, string>>}
 */
async function getSecrets(names) {
  const entries = await Promise.all(
    names.map(async (name) => [name, await getSecret(name)])
  );
  return Object.fromEntries(entries);
}

module.exports = { getSecret, getSecrets };
