"""
doddl AI OS Scheduler — full Azure provisioning script.

Runs on Jon's machine using the cached DeviceCodeCredential.
Creates all Azure infrastructure and configures GitHub Actions secrets.

Usage:
    python infra/scheduler/provision.py
"""

import os
import sys
import json
import uuid
import ctypes
import ctypes.wintypes
from base64 import b64decode, b64encode

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

import httpx
from azure.identity import ChainedTokenCredential, ManagedIdentityCredential, DeviceCodeCredential
from azure.identity import TokenCachePersistenceOptions

# ── Config ────────────────────────────────────────────────────────────────────
SUBSCRIPTION_ID  = "a674bfa5-c168-480b-9768-046585d01f5f"
TENANT_ID        = "927d1e2c-7c8d-406f-8640-678dfce86b7d"
LOCATION         = "uksouth"
RESOURCE_GROUP   = "doddl-ai-os-production"
ACR_NAME         = "doddlacr"
CONTAINER_APP_ENV  = "doddl-scheduler-env"
CONTAINER_APP_NAME = "doddl-scheduler"
KEYVAULT_NAME    = "doddl-kv-prod"
KEYVAULT_URI     = "https://doddl-kv-prod.vault.azure.net/"
GITHUB_REPO      = "D0DDL/doddl-pm"
SP_NAME          = "doddl-scheduler-github-actions"

# Role definition IDs (Azure built-in)
ROLE_KV_SECRETS_USER = "4633458b-17de-408a-b874-0445c86b69e6"
ROLE_CONTRIBUTOR     = "b24988ac-6180-42a0-ab88-20f7382dd24c"
ROLE_ACRPUSH         = "8311e382-0749-4cb8-b61a-304f252e0e56"

os.environ.setdefault("AZURE_KEYVAULT_URI", KEYVAULT_URI)
os.environ.setdefault("AZURE_TENANT_ID", TENANT_ID)


# ── Azure credential (uses cached token — no re-prompt if cache is warm) ──────
credential = ChainedTokenCredential(
    ManagedIdentityCredential(),
    DeviceCodeCredential(
        tenant_id=TENANT_ID,
        cache_persistence_options=TokenCachePersistenceOptions(
            name="doddl-ai-os",
            allow_unencrypted_storage=False,
        ),
    ),
)


def _token(scope: str) -> str:
    return credential.get_token(scope).token


def _mgmt_headers() -> dict:
    return {"Authorization": f"Bearer {_token('https://management.azure.com/.default')}",
            "Content-Type": "application/json"}


def _graph_headers() -> dict:
    return {"Authorization": f"Bearer {_token('https://graph.microsoft.com/.default')}",
            "Content-Type": "application/json"}


def _arm_put(path: str, body: dict, api: str) -> dict:
    url = f"https://management.azure.com{path}?api-version={api}"
    r = httpx.put(url, headers=_mgmt_headers(), json=body, timeout=120.0)
    if r.status_code not in (200, 201):
        raise RuntimeError(f"PUT {path} → {r.status_code}: {r.text[:300]}")
    return r.json()


def _arm_get(path: str, api: str) -> dict:
    url = f"https://management.azure.com{path}?api-version={api}"
    r = httpx.get(url, headers=_mgmt_headers(), timeout=30.0)
    r.raise_for_status()
    return r.json()


def _graph_get(path: str) -> dict:
    r = httpx.get(f"https://graph.microsoft.com/v1.0{path}", headers=_graph_headers(), timeout=30.0)
    r.raise_for_status()
    return r.json()


def _graph_post(path: str, body: dict) -> dict:
    r = httpx.post(f"https://graph.microsoft.com/v1.0{path}", headers=_graph_headers(),
                   json=body, timeout=30.0)
    if r.status_code not in (200, 201):
        raise RuntimeError(f"POST {path} → {r.status_code}: {r.text[:300]}")
    return r.json()


