terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
  }
}

# ── Variables ─────────────────────────────────────────────────────────────────

variable "vault_name" {
  type        = string
  description = "Globally unique Key Vault name (3–24 chars, alphanumeric + hyphens)"
}

variable "resource_group_name" {
  type = string
}

variable "location" {
  type    = string
  default = "uksouth"
}

variable "tenant_id" {
  type        = string
  description = "Azure AD tenant ID"
  sensitive   = true
}

variable "environment" {
  type        = string
  description = "staging | production"
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production"
  }
}

variable "service_principal_object_ids" {
  type        = list(string)
  description = "Object IDs of service principals needing GET/LIST on secrets at runtime"
  default     = []
}

variable "admin_object_ids" {
  type        = list(string)
  description = "Object IDs of human admins with full secret management"
  default     = []
}

variable "log_analytics_workspace_id" {
  type        = string
  description = "Log Analytics workspace resource ID for Key Vault audit logs. Leave empty to skip diagnostic settings."
  default     = ""
}

variable "tags" {
  type    = map(string)
  default = {}
}

# ── Resource Group ────────────────────────────────────────────────────────────

resource "azurerm_resource_group" "rg" {
  name     = var.resource_group_name
  location = var.location
  tags     = merge(var.tags, { environment = var.environment })
}

# ── Key Vault ─────────────────────────────────────────────────────────────────

resource "azurerm_key_vault" "kv" {
  name                = var.vault_name
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  tenant_id           = var.tenant_id
  sku_name            = "standard"

  soft_delete_retention_days = 90
  purge_protection_enabled   = true

  # Deny all by default — connectors connect via service principal or managed identity
  network_acls {
    default_action = "Deny"
    bypass         = "AzureServices"
    ip_rules       = []
  }

  tags = merge(var.tags, {
    environment = var.environment
    managed_by  = "terraform"
  })
}

# ── Access Policies ───────────────────────────────────────────────────────────

resource "azurerm_key_vault_access_policy" "connector" {
  for_each     = toset(var.service_principal_object_ids)
  key_vault_id = azurerm_key_vault.kv.id
  tenant_id    = var.tenant_id
  object_id    = each.value

  secret_permissions      = ["Get", "List"]
  key_permissions         = []
  certificate_permissions = []
}

resource "azurerm_key_vault_access_policy" "admin" {
  for_each     = toset(var.admin_object_ids)
  key_vault_id = azurerm_key_vault.kv.id
  tenant_id    = var.tenant_id
  object_id    = each.value

  secret_permissions = [
    "Get", "List", "Set", "Delete", "Recover", "Backup", "Restore", "Purge"
  ]
  key_permissions = [
    "Get", "List", "Create", "Delete", "Recover", "Backup", "Restore",
    "Rotate", "GetRotationPolicy", "SetRotationPolicy"
  ]
  certificate_permissions = []
}

# ── Diagnostic Settings (conditional on log_analytics_workspace_id) ───────────
# Skipped when log_analytics_workspace_id is empty — avoids requiring a workspace
# before the vault can be provisioned. Set the variable once a workspace exists.
# Uses azurerm 3.x enabled_log block (log block deprecated in 3.x).

resource "azurerm_monitor_diagnostic_setting" "kv_audit" {
  count = var.log_analytics_workspace_id != "" ? 1 : 0

  name                       = "${var.vault_name}-audit"
  target_resource_id         = azurerm_key_vault.kv.id
  log_analytics_workspace_id = var.log_analytics_workspace_id

  enabled_log {
    category = "AuditEvent"
  }

  metric {
    category = "AllMetrics"
    enabled  = false
  }
}

# ── Outputs ───────────────────────────────────────────────────────────────────

output "vault_uri" {
  value       = azurerm_key_vault.kv.vault_uri
  description = "Key Vault URI — set as AZURE_KEYVAULT_URI in Vercel environment"
}

output "vault_id" {
  value = azurerm_key_vault.kv.id
}

output "resource_group_name" {
  value = azurerm_resource_group.rg.name
}
