# `infra-gitlab` Operations

Runbook for the local GitLab CE + Runner stack provisioned by this package. Captures procedures and quirks discovered while operating the preset; complements the per-resource reference in [README.md](./README.md).

## Bring-up sequence (verified)

```bash
cd packages/infra-gitlab
pnpm install
pnpm login:local                                # Pulumi local backend
PULUMI_CONFIG_PASSPHRASE=<random> pnpm stack:init
echo "PULUMI_CONFIG_PASSPHRASE=<random>" > .env # gitignored, mode 600
chmod 600 .env

PULUMI_CONFIG_PASSPHRASE=<random> \
  pulumi config set --secret rootPassword '<gitlab-root-password>'

PULUMI_CONFIG_PASSPHRASE=<random> pnpm up       # ~3-5 min on a warm cache
```

Expected `pulumi up` outputs:

```
gitlabUrl            = "http://localhost:8929"
gitlabContainerName  = "gitlab"
gitlabSshPort        = 2289
runnerContainerName  = "gitlab-runner"
networkName          = "gitlab-net"
```

## Readiness — `/-/health` is **not** a host-side signal

Symptom observed during initial bring-up: `curl http://localhost:8929/-/health` from the host returns **HTTP 404** indefinitely even though the container reports `healthy` and the Rails app is fully up.

Root cause: GitLab's `/-/health`, `/-/readiness`, `/-/liveness` and `/-/metrics` routes are gated by `gitlab_rails['monitoring_whitelist']`, which defaults to `127.0.0.1/8` only. From the host, Docker's port forwarding rewrites the source IP to the bridge gateway (e.g. `192.168.65.1`), which is not in the whitelist — GitLab serves a 404 to that source on those routes.

Use these probes instead:

| Probe | Meaning |
|-------|---------|
| `docker inspect -f '{{.State.Health.Status}}' gitlab` → `healthy` | Container's own healthcheck (runs from inside, hits localhost, sees 200) |
| `curl http://localhost:8929/users/sign_in` → `200` | Public login page; reliable Rails-up signal |
| `curl -o /dev/null -w '%{http_code}\n' http://localhost:8929/` → `302` | Root redirects to `/users/sign_in` once routing is up |

If host-side `/-/health` is required (e.g. for an external monitor), extend the Omnibus config in `src/gitlab.ts` to whitelist the Docker bridge gateway:

```ruby
gitlab_rails['monitoring_whitelist'] = ['127.0.0.0/8', '192.168.65.0/24', '172.16.0.0/12']
```

## Register the Runner

The Runner container starts unregistered because:

1. GitLab takes minutes to become ready after `pulumi up` returns.
2. Instance/group registration tokens are issued only after the operator visits the UI and creates a runner row.

After GitLab is healthy:

1. Sign in at `http://localhost:8929` as `root` (password from `pulumi config get rootPassword`).
2. **Admin Area → CI/CD → Runners → New instance runner** → set tags (`docker,linux`) → **Create runner**.
3. Copy the `glrt-...` token shown.
4. Run:

   ```bash
   GITLAB_RUNNER_TOKEN=glrt-xxxxxxxx \
     PULUMI_CONFIG_PASSPHRASE="$(grep PULUMI_CONFIG_PASSPHRASE .env | cut -d= -f2-)" \
     pnpm register:runner
   ```

5. Verify:

   ```bash
   docker exec gitlab-runner gitlab-runner list
   ```

The Runner uses the **internal** URL `http://gitlab/` on the shared Docker network (`gitlab-net`) so it does not depend on host port forwarding being symmetric.

### Auto-register (GitLab 16.0+ auth-token model)

If you have a personal access token with `api` scope, you can skip steps 1–3 (no UI click-through):

```bash
GITLAB_BASE_URL=http://localhost:8929 \
GITLAB_TOKEN=glpat-xxxx \
  pnpm register:runner:auto
```

