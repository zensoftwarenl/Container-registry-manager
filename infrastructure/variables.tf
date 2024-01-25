variable "region" {
  type = string
  description = "The region the CDN bucket will be created in."
}
variable "project_id" {
  type = string
  description = "The project id of the project that the bucket will be made under"
}

variable "uniform_bucket_level_access" {
  type = bool
  default = false
  description = "Set uniform bucket access"
}