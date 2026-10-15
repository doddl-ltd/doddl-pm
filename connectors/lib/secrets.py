"""
Runtime credential fetcher — Azure Key Vault.

No credential is stored in code or env files. Connectors call get_secret()
to retrieve API keys at runtime.

Auth: DefaultAzureCredential tries, in order:
  1. Managed Identity (when running in Azure)
  2. Azure CLI credentials (local development)
  3. Environment variables AZURE_CLIENT_ID / AZURE_CLIENT_SECRET / AZURE_TENANT_ID

Required packages (see connectors/requirements.txt):
  azure-keyvault-secrets
  azure-identity
"""

import os
from functools import lru_cache
from azure.keyvault.secrets import SecretClient
from azure.identity import (
    DefaultAzureCredential,
    ChainedTokenCredential,
    InteractiveBrowserCredential,
    ManagedIdentityCredential,
)
from azure.identity import TokenCachePersistenceOptions

_VAULT_URI = os.environ.get("AZURE_KEYVAULT_URI")
if not _VAULT_URI:
    raise EnvironmentError("AZURE_KEYVAULT_URI environment variable is not set")

_client: SecretClient | None = None


def _get_client() -> SecretClient:
    global _client
    if _client is None:
        tenant_id = os.environ.get("AZURE_TENANT_ID")
        if tenant_id:
            # When AZURE_TENANT_ID is set, build an explicit chain so each
            # credential targets the correct tenant.  Order:
            #   1. ManagedIdentity  — zero-config when running in Azure
            #   2. AzurePowerShell  — local dev with Connect-AzAccount
            #   3. DeviceCode       — interactive fallback (caches token on disk)
            credential = ChainedTokenCredential(
                ManagedIdentityCredential(),
                InteractiveBrowserCredential(
                    tenant_id=tenant_id,
                    cache_persistence_options=TokenCachePersistenceOptions(
                        name="doddl-ai-os",
                        allow_unencrypted_storage=False,
                    ),
                ),
            )
        else:
            credential = DefaultAzureCredential()
        _client = SecretClient(vault_url=_VAULT_URI, credential=credential)
    return _client


def get_secret(name: str) -> str:
    """Fetch a secret value from Key Vault. Raises if secret is missing or empty."""
    secret = _get_client().get_secret(name)
    if not secret.value:
        raise ValueError(f'Secret "{name}" exists in Key Vault but has no value')
    return secret.value


@lru_cache(maxsize=256)
def get_secret_cached(name: str) -> str:
    """
    Fetch a secret and cache it in-process for the lifetime of the connector run.
    Use this for secrets that don't change between connector invocations.
    Do not use this for credentials that may be rotated mid-run.
    """
    return get_secret(name)


def get_secrets(names: list[str]) -> dict[str, str]:
    """Fetch multiple secrets. Returns {name: value} dict."""
    return {name: get_secret(name) for name in names}