The script `POST /api/v4/user/runners` with the appropriate `runner_type` (default `instance_type`), captures the `glrt-...` auth token from the response, then runs `gitlab-runner register --non-interactive` inside the container with only the executor-side flags (description / tag-list / locked are server-side properties set on the API call). Override defaults via `RUNNER_DESCRIPTION`, `RUNNER_TAGS`, `RUNNER_KIND`, `RUNNER_SCOPE_ID`, `RUNNER_EXECUTOR`, `RUNNER_DOCKER_IMAGE`.

### Pause / resume

For long-lived dev instances, prefer pausing over destroying — the volumes and therefore GitLab state survive. The package exposes shortcuts:

```bash
pnpm pause   # = docker stop gitlab gitlab-runner
pnpm resume  # = docker start gitlab gitlab-runner
```

`pnpm down` / `pulumi destroy` is destructive (volumes get removed), so use it only when you actually want to start fresh.

### Host-side `/-/health` opt-in

If you need an external monitor (Prometheus blackbox, uptime checker) to hit `/-/health` from the host, set:

```bash
PULUMI_CONFIG_PASSPHRASE=… pulumi config set enableExternalHealthProbe true
PULUMI_CONFIG_PASSPHRASE=… pnpm up   # rolls the gitlab container with the wider whitelist
```

This widens `gitlab_rails['monitoring_whitelist']` to the Docker bridge IP ranges (`172.16.0.0/12`, `192.168.0.0/16`, `10.0.0.0/8`) so the host-rewritten source IP passes the check. Default off — see "Readiness — `/-/health` is **not** a host-side signal" above for the rationale.

## Credentials & secrets

| Secret | Stored in | How to retrieve |
|--------|-----------|-----------------|
| `PULUMI_CONFIG_PASSPHRASE` | `packages/infra-gitlab/.env` (gitignored, mode 600) **and** the operator's password manager | `cat packages/infra-gitlab/.env` |
| GitLab `root` password | Pulumi config (encrypted by passphrase) | `PULUMI_CONFIG_PASSPHRASE=… pulumi config get rootPassword` |
| GitLab Runner token | GitLab DB; never persisted in this repo | Re-issue from Admin Area when needed |

The passphrase is **not recoverable** if lost — it is the root of the local secrets manager. Losing it requires `pulumi stack rm` and recreating the stack from scratch.

## Tear-down semantics

`pnpm down` (= `pulumi destroy`) removes:

- containers (`gitlab`, `gitlab-runner`)
- volumes (`gitlab-config`, `gitlab-logs`, `gitlab-data`, `gitlab-runner-config`)
- network (`gitlab-net`)

Volume removal is **destructive** — all GitLab state (repos, users, CI history) is wiped. For a long-lived dev instance, prefer `docker stop gitlab gitlab-runner` instead of `pulumi destroy`; bring back with `docker start gitlab gitlab-runner`.

After `pulumi destroy` the stack itself still exists (config + history). Two options:

| Goal | Command |
|------|---------|
| Re-create with the **same** rootPassword and config | `pnpm up` (config and secrets are preserved) |
| Drop the stack entirely and start fresh | `pulumi stack rm dev --yes` then `pnpm stack:init` and re-set `rootPassword` |

## K3s operations

The K3s variant is selected with `infra-gitlab:target=k3s`. It keeps the Omnibus layout from the Docker preset but maps persistence to PVCs and HTTP access to Kubernetes Ingress.

Expected resources in the `gitlab` namespace:

| Resource | Purpose |
|----------|---------|
| `deployment/gitlab` | Single GitLab Omnibus pod |
| `pvc/gitlab-config` | `/etc/gitlab` |
| `pvc/gitlab-logs` | `/var/log/gitlab` |
| `pvc/gitlab-data` | `/var/opt/gitlab` |
| `service/gitlab` | Internal HTTP endpoint |
| `service/gitlab-ssh` | Git-over-SSH endpoint, NodePort by default |
| `ingress/gitlab` | Browser-facing HTTPS route |
| `deployment/gitlab-runner` | Optional unregistered runner pod |

