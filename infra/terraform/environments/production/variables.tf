variable "azure_tenant_id" {
  type      = string
  sensitive = true
}

variable "connector_sp_object_ids" {
  type    = list(string)
  default = []
}

variable "admin_object_ids" {
  type    = list(string)
  default = []
}

variable "log_analytics_workspace_id" {
  type        = string
  description = "Log Analytics workspace resource ID for Key Vault audit logs. Optional."
  default     = ""
}
