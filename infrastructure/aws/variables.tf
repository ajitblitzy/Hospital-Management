# =============================================================================
# Hospital Management System (HMS) - AWS Infrastructure Input Variables
# -----------------------------------------------------------------------------
# This is the SINGLE SOURCE of input variables for the HMS AWS IaC root module.
# Every other file in this flat root module (main.tf, providers.tf, vpc.tf,
# security_groups.tf, iam.tf, s3.tf, eks.tf, rds.tf, elasticache.tf,
# secrets.tf, outputs.tf) consumes the variables declared here.
#
# Grounded in the HMS documentation package:
#   * 03_Technical_Architecture  - AWS, PostgreSQL, Redis, Docker & Kubernetes,
#                                  horizontal scaling, database replication,
#                                  encrypted patient data storage (HA design).
#   * 04_Database_Design_and_ERD - PostgreSQL with connection pooling.
#   * 02_Functional_Requirements - patient identification-document uploads -> S3.
#
# CONSISTENCY CONTRACT (defaults below MUST stay in sync):
#   * Root ../../.env.example : POSTGRES_DB=hms, POSTGRES_USER=hms_user,
#                               POSTGRES_PORT=5432, REDIS_PORT=6379,
#                               AWS_REGION=us-east-1.
#   * Root ../../docker-compose.yml : postgres:16 (PostgreSQL 16 family),
#                                     redis:7 (Redis 7 family).
#
# CONVENTIONS:
#   * HCL2, 2-space indentation, canonical `terraform fmt` style.
#   * Every variable declares an explicit `type` and `description`.
#   * `validation` blocks guard invariants where noted.
#   * Defaults contain NO secrets (no passwords, keys, tokens, or ARNs).
#   * Declares ONLY `variable` blocks - locals/data/resources live elsewhere.
# =============================================================================

# -----------------------------------------------------------------------------
# Global / naming
# -----------------------------------------------------------------------------

variable "project_name" {
  type        = string
  description = "Short project slug used as a prefix in resource names and tags (e.g. \"hms-production-vpc\"). Keep it lowercase and DNS/-friendly."
  default     = "hms"
}

variable "environment" {
  type        = string
  description = "Deployment environment identifier (e.g. production, staging, development). Combined with project_name to build the resource name_prefix and injected into the common tag set in main.tf."
  default     = "production"
}

variable "aws_region" {
  type        = string
  description = "AWS region into which all regional resources (VPC, EKS, RDS, ElastiCache, S3) are provisioned. MUST match the AWS_REGION default in the root ../../.env.example. Consumed by providers.tf."
  default     = "us-east-1"
}

variable "tags" {
  type        = map(string)
  description = "Extra key/value tags merged into the common tag set defined in main.tf and applied to every taggable resource. Use for cost-allocation, ownership, or compliance metadata."
  default     = {}
}

# -----------------------------------------------------------------------------
# Networking (VPC - multi-AZ for high availability)
# -----------------------------------------------------------------------------

variable "vpc_cidr" {
  type        = string
  description = "IPv4 CIDR block for the HMS VPC. Must be large enough to carve out the public and private subnets declared below (a /16 provides ample room for multi-AZ /20 subnets)."
  default     = "10.0.0.0/16"
}

variable "az_count" {
  type        = number
  description = "Number of Availability Zones the network (and downstream EKS/RDS/ElastiCache resources) spans. Multi-AZ deployment delivers the high availability described in the technical architecture. Must be at least 2, and no greater than the number of subnet CIDRs supplied below."
  default     = 3

  validation {
    condition     = var.az_count >= 2
    error_message = "az_count must be at least 2 to provide multi-AZ high availability."
  }
}

variable "public_subnet_cidrs" {
  type        = list(string)
  description = "Public subnet CIDR blocks, one per Availability Zone, hosting the internet-facing load balancer(s) and NAT gateway(s). Provide at least az_count entries."
  default     = ["10.0.0.0/20", "10.0.16.0/20", "10.0.32.0/20"]
}

variable "private_subnet_cidrs" {
  type        = list(string)
  description = "Private subnet CIDR blocks, one per Availability Zone, hosting the EKS worker nodes, RDS instances, and ElastiCache nodes (no direct inbound internet access). Provide at least az_count entries."
  default     = ["10.0.48.0/20", "10.0.64.0/20", "10.0.80.0/20"]
}

variable "enable_nat_gateway" {
  type        = bool
  description = "Whether to provision NAT gateway(s) so resources in the private subnets can reach the internet for egress (image pulls, OS/security updates, outbound API calls)."
  default     = true
}

