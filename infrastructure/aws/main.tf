# =============================================================================
# Hospital Management System (HMS) - AWS Infrastructure Shared Locals & Data
# -----------------------------------------------------------------------------
# File:    infrastructure/aws/main.tf
# Module:  infrastructure/aws  (flat Terraform root module for the HMS AWS env)
#
# Purpose:
#   Central home for the CROSS-CUTTING values every other file in this flat root
#   module consumes: provider-derived `data` lookups (account id, region,
#   partition, availability zones) and the computed `locals` (name_prefix, the
#   AZ list, the common tag set, and the deterministic uploads S3 bucket name).
#
#   Keeping these here - rather than scattered across vpc.tf / eks.tf / rds.tf /
#   s3.tf / iam.tf - gives a single, authoritative definition and AVOIDS
#   CIRCULAR FILE DEPENDENCIES (most notably: both s3.tf, which creates the
#   patient-document bucket, and iam.tf, which grants access to it via an ARN,
#   reference local.s3_bucket_name defined below).
#
#   This file is intentionally SIDE-EFFECT FREE: it declares ONLY `data` sources
#   and `locals`. It creates NO resources. The `terraform {}` version block lives
#   in versions.tf, the `provider "aws"` configuration (with default_tags) lives
#   in providers.tf, and the state backend template lives in backend.tf.
#
# Grounded in Hospital_Management_Documentation_Package/
#   03_Hospital_Management_Technical_Architecture.pdf
#   (Cloud Platform: AWS; modular microservices; horizontal scaling; multi-AZ
#    high availability; encrypted patient-data storage).
#
# Conventions: HCL2, 2-space indentation, canonical `terraform fmt` style.
# =============================================================================

# -----------------------------------------------------------------------------
# Provider-derived data sources
# -----------------------------------------------------------------------------
# These lookups take NO input and are resolved by the configured AWS provider
# (providers.tf). They keep the module portable across accounts/regions: nothing
# below hard-codes an account id, region, partition, or AZ name.

# Enumerates the Availability Zones usable in the configured region so that
# local.azs (below) can spread the VPC subnets, EKS worker nodes, RDS instances,
# and ElastiCache nodes across multiple AZs for the high availability described
# in the technical architecture.
data "aws_availability_zones" "available" {
  state = "available"
}

# The AWS account id of the caller. Used to build the globally-unique S3 bucket
# name (local.s3_bucket_name) and to construct IAM policy ARNs in iam.tf.
data "aws_caller_identity" "current" {}

# The region Terraform is currently operating in. Surfaced through outputs.tf and
# injected into service configuration (e.g. the AWS_REGION SSM parameter value).
data "aws_region" "current" {}

# The AWS partition (e.g. "aws", "aws-us-gov", "aws-cn"). Used to construct
# partition-correct ARNs (arn:${partition}:...) in iam.tf and elsewhere instead
# of hard-coding "aws", so the module also works in GovCloud/China partitions.
data "aws_partition" "current" {}

# -----------------------------------------------------------------------------
# Shared locals
# -----------------------------------------------------------------------------
locals {
  # Convenience aliases for the frequently-referenced caller/region/partition
  # values, so other files can write local.account_id instead of the longer
  # data-source path.
  account_id = data.aws_caller_identity.current.account_id
  region     = data.aws_region.current.name
  partition  = data.aws_partition.current.partition

  # Canonical resource-name prefix, e.g. "hms-production". Combined with a
  # per-resource suffix (e.g. "-vpc", "-eks") to name resources consistently
  # across the module.
  name_prefix = "${var.project_name}-${var.environment}"

  # The exact list of Availability Zones (length var.az_count) that vpc.tf,
  # eks.tf, rds.tf, and elasticache.tf use for multi-AZ placement. Slicing the
  # provider-reported AZ list keeps the module portable across regions that
  # expose differing numbers of AZs. var.az_count is validated (>= 2) in
  # variables.tf to guarantee genuine multi-AZ high availability.
  azs = slice(data.aws_availability_zones.available.names, 0, var.az_count)

  # Common tag set applied to every taggable resource in the module. This map is
  # referenced by the `default_tags` block of the aws provider in providers.tf
  # (so every resource is tagged automatically) AND is available for explicit
  # `tags = local.common_tags` merges where a resource needs extra tags. merge()
  # layers the caller-supplied var.tags LAST so they can override or extend the
  # baseline. The result is a map(string), exactly what default_tags expects.
  common_tags = merge(
    {
      Project     = var.project_name
      Environment = var.environment
      Application = "hospital-management-system"
      ManagedBy   = "terraform"
    },
    var.tags,
  )

  # Deterministic, globally-unique, DNS-compliant name for the S3 bucket that
  # stores patient identification-document uploads.
  #
  # It is defined HERE (not in s3.tf) on purpose: both s3.tf (which creates the
  # bucket) and iam.tf (which builds the bucket ARN for the access policy) need
  # this value. Deriving it from a local - rather than from the created bucket's
  # attribute - lets iam.tf construct the ARN WITHOUT depending on s3.tf, which
  # would otherwise create a circular file dependency.
  #
  # The name is fully deterministic (NO random_* suffix): appending the 12-digit
  # AWS account id makes it globally unique while staying stable across plans.
  # With the defaults it resolves to "hms-production-patient-documents-<acct>"
  # (~45 chars), well within S3's 63-character limit. lower() guards DNS
  # compliance if project_name/environment ever contain uppercase. An explicit
  # var.s3_bucket_name_override, when set, is honored verbatim.
  s3_bucket_name = var.s3_bucket_name_override != "" ? var.s3_bucket_name_override : lower("${local.name_prefix}-patient-documents-${local.account_id}")
}
