# Mint a per-agent PM API key.
#
#   powershell -File scripts/mint-agent-key.ps1 -AgentId doddl-transcribe -Scopes "inbox:write,tasks:read" -Migration lib/migrations/18-agent-keys.sql
#
# - Generates a random key (dpm_ + 43 chars), never printed.
# - Stores the plaintext in Key Vault doddl-kv-prod as pm-agent-key-<AgentId>
#   (a PUT creates a new version; old versions are retained).
# - Appends an idempotent INSERT of sha256(key) to the migration file, which
#   is then committed and applied with scripts/safe-apply-migration.js.
#   Rotating = mint again + revoke the old row (UPDATE agent_keys SET revoked_at).
#
# Needs an Azure sign-in with Key Vault secret write access (Get-AzAccessToken).

param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-z0-9][a-z0-9-]{1,40}$')][string]$AgentId,
  [Parameter(Mandatory = $true)][string]$Scopes,
  [Parameter(Mandatory = $true)][string]$Migration,
  [string]$Label = '',
  [string]$Vault = 'doddl-kv-prod'
)
$ErrorActionPreference = 'Stop'

$valid = @('tasks:read', 'tasks:write', 'inbox:write', 'inbox:triage', 'approvals:write')
$scopeList = $Scopes.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }
foreach ($s in $scopeList) { if ($valid -notcontains $s) { throw "Unknown scope '$s'. Valid: $($valid -join ', ')" } }

$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$key = 'dpm_' + ([Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_'))

$sha = [System.Security.Cryptography.SHA256]::Create()
$hash = -join ($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($key)) | ForEach-Object { $_.ToString('x2') })
$prefix = $key.Substring(0, 8)

$t = Get-AzAccessToken -ResourceUrl 'https://vault.azure.net'
$token = if ($t.Token -is [System.Security.SecureString]) { [System.Net.NetworkCredential]::new('', $t.Token).Password } else { $t.Token }
$secretName = "pm-agent-key-$AgentId"
$body = @{ value = $key; contentType = 'doddl-pm agent key'; tags = @{ agent_id = $AgentId; scopes = ($scopeList -join ' '); prefix = $prefix } } | ConvertTo-Json -Depth 4
Invoke-RestMethod -Method Put -Uri "https://$Vault.vault.azure.net/secrets/$secretName`?api-version=7.4" -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' -Body $body | Out-Null
$key = $null

$scopeSql = ($scopeList | ForEach-Object { "'$_'" }) -join ', '
$labelSql = if ($Label) { "'" + $Label.Replace("'", "''") + "'" } else { 'NULL' }
$utf8 = New-Object System.Text.UTF8Encoding($false)   # no BOM: Postgres rejects it
$full = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Migration)
if (-not (Test-Path $full)) {
  [System.IO.File]::WriteAllText($full, @"
-- Migration: $([System.IO.Path]::GetFileNameWithoutExtension($Migration))
-- Description: Per-agent PM API keys (sha256 only). Plaintext keys are in Key
--              Vault $Vault as pm-agent-key-<agent_id>. Minted with
--              scripts/mint-agent-key.ps1. Hashes are safe to commit.

"@, $utf8)
}
[System.IO.File]::AppendAllText($full, @"

INSERT INTO public.agent_keys (agent_id, key_hash, key_prefix, scopes, label)
VALUES ('$AgentId', '$hash', '$prefix', ARRAY[$scopeSql], $labelSql)
ON CONFLICT (key_hash) DO NOTHING;
"@, $utf8)

Write-Output "Minted key for '$AgentId' (prefix $prefix, scopes $($scopeList -join ' ')). Stored in Key Vault as $secretName; hash appended to $Migration."