Bring-up:

```bash
pulumi config set target k3s
pulumi config set gitlabHostname gitlab.127.0.0.1.nip.io
pulumi config set --secret rootPassword '<gitlab-root-password>'
pnpm up:k3s
```

If cert-manager is already installed but no ClusterIssuer exists, let this stack create the staging issuer:

```bash
pulumi config set k3sCreateCertManagerIssuer true
pulumi config set k3sLetsEncryptEmail ops@example.com
pnpm up:k3s
```

Readiness:

```bash
kubectl -n gitlab rollout status deployment/gitlab --timeout=15m
kubectl -n gitlab get ingress gitlab
curl -k -sS -o /dev/null -w '%{http_code}\n' https://gitlab.127.0.0.1.nip.io/users/sign_in
```

Runner registration:

```bash
GITLAB_RUNNER_TOKEN=glrt-xxxxxxxx pnpm register:runner:k3s
kubectl -n gitlab exec deploy/gitlab-runner -- gitlab-runner list
```

The helper registers the runner against the in-cluster URL `http://gitlab/` and uses the Kubernetes executor with the `gitlab-runner` service account.

PVC backup:

- If the cluster has a CSI snapshot controller, snapshot `gitlab-config`, `gitlab-logs`, and `gitlab-data` together while the deployment is scaled down or GitLab is in a maintenance window.
- For a portable local backup, scale down and archive the PVC contents with a temporary pod mounted to each claim.

```bash
kubectl -n gitlab scale deployment/gitlab --replicas=0
kubectl -n gitlab rollout status deployment/gitlab --timeout=5m
# run the cluster's snapshot/export procedure for gitlab-config, gitlab-logs, gitlab-data
kubectl -n gitlab scale deployment/gitlab --replicas=1
```

Destroying with `pnpm down:k3s` removes the PVCs unless the cluster's StorageClass retention policy preserves backing volumes. Treat it as destructive.

### Recovering from state drift

Symptom: `pulumi destroy` fails with `Error stopping container <id>: No such container: <id>` because something outside Pulumi (manual `docker rm`, `docker compose down`, Docker Desktop reset) removed a container Pulumi still believes exists.

Fix: refresh state to reality, then retry destroy.

```bash
set -a && source .env && set +a
pulumi refresh --yes      # syncs Pulumi state with what Docker actually has
pulumi destroy --yes      # now succeeds against the surviving resources
```

`refresh` is non-destructive on its own — it only mutates Pulumi's state file, not Docker. Always run it before manually editing state with `pulumi state delete`.

## Known caveats

- **First-boot duration.** Omnibus runs chef-solo on first boot; budget 3–5 minutes between `pulumi up` returning and Rails answering on `/users/sign_in`.
- **RAM.** Allocate ≥ 4 GB to Docker. Lower than that and Sidekiq/Puma OOM during reconfigure.
- **`timeout(1)` on macOS.** Not present by default. Polling scripts that need a deadline must use a portable bash loop (`deadline=$(($(date +%s)+N))`) or install GNU coreutils (`brew install coreutils` → `gtimeout`).
- **Image size.** First `pulumi up` pulls `gitlab/gitlab-ce:latest` (~1.5 GB compressed). Subsequent `up`s reuse the local layer cache.

## Phase 3 cloud VM operations

The DigitalOcean VM preset lives in `packages/infra-gitlab/cloud-vm` and uses its own Pulumi project name, stack, and state. The existing local Docker stack remains `packages/infra-gitlab/Pulumi.yaml`.

### Bring-up

```bash
cd packages/infra-gitlab
pulumi -C cloud-vm login --local
pnpm stack:init:cloud-vm
pulumi -C cloud-vm config set domainName example.com
pulumi -C cloud-vm config set --path 'sshKeys[0]' '<do-ssh-key-id-or-fingerprint>'
pulumi -C cloud-vm config set --secret rootPassword '<initial-root-password>'
pnpm preview:cloud-vm
pnpm up:cloud-vm
```

