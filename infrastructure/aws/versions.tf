# HMS AWS IaC — Terraform & provider version constraints
#
# Pins the Terraform CLI version and every required provider for the HMS AWS
# Infrastructure-as-Code root module so that plans and applies are fully
# reproducible across engineers and CI. This file is deliberately minimal: it
# declares ONLY the `terraform {}` version block — no resources, no provider
# configuration (that lives in providers.tf), and no backend configuration
# (that lives, commented, in backend.tf).
#
# Grounded in Hospital_Management_Documentation_Package/
# 03_Hospital_Management_Technical_Architecture.pdf (Cloud Platform = AWS).

terraform {
  # Terraform CLI 1.5.0+ unlocks modern language features (e.g. `import` and
  # `check` blocks) and matches the floor supported by the pinned providers.
  required_version = ">= 1.5.0"

  required_providers {
    # Primary provider — used by every resource file in this module
    # (vpc.tf, eks.tf, rds.tf, elasticache.tf, s3.tf, iam.tf, secrets.tf).
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }

    # Generates sensitive values managed in Terraform state:
    #   - rds.tf         -> random_password for the PostgreSQL master password
    #   - elasticache.tf -> random_password for the Redis AUTH token
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }

    # eks.tf uses data "tls_certificate" to fetch the EKS OIDC issuer thumbprint
    # that backs the IAM OIDC provider enabling IRSA (IAM Roles for Service
    # Accounts).
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }

  # Intentionally NOT declared here:
  #   * backend {}        -> defined (commented) in backend.tf, keeping a single
  #                          `terraform` backend declaration for the module.
  #   * kubernetes / helm -> this root module provisions AWS infrastructure only.
  #                          In-cluster component installation (e.g. the AWS Load
  #                          Balancer Controller Helm chart) is owned by the
  #                          ../kubernetes/ layer, which configures those
  #                          providers against the EKS cluster this module emits.
}
