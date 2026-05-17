#!/usr/bin/env bash
set -euo pipefail

# Registers the K3s runner Deployment created by `target=k3s`.
#
# Required:
#   GITLAB_RUNNER_TOKEN        glrt-... runner auth token from GitLab
#
# Optional:
#   K3S_NAMESPACE             default: gitlab
#   RUNNER_POD_SELECTOR       default: app=gitlab-runner
#   RUNNER_DESCRIPTION        default: infra-gitlab k3s runner
#   RUNNER_TAGS               default: k3s,kubernetes,linux
#   RUNNER_EXECUTOR           default: kubernetes
#   RUNNER_KUBERNETES_IMAGE   default: alpine:latest
#   GITLAB_INTERNAL_URL       default: http://gitlab/

if [[ -z "${GITLAB_RUNNER_TOKEN:-}" ]]; then
  echo "GITLAB_RUNNER_TOKEN is required" >&2
  exit 1
fi

NAMESPACE="${K3S_NAMESPACE:-gitlab}"
POD_SELECTOR="${RUNNER_POD_SELECTOR:-app=gitlab-runner}"
DESCRIPTION="${RUNNER_DESCRIPTION:-infra-gitlab k3s runner}"
TAGS="${RUNNER_TAGS:-k3s,kubernetes,linux}"
EXECUTOR="${RUNNER_EXECUTOR:-kubernetes}"
KUBERNETES_IMAGE="${RUNNER_KUBERNETES_IMAGE:-alpine:latest}"
GITLAB_URL="${GITLAB_INTERNAL_URL:-http://gitlab/}"

POD_NAME="$(kubectl -n "${NAMESPACE}" get pod -l "${POD_SELECTOR}" -o jsonpath='{.items[0].metadata.name}')"

if [[ -z "${POD_NAME}" ]]; then
  echo "No runner pod found in namespace '${NAMESPACE}' with selector '${POD_SELECTOR}'" >&2
  exit 1
fi

kubectl -n "${NAMESPACE}" exec "${POD_NAME}" -- gitlab-runner register \
  --non-interactive \
  --url "${GITLAB_URL}" \
  --token "${GITLAB_RUNNER_TOKEN}" \
  --executor "${EXECUTOR}" \
  --description "${DESCRIPTION}" \
  --tag-list "${TAGS}" \
  --kubernetes-namespace "${NAMESPACE}" \
  --kubernetes-service-account "gitlab-runner" \
  --kubernetes-image "${KUBERNETES_IMAGE}"

kubectl -n "${NAMESPACE}" exec "${POD_NAME}" -- gitlab-runner list