Assumptions:

- `DIGITALOCEAN_TOKEN` is present in the shell environment when running `preview` / `up`.
- `domainName` already exists as a DigitalOcean DNS zone and the registrar delegates to DigitalOcean nameservers.
- `sshKeys` contains DigitalOcean SSH key IDs or fingerprints. Pulumi's DigitalOcean provider cannot add SSH keys to an existing Droplet without replacing it.
- Narrow `sshAllowedCidrs` to an operator IP range before production use. The default `0.0.0.0/0` is only a bootstrap convenience.

### Runtime layout

Cloud-init installs Docker, Caddy, and small helper scripts:

| Path | Purpose |
|------|---------|
| `/mnt/gitlab/config` | Mounted into `/etc/gitlab` |
| `/mnt/gitlab/logs` | Mounted into `/var/log/gitlab` |
| `/mnt/gitlab/data` | Mounted into `/var/opt/gitlab` |
| `/mnt/gitlab/runner-config` | Mounted into `/etc/gitlab-runner` |
| `/usr/local/sbin/oa-gitlab-start` | Idempotently creates/starts GitLab and Runner containers |
| `/usr/local/sbin/oa-gitlab-backup` | Runs `gitlab-backup create` inside the GitLab container |
| `/etc/cron.d/oa-gitlab-backup` | Daily 03:17 UTC backup cron |

Caddy listens on `80`/`443` and proxies HTTPS traffic to the GitLab container's host-local HTTP binding at `127.0.0.1:8929`. GitLab SSH is published separately on `gitlabSshPort` (default `2222`), leaving TCP/22 for VM administration.

### Readiness and troubleshooting

After `pulumi up`, wait for cloud-init and then GitLab Omnibus first boot:

```bash
ssh root@$(pulumi -C cloud-vm stack output dropletIp)
cloud-init status --wait
docker logs -f gitlab
curl -sS -o /dev/null -w '%{http_code}\n' https://$(pulumi -C cloud-vm stack output dnsRecordFqdn)/users/sign_in
```

Useful VM-side checks:

```bash
docker ps
docker inspect -f '{{.State.Health.Status}}' gitlab
journalctl -u caddy --no-pager -n 100
tail -n 100 /var/log/cloud-init-output.log
```

### Backups

Two backup layers are enabled by default:

- DigitalOcean Droplet backups (`backups=true`) for coarse VM recovery.
- Daily GitLab application backups via `/etc/cron.d/oa-gitlab-backup`, retained according to `backupRetentionSeconds` (default 7 days).

For a restore, rebuild the VM from Pulumi, attach or restore the block volume, then follow GitLab Omnibus backup restore procedure inside the container. The v1 preset does not put backup archives into Spaces because that would require putting an additional cloud API token on the VM.

### Sizing and monthly cost

The default `s-2vcpu-4gb` is the minimum practical GitLab Omnibus size for a small team or PoC. Prefer `s-4vcpu-8gb` when CI load, indexing, or multiple active users matter. Add the configured block volume size (`volumeSizeGb`, default 100 GiB) and optional Droplet backups to the base Droplet price when estimating monthly spend.

### Teardown

```bash
pnpm down:cloud-vm
```

This destroys the Droplet, firewall, DNS record, and block volume. The block volume is stateful GitLab data; export or snapshot it before destroy when the instance matters.

## Related skills

External to this repo, in `~/.claude/skills/`:

- `symphony-setup` — bootstrap an `openai/symphony` checkout against a Linear project.
- `symphony-workflow-author` — author/validate Symphony `WORKFLOW.md`.

These skills target Symphony's current SPEC (`tracker.kind: linear`). A GitLab tracker integration is **not part of this preset** — see the Roadmap in [README.md](./README.md) and the Symphony note for paths forward.