variable "single_nat_gateway" {
  type        = bool
  description = "NAT gateway topology tradeoff. When false (recommended for production) one NAT gateway is created per Availability Zone, eliminating a cross-AZ single point of failure and avoiding cross-AZ data-transfer charges for egress. When true a single shared NAT gateway is created to reduce cost in non-production environments, at the expense of AZ-level high availability."
  default     = false
}

# -----------------------------------------------------------------------------
# EKS (Kubernetes platform - horizontal scaling per technical architecture)
# -----------------------------------------------------------------------------

variable "eks_cluster_version" {
  type        = string
  description = "Kubernetes minor version for the EKS control plane and the managed node groups. Keep the control plane and nodes on the same supported minor version."
  default     = "1.30"
}

variable "eks_node_instance_types" {
  type        = list(string)
  description = "Instance types eligible for the managed node group. A list allows mixed/fallback types for capacity flexibility; the first type is used for on-demand sizing decisions."
  default     = ["t3.large"]
}

variable "eks_node_desired_size" {
  type        = number
  description = "Desired number of worker nodes in the managed node group at steady state. Spread across the Availability Zones to support the horizontal scaling described in the technical architecture."
  default     = 3
}

variable "eks_node_min_size" {
  type        = number
  description = "Minimum number of worker nodes the cluster autoscaler may scale the managed node group down to. Kept at multi-AZ parity to preserve availability during low load."
  default     = 3
}

variable "eks_node_max_size" {
  type        = number
  description = "Maximum number of worker nodes the cluster autoscaler may scale the managed node group up to during peak load (horizontal scaling ceiling)."
  default     = 6
}

variable "eks_node_disk_size" {
  type        = number
  description = "Size, in GiB, of the EBS root volume attached to each EKS worker node (used for the OS, container images, and ephemeral pod storage)."
  default     = 50
}

variable "eks_endpoint_public_access" {
  type        = bool
  description = "Whether the EKS control-plane API server endpoint is reachable from the public internet. Public access is convenient for administration but should be paired with a restrictive eks_public_access_cidrs allowlist."
  default     = true
}

variable "eks_public_access_cidrs" {
  type        = list(string)
  description = "CIDR blocks permitted to reach the public EKS API server endpoint. The default 0.0.0.0/0 allows access from anywhere and MUST be restricted to trusted administrative networks in real deployments."
  default     = ["0.0.0.0/0"]
}

# -----------------------------------------------------------------------------
# RDS PostgreSQL 16 (managed primary + read replica -> "Database replication")
# -----------------------------------------------------------------------------

variable "postgres_version" {
  type        = string
  description = "PostgreSQL engine version for the RDS instance. MUST remain in the PostgreSQL 16 family to match the HMS stack (root docker-compose.yml uses postgres:16). A specific minor may be pinned (e.g. \"16.4\") but the major version must stay 16."
  default     = "16"
}

variable "postgres_instance_class" {
  type        = string
  description = "RDS DB instance class (compute and memory capacity) for the PostgreSQL primary and its read replica(s)."
  default     = "db.t3.medium"
}

variable "postgres_allocated_storage" {
  type        = number
  description = "Initial allocated storage, in GiB, provisioned for the PostgreSQL primary instance."
  default     = 50
}

variable "postgres_max_allocated_storage" {
  type        = number
  description = "Upper bound, in GiB, to which RDS storage autoscaling may grow the PostgreSQL instance. Must be greater than or equal to postgres_allocated_storage; setting it higher enables storage autoscaling."
  default     = 200
}

variable "postgres_db_name" {
  type        = string
  description = "Name of the initial application database created on the PostgreSQL instance. MUST equal POSTGRES_DB in the root ../../.env.example."
  default     = "hms"
}

variable "postgres_username" {
  type        = string
  description = "Master username for the PostgreSQL instance. MUST equal POSTGRES_USER in the root ../../.env.example. The corresponding password is NOT declared here - it is generated/stored via Secrets Manager in secrets.tf."
  default     = "hms_user"
}

variable "postgres_port" {
  type        = number
  description = "TCP port on which the PostgreSQL instance listens. MUST equal POSTGRES_PORT in the root ../../.env.example."
  default     = 5432
}

variable "postgres_multi_az" {
  type        = bool
  description = "Whether to deploy the PostgreSQL primary as Multi-AZ, provisioning a synchronous standby in a second Availability Zone for automatic failover and high availability."
  default     = true
}

