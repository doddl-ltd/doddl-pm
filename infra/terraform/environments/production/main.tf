terraform {
  required_version = ">= 1.5"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
  }

  backend "azurerm" {
    resource_group_name  = "doddl-terraform-state"
    storage_account_name = "doddltfstate"
    container_name       = "tfstate"
    key                  = "production.terraform.tfstate"
  }
}

provider "azurerm" {
  features {
    key_vault {
      purge_soft_delete_on_destroy    = false
      recover_soft_deleted_key_vaults = true
    }
  }
}

# ── Locals ────────────────────────────────────────────────────────────────────

locals {
  environment = "production"
  location    = "uksouth"

  common_tags = {
    project     = "doddl-ai-os"
    environment = local.environment
    managed_by  = "terraform"
  }
}

# ── Key Vault ─────────────────────────────────────────────────────────────────

module "keyvault" {
  source = "../../modules/keyvault"

  vault_name          = "doddl-kv-prod"
  resource_group_name = "doddl-ai-os-production"
  location            = local.location
  environment         = local.environment
  tenant_id           = var.azure_tenant_id

  service_principal_object_ids = var.connector_sp_object_ids
  admin_object_ids             = var.admin_object_ids
  log_analytics_workspace_id   = var.log_analytics_workspace_id

  tags = local.common_tags
}

# ── Outputs ───────────────────────────────────────────────────────────────────

output "production_vault_uri" {
  value       = module.keyvault.vault_uri
  description = "Set as AZURE_KEYVAULT_URI in Vercel production environment"
}
