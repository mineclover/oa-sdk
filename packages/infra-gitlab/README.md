# `@oa-sdk/infra-gitlab`

Pulumi preset that stands up a self-hosted **GitLab CE Omnibus** plus a **GitLab Runner** on the local Docker daemon. Phase 1 of the GitLab-based DevOps substrate that will eventually back Symphony orchestration.

> **Scope.** Default path is single-host Docker deployment. No external Postgres/Redis/object-storage — GitLab Omnibus bundles those for small footprints. The K3s variant is selected with `target=k3s`; the Phase 3 cloud-VM path is a separate Pulumi project under [`cloud-vm/`](./cloud-vm/) so local Docker behavior stays unchanged.

## Topology

```
+---------------------- docker network: gitlab-net ----------------------+
|                                                                        |
|  +------------------+        +-------------------+                     |
|  |  gitlab          |        |  gitlab-runner    |                     |
|  |  gitlab-ce:tag   |<-------|  gitlab-runner:tg |  /var/run/docker.sock
|  |  /etc/gitlab     |  HTTP  |  /etc/gitlab-...  |  (host mount)       |
|  |  /var/log/gitlab |        +-------------------+                     |
|  |  /var/opt/gitlab |                                                  |
|  +--------+---------+                                                  |
+-----------|------------------------------------------------------------+
            | published: ${gitlabHttpPort} (HTTP), ${gitlabSshPort} (SSH)
            v
       host (browser / git)
```

## Requirements

- Docker daemon running locally (Docker Desktop on macOS is fine).
- ≥ 4 GB RAM available to Docker. GitLab Omnibus's first boot runs a chef-solo reconfigure that takes ~5 minutes.
- Pulumi CLI (`pulumi` ≥ 3.140) and Node.js ≥ 20.
- pnpm (project-wide).

## One-time setup

```bash
cd packages/infra-gitlab
pnpm install
pnpm login:local                 # Pulumi state in ~/.pulumi (no cloud account)
pnpm stack:init                  # creates the 'dev' stack
pulumi config set --secret rootPassword <your-initial-root-password>
```

You may also override defaults:

```bash
pulumi config set gitlabHttpPort 8929   # default
pulumi config set gitlabSshPort  2289   # default
pulumi config set gitlabHostname localhost
pulumi config set enableRunner   true
```

## Bring the stack up

```bash
pnpm preview                      # plan
pnpm up                           # apply
```

After `pulumi up` completes, the GitLab container is **booting** but not yet healthy. Watch progress:

```bash
docker logs -f gitlab
# or, the canonical readiness signal (see OPERATIONS.md for why /-/health is unsuitable from the host):
docker inspect -f '{{.State.Health.Status}}' gitlab     # waits for 'healthy'
curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:8929/users/sign_in   # 200 once Rails is ready
```

## Register the Runner

The Runner container is provisioned but **intentionally unregistered**. Registration depends on a token that GitLab issues only after it's healthy.

1. Open `http://localhost:8929` in your browser.
2. Sign in as `root` with the password you set in `rootPassword`.
3. Navigate to **Admin Area → CI/CD → Runners → New instance runner**.
4. Configure tags (e.g. `docker,linux`) and create the runner. GitLab returns a `glrt-...` token.
5. Run:

   ```bash
   GITLAB_RUNNER_TOKEN=glrt-xxxxxxxxxxxx pnpm register:runner
   ```

   Verify:

   ```bash
   docker exec gitlab-runner gitlab-runner list
   ```

The runner uses the **internal** URL `http://gitlab/` (shared Docker network) rather than the published `localhost:8929`, so it works even when host port forwarding is asymmetric.

## Tear down

```bash
pnpm down                         # destroys containers, volumes, network
pulumi stack rm dev --yes         # optional — also drops stack config/history
```

For long-lived dev instances **pause** instead of destroying — `pulumi destroy` removes the named volumes and wipes all GitLab state.

```bash
docker stop gitlab gitlab-runner   # pause
docker start gitlab gitlab-runner  # resume — state preserved
```

