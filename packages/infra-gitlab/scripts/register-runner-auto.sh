#!/usr/bin/env bash
# Auto-register the GitLab Runner end-to-end.
#
# Unlike `register-runner.sh` which expects you to issue the token in the UI
# and pass it on the command line, this script:
#   1. Creates a runner via GitLab REST `POST /api/v4/user/runners`
#      (or `/api/v4/runners` for instance/group runners).
#   2. Captures the resulting `glrt-...` token from the API response.
#   3. Runs `gitlab-runner register --non-interactive` inside the runner
#      container with that token.
#
# Required environment
#   GITLAB_BASE_URL    e.g. http://localhost:8929
#   GITLAB_TOKEN       Personal access token with `api` scope (or admin
#                      personal access token for instance runners).
#
# Optional environment
#   RUNNER_KIND        instance | group | project (default: instance)
#                      For `group`/`project` you must also set RUNNER_SCOPE_ID.
#   RUNNER_SCOPE_ID    Numeric group id or project id when KIND != instance.
#   RUNNER_DESCRIPTION (default: "infra-gitlab preset auto-registered")
#   RUNNER_TAGS        (default: "docker,linux")
#   RUNNER_LOCKED      true | false (default: false)
#   RUNNER_RUN_UNTAGGED true | false (default: true)
#   RUNNER_EXECUTOR    (default: docker)
#   RUNNER_DOCKER_IMAGE (default: alpine:3.20)
#   RUNNER_CONTAINER   (default: gitlab-runner)
#   GITLAB_URL_INTERNAL (default: http://gitlab/) — URL the runner uses to
#                      reach GitLab on the shared Docker network.
#
# Example
#   GITLAB_BASE_URL=http://localhost:8929 \
#   GITLAB_TOKEN=glpat-xxxx \
#     bash scripts/register-runner-auto.sh
#
# Notes
#   * `POST /api/v4/user/runners` is the modern API (GitLab 16.0+) and works
#     with a regular `api`-scoped token. It creates a runner owned by the
#     calling user. For instance-wide runners, set RUNNER_KIND=instance which
#     is the default and is what the user runners endpoint produces.
#   * Re-running creates a new runner row; clean up old ones in the GitLab
#     Admin Area before re-registering, or pass a different RUNNER_DESCRIPTION
#     to keep them sortable.

set -euo pipefail

: "${GITLAB_BASE_URL:?GITLAB_BASE_URL must be set, e.g. http://localhost:8929}"
: "${GITLAB_TOKEN:?GITLAB_TOKEN (api scope) must be set}"

RUNNER_KIND="${RUNNER_KIND:-instance}"
RUNNER_DESCRIPTION="${RUNNER_DESCRIPTION:-infra-gitlab preset auto-registered}"
RUNNER_TAGS="${RUNNER_TAGS:-docker,linux}"
RUNNER_LOCKED="${RUNNER_LOCKED:-false}"
RUNNER_RUN_UNTAGGED="${RUNNER_RUN_UNTAGGED:-true}"
RUNNER_EXECUTOR="${RUNNER_EXECUTOR:-docker}"
RUNNER_DOCKER_IMAGE="${RUNNER_DOCKER_IMAGE:-alpine:3.20}"
RUNNER_CONTAINER="${RUNNER_CONTAINER:-gitlab-runner}"
GITLAB_URL_INTERNAL="${GITLAB_URL_INTERNAL:-http://gitlab/}"

api_path="/api/v4/user/runners"
case "${RUNNER_KIND}" in
  instance)
    api_path="/api/v4/user/runners"
    ;;
  group|project)
    : "${RUNNER_SCOPE_ID:?RUNNER_SCOPE_ID required for kind=${RUNNER_KIND}}"
    api_path="/api/v4/user/runners"  # /user/runners covers all kinds via 'runner_type' field
    ;;
  *)
    echo "error: unknown RUNNER_KIND='${RUNNER_KIND}' (expected: instance|group|project)" >&2
    exit 1
  ;;
esac