def _assign_role(scope: str, role_id: str, principal_id: str) -> None:
    path = f"{scope}/providers/Microsoft.Authorization/roleAssignments/{uuid.uuid4()}"
    body = {"properties": {
        "roleDefinitionId": f"/subscriptions/{SUBSCRIPTION_ID}/providers/Microsoft.Authorization/roleDefinitions/{role_id}",
        "principalId": principal_id,
        "principalType": "ServicePrincipal",
    }}
    try:
        _arm_put(path, body, "2022-04-01")
    except RuntimeError as e:
        if "RoleAssignmentExists" in str(e) or "409" in str(e):
            pass  # already assigned
        else:
            raise


# ── GitHub PAT from Windows Credential Manager ────────────────────────────────
def _get_github_pat() -> str:
    class CREDENTIAL(ctypes.Structure):
        _fields_ = [
            ("Flags", ctypes.wintypes.DWORD),
            ("Type", ctypes.wintypes.DWORD),
            ("TargetName", ctypes.wintypes.LPWSTR),
            ("Comment", ctypes.wintypes.LPWSTR),
            ("LastWritten", ctypes.c_uint64),
            ("CredentialBlobSize", ctypes.wintypes.DWORD),
            ("CredentialBlob", ctypes.POINTER(ctypes.c_byte)),
            ("Persist", ctypes.wintypes.DWORD),
            ("AttributeCount", ctypes.wintypes.DWORD),
            ("Attributes", ctypes.c_void_p),
            ("TargetAlias", ctypes.wintypes.LPWSTR),
            ("UserName", ctypes.wintypes.LPWSTR),
        ]

    advapi = ctypes.windll.advapi32
    ptr = ctypes.c_void_p()
    if not advapi.CredReadW("git:https://github.com", 1, 0, ctypes.byref(ptr)):
        raise RuntimeError("Could not read GitHub credential from Windows Credential Manager")
    try:
        cred = ctypes.cast(ptr, ctypes.POINTER(CREDENTIAL)).contents
        raw = bytearray(cred.CredentialBlobSize)
        for i in range(cred.CredentialBlobSize):
            raw[i] = cred.CredentialBlob[i]
        return raw.decode("utf-16-le")
    finally:
        advapi.CredFree(ptr)


# ── GitHub secret encryption (libsodium SealedBox) ───────────────────────────
def _encrypt_github_secret(public_key_b64: str, secret_value: str) -> str:
    from nacl import encoding, public as nacl_public
    pk = nacl_public.PublicKey(public_key_b64.encode(), encoding.Base64Encoder())
    box = nacl_public.SealedBox(pk)
    encrypted = box.encrypt(secret_value.encode("utf-8"))
    return b64encode(encrypted).decode("utf-8")