If `pulumi destroy` errors with `No such container: <id>` (Pulumi state drifted from Docker reality), see [OPERATIONS.md → Recovering from state drift](./OPERATIONS.md#recovering-from-state-drift).

## Stack outputs

| Output | Type | Purpose |
|--------|------|---------|
| `gitlabUrl` | `string` | Browser-facing URL (`http://${hostname}:${httpPort}`) |
| `gitlabContainerName` | `string` | Container name for `docker exec` / `docker logs` |
| `gitlabSshPort` | `number` | Host port for `git+ssh://git@host:port/...` |
| `runnerContainerName` | `string \| undefined` | Runner container name (when `enableRunner=true`) |
| `networkName` | `string` | Docker network name shared by the stack |

## Configuration reference

| Pulumi config key | Default | Description |
|-------------------|---------|-------------|
| `gitlabHostname` | `localhost` | External hostname rendered into `external_url` |
| `gitlabHttpPort` | `8929` | Host port for HTTP |
| `gitlabSshPort` | `2289` | Host port for git+ssh |
| `gitlabImageTag` | `latest` | `gitlab/gitlab-ce` image tag |
| `runnerImageTag` | `latest` | `gitlab/gitlab-runner` image tag |
| `enableRunner` | `true` | Whether to provision the Runner container |
| `rootPassword` *(secret)* | — | Initial root password injected via `GITLAB_ROOT_PASSWORD` |

## Phase 2 — K3s variant

The K3s path keeps the Phase 1 Omnibus mental model: one `gitlab/gitlab-ce` Deployment, three PVCs (`/etc/gitlab`, `/var/log/gitlab`, `/var/opt/gitlab`), a Traefik Ingress, and an optional unregistered `gitlab/gitlab-runner` Deployment using the Kubernetes executor.

Requirements:

- A reachable K3s-compatible cluster with a default `ReadWriteOnce` StorageClass.
- K3s Traefik Ingress enabled, or another IngressClass configured via `k3sIngressClassName`.
- cert-manager installed if you keep TLS enabled on the Ingress. The stack references a ClusterIssuer by default and can optionally create one after cert-manager CRDs exist.

Bring up:

```bash
cd packages/infra-gitlab
pnpm login:local
pnpm stack:init
pulumi config set target k3s
pulumi config set gitlabHostname gitlab.127.0.0.1.nip.io
pulumi config set --secret rootPassword <your-initial-root-password>
pnpm preview:k3s
pnpm up:k3s
```

If Pulumi should not use your ambient kubeconfig, set the kubeconfig contents as a secret:

```bash
pulumi config set --secret kubeconfig "$(cat ~/.kube/config)"
```

Register the K3s runner after GitLab is ready:

```bash
GITLAB_RUNNER_TOKEN=glrt-xxxxxxxxxxxx pnpm register:runner:k3s
```

K3s-specific config:

| Pulumi config key | Default | Description |
|-------------------|---------|-------------|
| `target` | `docker` | Set to `k3s` to use the Kubernetes variant |
| `kubeconfig` *(secret)* | ambient kubeconfig | Optional kubeconfig contents |
| `k3sNamespace` | `gitlab` | Namespace for GitLab and Runner resources |
| `k3sStorageClassName` | cluster default | StorageClass for PVCs |
| `k3sGitlabConfigStorageSize` | `2Gi` | `/etc/gitlab` PVC size |
| `k3sGitlabLogsStorageSize` | `5Gi` | `/var/log/gitlab` PVC size |
| `k3sGitlabDataStorageSize` | `20Gi` | `/var/opt/gitlab` PVC size |
| `k3sRunnerConfigStorageSize` | `1Gi` | `/etc/gitlab-runner` PVC size |
| `k3sIngressClassName` | `traefik` | IngressClass name |
| `k3sCertManagerClusterIssuer` | `letsencrypt-staging` | ClusterIssuer referenced by the Ingress |
| `k3sCreateCertManagerIssuer` | `false` | Create the ClusterIssuer from this stack |
| `k3sLetsEncryptEmail` | — | Required when creating the ClusterIssuer |
| `k3sSshServiceType` | `NodePort` | Service type for Git over SSH |
| `k3sGitlabSshNodePort` | `32222` | Fixed NodePort for SSH |
| `k3sGitlabSshExternalPort` | `32222` | Port rendered into GitLab clone URLs |

## Phase 3 — DigitalOcean cloud VM

The cloud-VM preset is intentionally separate from the local Docker project:

```bash
cd packages/infra-gitlab
pnpm install
pulumi -C cloud-vm login --local
pnpm stack:init:cloud-vm
```

Minimum configuration:

```bash
pulumi -C cloud-vm config set domainName example.com
pulumi -C cloud-vm config set --path 'sshKeys[0]' '<digitalocean-ssh-key-id-or-fingerprint>'
pulumi -C cloud-vm config set --secret rootPassword '<initial-root-password>'
```

Recommended hardening before `up`:

```bash
pulumi -C cloud-vm config set --path 'sshAllowedCidrs[0]' '<your-public-ip>/32'
pulumi -C cloud-vm config set size s-4vcpu-8gb
```

Plan and apply:

```bash
pnpm preview:cloud-vm
pnpm up:cloud-vm
```

This creates a single DigitalOcean Droplet, a persistent block volume mounted at `/mnt/gitlab`, a firewall, and an `A` record for `<hostname>.<domainName>` in a DNS zone already delegated to DigitalOcean. Cloud-init installs Docker and Caddy, starts `gitlab/gitlab-ce`, optionally starts an unregistered `gitlab/gitlab-runner`, and leaves Caddy to issue HTTPS through Let's Encrypt.

Cloud stack outputs:

| Output | Type | Purpose |
|--------|------|---------|
| `gitlabUrl` | `string` | Browser-facing HTTPS URL |
| `gitlabSshUrl` | `string` | Git-over-SSH URL prefix using `gitlabSshPort` |
| `dropletId` | `string` | DigitalOcean Droplet ID |
| `dropletIp` | `string` | Public IPv4 address |
| `volumeId` | `string` | Persistent block volume ID |
| `dnsRecordFqdn` | `string` | Managed DNS record FQDN |

## Roadmap (future phases)

| Phase | Scope | Status |
|-------|-------|--------|
| 1 *(this)* | Local Docker — GitLab CE Omnibus + Runner | ✅ |
| 2 | K3s variant — Omnibus image as Deployment + Ingress + cert-manager (full Helm chart split deferred) | ✅ conservative v1 via `target=k3s` |
| 3 | Cloud VM — DigitalOcean Droplet + cloud-init + Caddy TLS | ✅ conservative v1 in [`cloud-vm/`](./cloud-vm/) |
| 4 | ~~Symphony GitLab tracker integration~~ | ✅ resolved — see [`@oa-sdk/orchestrator-gitlab`](../orchestrator-gitlab/) (option (c): native reimplementation of Symphony's loop for GitLab) |

## Symphony note

Symphony's current SPEC ([openai/symphony `SPEC.md` §5.3.1](https://github.com/openai/symphony/blob/main/SPEC.md#531-tracker-object)) only supports `tracker.kind: linear`. This preset prepares the GitLab-side infrastructure. The orchestration layer that consumes GitLab issues lives in [`@oa-sdk/orchestrator-gitlab`](../orchestrator-gitlab/), which treats Symphony's SPEC as a design reference rather than a code dependency.
