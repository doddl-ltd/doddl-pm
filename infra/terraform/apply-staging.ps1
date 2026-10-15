# infra/terraform/apply-staging.ps1
# Run after: az login
# Prerequisites:
#   1. az login completed
#   2. Copy terraform.tfvars.example to terraform.tfvars and populate values
#   3. Azure Blob Storage account 'doddltfstate' exists in RG 'doddl-terraform-state'
#      Create once: az storage account create --name doddltfstate --resource-group doddl-terraform-state --sku Standard_LRS --location uksouth
#
# Usage: .\infra\terraform\apply-staging.ps1

$ErrorActionPreference = "Stop"
$env:PATH = "C:\Users\JonFawcett\bin;$env:PATH"

Set-Location "$PSScriptRoot\environments\staging"

Write-Host "=== doddl AI OS — Terraform apply (staging) ===" -ForegroundColor Cyan

# Confirm az login
Write-Host "`n[1/4] Checking Azure auth..."
az account show --query "{subscription:name, tenant:tenantId}" -o table
if ($LASTEXITCODE -ne 0) { Write-Host "Run az login first" -ForegroundColor Red; exit 1 }

# Init (connects to remote state backend)
Write-Host "`n[2/4] terraform init..."
terraform init -reconfigure

# Plan
Write-Host "`n[3/4] terraform plan..."
terraform plan -out=staging.tfplan

# Apply
Write-Host "`n[4/4] terraform apply..."
terraform apply staging.tfplan

Write-Host "`n=== Staging apply complete ===" -ForegroundColor Green
Write-Host "Copy the vault_uri output to Vercel staging env var AZURE_KEYVAULT_URI"
terraform output staging_vault_uri