variable "postgres_read_replica_count" {
  type        = number
  description = "Number of PostgreSQL read replicas to provision. At least one replica implements the \"Database replication\" requirement in the technical architecture and offloads read-heavy reporting traffic from the primary. Set to 0 to disable read replicas."
  default     = 1

  validation {
    condition     = var.postgres_read_replica_count >= 0
    error_message = "postgres_read_replica_count must be zero or greater."
  }
}

variable "postgres_backup_retention_days" {
  type        = number
  description = "Number of days automated PostgreSQL backups (and the point-in-time recovery window) are retained."
  default     = 7
}

variable "postgres_deletion_protection" {
  type        = bool
  description = "When true, RDS deletion protection is enabled so the PostgreSQL instance cannot be destroyed without first disabling this setting - guarding sensitive patient data against accidental deletion."
  default     = true
}

variable "postgres_storage_encrypted" {
  type        = bool
  description = "Whether PostgreSQL storage is encrypted at rest, satisfying the \"Encrypted patient data storage\" requirement in the technical architecture. Should remain true for any environment holding patient data."
  default     = true
}

# -----------------------------------------------------------------------------
# ElastiCache Redis 7 (caching, sessions, async job processing)
# -----------------------------------------------------------------------------

variable "redis_version" {
  type        = string
  description = "Redis engine version for the ElastiCache replication group. MUST remain in the Redis 7 family to match the HMS stack (root docker-compose.yml uses redis:7)."
  default     = "7.1"
}

variable "redis_node_type" {
  type        = string
  description = "ElastiCache node instance type (compute and memory capacity) for each Redis cache node."
  default     = "cache.t3.micro"
}

variable "redis_num_cache_clusters" {
  type        = number
  description = "Number of cache nodes in the Redis replication group: one primary plus (num - 1) read replicas. A value of 2 or more places the primary and at least one replica in different Availability Zones for high availability."
  default     = 2

  validation {
    condition     = var.redis_num_cache_clusters >= 1
    error_message = "redis_num_cache_clusters must be at least 1 (a single primary node)."
  }
}

variable "redis_port" {
  type        = number
  description = "TCP port on which the Redis endpoint listens. MUST equal REDIS_PORT in the root ../../.env.example."
  default     = 6379
}

variable "redis_automatic_failover" {
  type        = bool
  description = "Whether automatic failover is enabled so ElastiCache promotes a read replica to primary if the primary node fails. Requires redis_num_cache_clusters to be at least 2 to have a replica available for promotion."
  default     = true
}

variable "redis_multi_az" {
  type        = bool
  description = "Whether the Redis replication group is Multi-AZ, distributing the primary and replica node(s) across Availability Zones for high availability. Works together with redis_automatic_failover."
  default     = true
}

variable "redis_at_rest_encryption" {
  type        = bool
  description = "Whether Redis data is encrypted at rest. Should remain true wherever cached data may contain sensitive patient information."
  default     = true
}

variable "redis_transit_encryption" {
  type        = bool
  description = "Whether Redis connections are encrypted in transit (TLS). Must be true when redis_auth_enabled is true, because the AUTH token is only accepted over an encrypted connection."
  default     = true
}

variable "redis_auth_enabled" {
  type        = bool
  description = "Whether Redis AUTH is enabled. When true, a random_password AUTH token is generated in elasticache.tf and required on every connection; this REQUIRES redis_transit_encryption to also be true, since the token is only transmitted over TLS."
  default     = true
}

# -----------------------------------------------------------------------------
# S3 (patient identification-document uploads - functional requirements doc 02)
# -----------------------------------------------------------------------------

variable "s3_force_destroy" {
  type        = bool
  description = "Whether Terraform may destroy the uploads S3 bucket even when it still contains objects. Kept false by default so patient identification documents cannot be deleted along with the bucket by an accidental `terraform destroy`; only set true for disposable non-production buckets you fully intend to empty."
  default     = false
}

variable "s3_versioning_enabled" {
  type        = bool
  description = "Whether object versioning is enabled on the uploads S3 bucket. Versioning preserves prior versions of patient identification documents, protecting against accidental overwrite or deletion."
  default     = true
}

variable "s3_bucket_name_override" {
  type        = string
  description = "Optional explicit name for the uploads S3 bucket. Leave empty (the default) to let main.tf compute a deterministic, globally unique bucket name from the project name, environment, and AWS account id. Set a value only when a specific pre-existing bucket name must be used."
  default     = ""
}

