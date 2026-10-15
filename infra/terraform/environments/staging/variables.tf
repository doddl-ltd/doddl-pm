variable "azure_tenant_id" {
  type        = string
  description = "Azure AD tenant ID — set in terraform.tfvars or ARM_TENANT_ID env var"
  sensitive   = true
}

variable "connector_sp_object_ids" {
  type        = list(string)
  description = "Object IDs of service principals for connector runtime access"
  default     = []
}

variable "admin_object_ids" {
  type        = list(string)
  description = "Object IDs of human admins (Jon, authorised engineers)"
  default     = []
}

variable "log_analytics_workspace_id" {
  type        = string
  description = "Log Analytics workspace resource ID for Key Vault audit logs. Optional — omit to skip diagnostic settings."
  default     = ""
}
