# =============================================================================
# Hospital Management System (HMS) - Terraform Remote State Backend (TEMPLATE)
# -----------------------------------------------------------------------------
# File:    infrastructure/aws/backend.tf
# Module:  infrastructure/aws  (AWS environment for the HMS platform)
#
# Purpose:
#   Documents the RECOMMENDED remote-state backend for this Terraform module:
#   an Amazon S3 bucket for durable, versioned, encrypted state storage together
#   with an Amazon DynamoDB table for state locking and consistency. This aligns
#   with the HMS Technical Architecture (Cloud Platform: AWS; containerized,
#   horizontally scaled microservices) and the HMS QA/DevOps Strategy (automated
#   build & deployment; CI via Jenkins / GitHub Actions), where multiple humans
#   and pipelines must operate on the same infrastructure safely.
#
#   >>> The backend block in this file is intentionally COMMENTED OUT. <<<
#
#   Because no backend is configured, `terraform init` uses Terraform's DEFAULT
#   LOCAL backend (state kept in ./terraform.tfstate). The module therefore works
#   out of the box for a single operator WITHOUT requiring any pre-existing AWS
#   resources. Enable the remote backend (uncomment the block below, or supply the
#   values via `-backend-config` at init time) to share state across a team and
#   CI/CD once the prerequisite S3 bucket and DynamoDB table exist.
#
#   NEVER commit real state or real backend values. This file contains ONLY a
#   commented template with placeholders and instructions.
# =============================================================================

# -----------------------------------------------------------------------------
# WHY REMOTE STATE (S3 + DynamoDB) IS RECOMMENDED FOR TEAM / PRODUCTION USE
# -----------------------------------------------------------------------------
#   * Shared source of truth - every engineer and CI/CD runner reads and writes
#     the same state instead of a local terraform.tfstate on one machine.
#   * State locking - the DynamoDB table serializes concurrent runs so that two
#     simultaneous `terraform apply` operations (e.g. a pipeline and a human)
#     cannot corrupt state.
#   * Durability & recovery - S3 versioning retains historical state, allowing a
#     bad apply to be rolled back to a previous version.
#   * Encryption at rest - server-side encryption (SSE) protects the potentially
#     sensitive contents of state (see the SECURITY note near the bottom).

# -----------------------------------------------------------------------------
# ONE-TIME BOOTSTRAP (CHICKEN-AND-EGG) - CREATE THESE BEFORE ENABLING THE BLOCK
# -----------------------------------------------------------------------------
#   A backend cannot store its own state, so the S3 bucket and DynamoDB lock
#   table must ALREADY EXIST before you run `terraform init` with the S3 backend.
#   Create them ONCE, out of band, via a dedicated bootstrap configuration, the
#   AWS Console, or the AWS CLI. Replace <ACCOUNT_ID> with your AWS account id and
#   adjust the region to match this module's configured region. Example:
#
#     # 1) State bucket - globally unique name; versioned + encrypted; no public access.
#     aws s3api create-bucket \
#       --bucket hms-terraform-state-<ACCOUNT_ID> \
#       --region us-east-1
#     aws s3api put-bucket-versioning \
#       --bucket hms-terraform-state-<ACCOUNT_ID> \
#       --versioning-configuration Status=Enabled
#     aws s3api put-bucket-encryption \
#       --bucket hms-terraform-state-<ACCOUNT_ID> \
#       --server-side-encryption-configuration \
#         '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
#     aws s3api put-public-access-block \
#       --bucket hms-terraform-state-<ACCOUNT_ID> \
#       --public-access-block-configuration \
#         BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
#
#     # 2) Lock table - the primary (partition) key MUST be named "LockID" (String).
#     aws dynamodb create-table \
#       --table-name hms-terraform-locks \
#       --attribute-definitions AttributeName=LockID,AttributeType=S \
#       --key-schema AttributeName=LockID,KeyType=HASH \
#       --billing-mode PAY_PER_REQUEST \
#       --region us-east-1

# -----------------------------------------------------------------------------
# IMPORTANT CONSTRAINTS
# -----------------------------------------------------------------------------
#   * Backend blocks CANNOT use variables, locals, or interpolation. Terraform
#     evaluates the backend configuration very early - before var.*, local.*, or
#     expressions are available - so every value below must be a LITERAL, or be
#     supplied at init time via `-backend-config` (see the CI/CD section).
#   * A module may declare EXACTLY ONE backend. This file is the ONLY place a
#     backend should ever be defined for the infrastructure/aws module. Do NOT
#     add a second `backend` block anywhere else (for example, in versions.tf).

# ------------------------- REMOTE STATE BACKEND (S3) -------------------------
#   To enable: complete the bootstrap above, uncomment this block, then run
#   `terraform init`. Terraform will offer to migrate any existing local state
#   into the S3 bucket - answer "yes" to migrate.
#
# terraform {
#   backend "s3" {
#     bucket         = "hms-terraform-state-<ACCOUNT_ID>" # pre-created, versioned + encrypted S3 bucket (NO real value committed)
#     key            = "infrastructure/aws/terraform.tfstate"
#     region         = "us-east-1"
#     dynamodb_table = "hms-terraform-locks"              # pre-created DynamoDB table; primary key "LockID" (String)
#     encrypt        = true                               # encrypt Terraform state at rest (SSE)
#   }
# }

# -----------------------------------------------------------------------------
# CI / CD ALTERNATIVE - PARTIAL CONFIGURATION VIA `-backend-config`
# -----------------------------------------------------------------------------
#   Instead of hard-coding account-specific values in the block above, keep the
#   `backend "s3" {}` body minimal (or empty) and inject the values at init time.
#   This keeps environment-specific values out of version control and lets
#   Jenkins / GitHub Actions target different environments from the same code:
#
#     terraform init \
#       -backend-config="bucket=hms-terraform-state-<ACCOUNT_ID>" \
#       -backend-config="key=infrastructure/aws/terraform.tfstate" \
#       -backend-config="region=us-east-1" \
#       -backend-config="dynamodb_table=hms-terraform-locks" \
#       -backend-config="encrypt=true"
#
#   The same values may instead live in a git-ignored file (e.g. backend.hcl)
#   loaded with: `terraform init -backend-config=backend.hcl`.

# -----------------------------------------------------------------------------
# SECURITY: NEVER COMMIT TERRAFORM STATE
# -----------------------------------------------------------------------------
#   Terraform state can contain SENSITIVE values in plaintext. For HMS this
#   includes the generated RDS database password, connection strings, and other
#   secrets produced during `apply`. Committing state would leak these values and
#   violate the patient-data privacy requirements highlighted in the HMS
#   QA/DevOps strategy.
#
#   * Do NOT commit terraform.tfstate or terraform.tfstate.backup to git.
#   * Ensure the repository .gitignore ignores Terraform state and cache, e.g.:
#         *.tfstate
#         *.tfstate.*
#         .terraform/
#     (The `.terraform.lock.hcl` dependency lock file is an exception and SHOULD
#      normally be COMMITTED for reproducible provider versions - do not ignore it.)
#   * With remote state enabled, state lives in the encrypted, versioned S3 bucket
#     and is protected by the DynamoDB lock rather than sitting on a workstation.
# =============================================================================