# Validate boolean-like flags early so the request body stays valid JSON.
case "${RUNNER_LOCKED}" in
  true|false) ;;
  *)
    echo "error: RUNNER_LOCKED must be 'true' or 'false', got '${RUNNER_LOCKED}'" >&2
    exit 1
    ;;
esac

case "${RUNNER_RUN_UNTAGGED}" in
  true|false) ;;
  *)
    echo "error: RUNNER_RUN_UNTAGGED must be 'true' or 'false', got '${RUNNER_RUN_UNTAGGED}'" >&2
    exit 1
    ;;
esac

if [ "${RUNNER_KIND}" = "group" ] || [ "${RUNNER_KIND}" = "project" ]; then
  if ! printf '%s' "${RUNNER_SCOPE_ID}" | grep -Eq '^[0-9]+$'; then
    echo "error: RUNNER_SCOPE_ID must be a numeric ID for kind='${RUNNER_KIND}', got '${RUNNER_SCOPE_ID}'" >&2
    exit 1
  fi
fi

# Build JSON body safely without jq while properly escaping string values.
if ! command -v node >/dev/null 2>&1; then
  echo "error: node is required to build JSON payload safely" >&2
  exit 1
fi

body="$( \
  RUNNER_KIND="${RUNNER_KIND}" \
  RUNNER_DESCRIPTION="${RUNNER_DESCRIPTION}" \
  RUNNER_TAGS="${RUNNER_TAGS}" \
  RUNNER_LOCKED="${RUNNER_LOCKED}" \
  RUNNER_RUN_UNTAGGED="${RUNNER_RUN_UNTAGGED}" \
  RUNNER_SCOPE_ID="${RUNNER_SCOPE_ID:-}" \
  node - <<'NODE'
const payload = {
  runner_type: `${process.env.RUNNER_KIND}_type`,
  description: process.env.RUNNER_DESCRIPTION || "",
  tag_list: process.env.RUNNER_TAGS || "",
  locked: process.env.RUNNER_LOCKED === "true",
  run_untagged: process.env.RUNNER_RUN_UNTAGGED === "true",
};

const kind = process.env.RUNNER_KIND || "instance";
if (kind === "group") {
  payload.group_id = Number(process.env.RUNNER_SCOPE_ID);
}
if (kind === "project") {
  payload.project_id = Number(process.env.RUNNER_SCOPE_ID);
}

process.stdout.write(JSON.stringify(payload));
NODE
)"

echo "→ creating runner via ${GITLAB_BASE_URL}${api_path}"

response="$(curl -sS \
  -X POST \
  -H "PRIVATE-TOKEN: ${GITLAB_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "${body}" \
  "${GITLAB_BASE_URL}${api_path}")"

# Extract token field. We avoid jq for portability; the response body shape is
# a flat JSON object with "token" near the top.
token="$(printf '%s' "${response}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
if [ -z "${token}" ]; then
  echo "error: GitLab API did not return a token. Response was:" >&2
  echo "${response}" >&2
  exit 1
fi
echo "→ runner created; auth token captured (${token:0:8}…)"

if ! docker inspect "${RUNNER_CONTAINER}" >/dev/null 2>&1; then
  echo "error: runner container '${RUNNER_CONTAINER}' not found. Did 'pulumi up' succeed?" >&2
  exit 1
fi

network="$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' "${RUNNER_CONTAINER}")"

echo "→ registering runner inside container '${RUNNER_CONTAINER}' on network '${network}'"

# With the modern auth-token model (GitLab 16.0+), description/tags/locked
# /run_untagged are server-side properties already set when we POSTed the
# runner. The local `register` call only takes URL + token + executor config.
docker exec "${RUNNER_CONTAINER}" gitlab-runner register \
  --non-interactive \
  --url "${GITLAB_URL_INTERNAL}" \
  --token "${token}" \
  --executor "${RUNNER_EXECUTOR}" \
  --docker-image "${RUNNER_DOCKER_IMAGE}" \
  --docker-volumes /var/run/docker.sock:/var/run/docker.sock \
  --docker-network-mode "${network}"

echo "→ done. Verify with:"
echo "    docker exec ${RUNNER_CONTAINER} gitlab-runner list"