def _set_github_secret(pat: str, repo: str, name: str, value: str) -> None:
    headers = {"Authorization": f"Bearer {pat}", "Accept": "application/vnd.github+json",
               "X-GitHub-Api-Version": "2022-11-28"}
    # Get repo public key
    pk_r = httpx.get(f"https://api.github.com/repos/{repo}/actions/secrets/public-key",
                     headers=headers, timeout=15.0)
    pk_r.raise_for_status()
    pk_data = pk_r.json()

    encrypted = _encrypt_github_secret(pk_data["key"], value)

    put_r = httpx.put(
        f"https://api.github.com/repos/{repo}/actions/secrets/{name}",
        headers=headers,
        json={"encrypted_value": encrypted, "key_id": pk_data["key_id"]},
        timeout=15.0,
    )
    if put_r.status_code not in (201, 204):
        raise RuntimeError(f"Set secret {name} → {put_r.status_code}: {put_r.text}")


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    print("=" * 60)
    print("doddl AI OS — Scheduler Provisioning")
    print("=" * 60)

    rg_prefix = f"/subscriptions/{SUBSCRIPTION_ID}/resourceGroups/{RESOURCE_GROUP}/providers"

    # ── 1. Container Registry ─────────────────────────────────────────────────
    print("\n[1/6] Azure Container Registry...")
    acr_path = f"{rg_prefix}/Microsoft.ContainerRegistry/registries/{ACR_NAME}"
    try:
        acr = _arm_put(acr_path, {
            "location": LOCATION,
            "sku": {"name": "Basic"},
            "properties": {"adminUserEnabled": False},
            "tags": {"project": "doddl-ai-os", "environment": "production"},
        }, "2023-07-01")
        acr_login_server = acr["properties"]["loginServer"]
        print(f"  ✓ Created: {acr_login_server}")
    except RuntimeError:
        acr = _arm_get(acr_path, "2023-07-01")
        acr_login_server = acr["properties"]["loginServer"]
        print(f"  ✓ Exists:  {acr_login_server}")

    # ── 2. Container App Environment ──────────────────────────────────────────
    print("\n[2/6] Container App Environment...")
    env_path = f"{rg_prefix}/Microsoft.App/managedEnvironments/{CONTAINER_APP_ENV}"
    try:
        env = _arm_put(env_path, {
            "location": LOCATION,
            "properties": {},
            "tags": {"project": "doddl-ai-os"},
        }, "2023-05-01")
        env_id = env["id"]
        print(f"  ✓ Created: {CONTAINER_APP_ENV}")
    except RuntimeError:
        env = _arm_get(env_path, "2023-05-01")
        env_id = env["id"]
        print(f"  ✓ Exists:  {CONTAINER_APP_ENV}")

    # ── 3. Container App ──────────────────────────────────────────────────────
    print("\n[3/6] Container App (managed identity + Key Vault env var)...")
    app_path = f"{rg_prefix}/Microsoft.App/containerApps/{CONTAINER_APP_NAME}"
    try:
        app = _arm_put(app_path, {
            "location": LOCATION,
            "identity": {"type": "SystemAssigned"},
            "properties": {
                "managedEnvironmentId": env_id,
                "configuration": {
                    "registries": [{"server": acr_login_server, "identity": "system"}],
                },
                "template": {
                    "containers": [{
                        "name": "scheduler",
                        # Placeholder image — replaced by GitHub Actions on first push
                        "image": "mcr.microsoft.com/azuredocs/containerapps-helloworld:latest",
                        "env": [{"name": "AZURE_KEYVAULT_URI", "value": KEYVAULT_URI}],
                        "resources": {"cpu": 0.5, "memory": "1Gi"},
                    }],
                    "scale": {"minReplicas": 1, "maxReplicas": 1},
                },
            },
            "tags": {"project": "doddl-ai-os", "environment": "production"},
        }, "2023-05-01")
        principal_id = app["identity"]["principalId"]
        print(f"  ✓ Created: {CONTAINER_APP_NAME}  principal={principal_id}")
    except RuntimeError:
        app = _arm_get(app_path, "2023-05-01")
        principal_id = app["identity"]["principalId"]
        print(f"  ✓ Exists:  {CONTAINER_APP_NAME}  principal={principal_id}")

    # ── 4. Key Vault role for managed identity ────────────────────────────────
    print("\n[4/6] Granting Key Vault Secrets User to Container App identity...")
    kv_path = f"/subscriptions/{SUBSCRIPTION_ID}/resourceGroups/{RESOURCE_GROUP}/providers/Microsoft.KeyVault/vaults/{KEYVAULT_NAME}"
    kv = _arm_get(kv_path, "2023-07-01")
    _assign_role(kv["id"], ROLE_KV_SECRETS_USER, principal_id)
    print(f"  ✓ Key Vault Secrets User → {CONTAINER_APP_NAME}")

    # ── 5. GitHub Actions service principal (OIDC) ────────────────────────────
    print("\n[5/6] GitHub Actions service principal (OIDC)...")
    apps = _graph_get(f"/applications?$filter=displayName eq '{SP_NAME}'").get("value", [])
    if apps:
        app_obj_id = apps[0]["id"]
        client_id = apps[0]["appId"]
        print(f"  ✓ App exists: {client_id}")
    else:
        obj = _graph_post("/applications", {"displayName": SP_NAME})
        app_obj_id, client_id = obj["id"], obj["appId"]
        print(f"  ✓ App created: {client_id}")

    sps = _graph_get(f"/servicePrincipals?$filter=appId eq '{client_id}'").get("value", [])
    if sps:
        sp_obj_id = sps[0]["id"]
        print(f"  ✓ SP exists: {sp_obj_id}")
    else:
        sp = _graph_post("/servicePrincipals", {"appId": client_id})
        sp_obj_id = sp["id"]
        print(f"  ✓ SP created: {sp_obj_id}")

    # Federated credential for staging branch
    try:
        _graph_post(f"/applications/{app_obj_id}/federatedIdentityCredentials", {
            "name": "github-actions-staging",
            "issuer": "https://token.actions.githubusercontent.com",
            "subject": f"repo:{GITHUB_REPO}:ref:refs/heads/staging",
            "audiences": ["api://AzureADTokenExchange"],
        })
        print(f"  ✓ Federated credential set (staging branch)")
    except RuntimeError as e:
        if "already exists" in str(e).lower() or "409" in str(e):
            print(f"  ✓ Federated credential already exists")
        else:
            print(f"  ! {e}")

    # Also add workflow_dispatch trigger support
    try:
        _graph_post(f"/applications/{app_obj_id}/federatedIdentityCredentials", {
            "name": "github-actions-dispatch",
            "issuer": "https://token.actions.githubusercontent.com",
            "subject": f"repo:{GITHUB_REPO}:workflow_dispatch",
            "audiences": ["api://AzureADTokenExchange"],
        })
        print(f"  ✓ Federated credential set (workflow_dispatch)")
    except RuntimeError as e:
        if "already exists" in str(e).lower() or "409" in str(e):
            print(f"  ✓ Federated credential (dispatch) already exists")
        else:
            print(f"  ! {e}")

    rg_scope = f"/subscriptions/{SUBSCRIPTION_ID}/resourceGroups/{RESOURCE_GROUP}"
    acr_scope = f"{rg_scope}/providers/Microsoft.ContainerRegistry/registries/{ACR_NAME}"
    _assign_role(rg_scope, ROLE_CONTRIBUTOR, sp_obj_id)
    print(f"  ✓ Contributor on resource group")
    _assign_role(acr_scope, ROLE_ACRPUSH, sp_obj_id)
    print(f"  ✓ AcrPush on {ACR_NAME}")

    # ── 6. GitHub Secrets ─────────────────────────────────────────────────────
    print("\n[6/6] Setting GitHub Actions secrets...")
    try:
        pat = _get_github_pat()
        secrets = {
            "AZURE_CLIENT_ID":       client_id,
            "AZURE_TENANT_ID":       TENANT_ID,
            "AZURE_SUBSCRIPTION_ID": SUBSCRIPTION_ID,
            "ACR_NAME":              ACR_NAME,
            "ACR_LOGIN_SERVER":      acr_login_server,
            "AZURE_RESOURCE_GROUP":  RESOURCE_GROUP,
            "CONTAINER_APP_NAME":    CONTAINER_APP_NAME,
        }
        for name, value in secrets.items():
            _set_github_secret(pat, GITHUB_REPO, name, value)
            print(f"  ✓ {name}")
    except Exception as e:
        print(f"  ! GitHub secrets failed: {e}")
        print(f"    Add these manually in GitHub → Settings → Secrets → Actions:")
        print(f"    AZURE_CLIENT_ID      = {client_id}")
        print(f"    AZURE_TENANT_ID      = {TENANT_ID}")
        print(f"    AZURE_SUBSCRIPTION_ID= {SUBSCRIPTION_ID}")
        print(f"    ACR_NAME             = {ACR_NAME}")
        print(f"    ACR_LOGIN_SERVER     = {acr_login_server}")
        print(f"    AZURE_RESOURCE_GROUP = {RESOURCE_GROUP}")
        print(f"    CONTAINER_APP_NAME   = {CONTAINER_APP_NAME}")

    print("\n" + "=" * 60)
    print("Provisioning complete.")
    print("Push to staging to trigger the first scheduler deployment.")
    print("=" * 60)


if __name__ == "__main__":
    main()
