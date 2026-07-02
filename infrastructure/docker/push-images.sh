#!/usr/bin/env bash
#
# push-images.sh — Push ALL deployable Hospital Management System (HMS) container
# images (10 backend services + the API gateway + the frontend) to a container
# registry (e.g. Amazon ECR). Companion to build-images.sh.
#
# DevOps strategy: "Docker image creation" / "Automated build and deployment".
# Normally invoked by CI (../../.github/) after build-images.sh.
#
# The images pushed are exactly those tagged by build-images.sh:
#   ${IMAGE_PREFIX}/<service>:${IMAGE_TAG}
# so run build-images.sh with the SAME IMAGE_PREFIX / IMAGE_TAG first.
#
# Usage:
#   IMAGE_PREFIX=<registry>/hms IMAGE_TAG=v1.2.3 ./push-images.sh
#   ./push-images.sh auth-service frontend        # push only the named images
#
# Configuration (environment variables):
#   IMAGE_PREFIX   Image name prefix = "<registry>/<namespace>" (MUST include the
#                  registry host to be pushable, e.g.
#                  123456789012.dkr.ecr.us-east-1.amazonaws.com/hms). Default: "hms".
#   IMAGE_TAG      Tag to push. Default: "latest".
#   DOCKER         Docker CLI. Default: "docker".
#   ECR_LOGIN      If "true", authenticate to Amazon ECR before pushing using the
#                  AWS CLI (aws ecr get-login-password). Default: "false".
#   AWS_REGION     Region for ECR login (when ECR_LOGIN=true). Default: "us-east-1".
#   ECR_REGISTRY   ECR registry host to log in to. Default: the host portion of
#                  IMAGE_PREFIX (text before the first "/").

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

IMAGE_PREFIX="${IMAGE_PREFIX:-hms}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
DOCKER="${DOCKER:-docker}"
ECR_LOGIN="${ECR_LOGIN:-false}"
AWS_REGION="${AWS_REGION:-us-east-1}"

BACKEND_SERVICES=(
  api-gateway
  auth-service
  patient-service
  appointment-service
  emr-service
  billing-service
  pharmacy-service
  laboratory-service
  inventory-service
  reports-service
)

log()  { printf '\033[1;34m[push]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[push:warn]\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31m[push:error]\033[0m %s\n' "$*" >&2; exit 1; }

image_ref() { printf '%s/%s:%s' "${IMAGE_PREFIX}" "$1" "${IMAGE_TAG}"; }

ecr_login() {
  # Registry host = explicit ECR_REGISTRY, else the part of IMAGE_PREFIX before "/".
  local registry="${ECR_REGISTRY:-${IMAGE_PREFIX%%/*}}"
  [ -n "${registry}" ] || fail "Cannot determine ECR registry host from IMAGE_PREFIX='${IMAGE_PREFIX}'."
  command -v aws >/dev/null 2>&1 || fail "ECR_LOGIN=true but the 'aws' CLI is not on PATH."
  log "Logging in to ECR registry ${registry} (region ${AWS_REGION})"
  aws ecr get-login-password --region "${AWS_REGION}" \
    | "${DOCKER}" login --username AWS --password-stdin "${registry}"
}

push_one() {
  local svc="$1"
  local ref
  ref="$(image_ref "${svc}")"
  log "Pushing ${ref}"
  "${DOCKER}" push "${ref}"
}

main() {
  command -v "${DOCKER}" >/dev/null 2>&1 || fail "'${DOCKER}' CLI not found on PATH."

  if [ "${IMAGE_PREFIX}" = "hms" ]; then
    warn "IMAGE_PREFIX='hms' has no registry host — pushes will fail. Set IMAGE_PREFIX=<registry>/<namespace>."
  fi

  if [ "${ECR_LOGIN}" = "true" ]; then
    ecr_login
  fi

  local targets=()
  if [ "$#" -gt 0 ]; then
    targets=("$@")
  else
    targets=("${BACKEND_SERVICES[@]}" frontend)
  fi

  log "Image prefix: ${IMAGE_PREFIX}"
  log "Image tag:    ${IMAGE_TAG}"
  log "Targets:      ${targets[*]}"

  local svc
  for svc in "${targets[@]}"; do
    push_one "${svc}"
  done

  log "Done. Pushed ${#targets[@]} image(s) to ${IMAGE_PREFIX%%/*}."
}

main "$@"
