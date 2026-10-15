# infra/terraform/apply-production.ps1
# Run after: az login AND staging apply verified
# Prerequisites:
#   1. az login completed
#   2. infra/terraform/environments/production/terraform.tfvars populated
#   3. Staging apply has been verified (doddl-kv-staging live)
#   4. Azure Blob Storage account 'doddltfstate' exists (created by staging apply)
#
# Usage: .\infra\terraform\apply-production.ps1

$ErrorActionPreference = "Stop"
$env:PATH = "C:\Users\JonFawcett\bin;$env:PATH"

Set-Location "$PSScriptRoot\environments\production"

Write-Host "=== doddl AI OS — Terraform apply (production) ===" -ForegroundColor Cyan

# Confirm az login
Write-Host "`n[1/4] Checking Azure auth..."
az account show --query "{subscription:name, tenant:tenantId}" -o table
if ($LASTEXITCODE -ne 0) { Write-Host "Run az login first" -ForegroundColor Red; exit 1 }

# Init (connects to remote state backend)
Write-Host "`n[2/4] terraform init..."
terraform init -reconfigure

# Plan
Write-Host "`n[3/4] terraform plan..."
terraform plan "-out=production.tfplan"

# Apply
Write-Host "`n[4/4] terraform apply..."
terraform apply "production.tfplan"

Write-Host "`n=== Production apply complete ===" -ForegroundColor Green
Write-Host "Copy the vault_uri output to Vercel production env var AZURE_KEYVAULT_URI"
terraform output production_vault_uri
