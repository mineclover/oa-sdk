#!/usr/bin/env bash
# Register the GitLab Runner container against the GitLab CE instance.
#
# Prerequisites
#   * `pulumi up` has finished and the GitLab container is reporting healthy.
#   * You have an authentication token for the runner. Obtain one from GitLab:
#       Admin Area -> CI/CD -> Runners -> "New instance runner"
#     and copy the resulting `glrt-...` token.
#
# Usage
#   GITLAB_RUNNER_TOKEN=glrt-xxxxxx bash scripts/register-runner.sh
#
# Optional environment variables
#   GITLAB_RUNNER_DESCRIPTION  (default: "infra-gitlab preset runner")
#   GITLAB_RUNNER_TAGS         (default: "docker,linux")
#   GITLAB_RUNNER_EXECUTOR     (default: "docker")
#   GITLAB_RUNNER_IMAGE        (default: "alpine:3.20")
#
# Notes
#   * The runner is registered against the in-cluster URL `http://gitlab/`,
#     which resolves on the shared `gitlab-net` Docker network. This avoids
#     hairpin NAT problems when the runner tries to reach GitLab via the
#     externally published port.
#   * Re-running the script with the same token re-registers a new runner
#     row in GitLab; clean up old ones in the GitLab Admin Area.

set -euo pipefail

: "${GITLAB_RUNNER_TOKEN:?GITLAB_RUNNER_TOKEN must be set (glrt-... from GitLab Admin Area)}"

RUNNER_CONTAINER="${RUNNER_CONTAINER:-gitlab-runner}"
GITLAB_URL_INTERNAL="${GITLAB_URL_INTERNAL:-http://gitlab/}"
DESCRIPTION="${GITLAB_RUNNER_DESCRIPTION:-infra-gitlab preset runner}"
TAGS="${GITLAB_RUNNER_TAGS:-docker,linux}"
EXECUTOR="${GITLAB_RUNNER_EXECUTOR:-docker}"
IMAGE="${GITLAB_RUNNER_IMAGE:-alpine:3.20}"

if ! docker inspect "${RUNNER_CONTAINER}" >/dev/null 2>&1; then
  echo "error: runner container '${RUNNER_CONTAINER}' not found. Did 'pulumi up' succeed?" >&2
  exit 1
fi

docker exec "${RUNNER_CONTAINER}" gitlab-runner register \
  --non-interactive \
  --url "${GITLAB_URL_INTERNAL}" \
  --token "${GITLAB_RUNNER_TOKEN}" \
  --description "${DESCRIPTION}" \
  --tag-list "${TAGS}" \
  --executor "${EXECUTOR}" \
  --docker-image "${IMAGE}" \
  --docker-volumes /var/run/docker.sock:/var/run/docker.sock \
  --docker-network-mode "$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' "${RUNNER_CONTAINER}")"

echo "runner registered. verify with:"
echo "  docker exec ${RUNNER_CONTAINER} gitlab-runner list"
