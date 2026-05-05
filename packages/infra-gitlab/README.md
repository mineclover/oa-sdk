# `@oa-sdk/infra-gitlab`

Pulumi preset that stands up a self-hosted **GitLab CE Omnibus** plus a **GitLab Runner** on the local Docker daemon. Phase 1 of the GitLab-based DevOps substrate that will eventually back Symphony orchestration.

> **Scope.** Single-host Docker deployment. No external Postgres/Redis/object-storage — GitLab Omnibus bundles those for small footprints. K3s and cloud-VM variants are deferred to later phases.

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
```

> **Volumes survive `pulumi destroy` only if you remove the stack output and re-run** — the default destroys named volumes too, which wipes GitLab state. For long-lived dev instances, pause the stack instead of destroying.

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

## Roadmap (future phases)

| Phase | Scope |
|-------|-------|
| 1 *(this)* | Local Docker — GitLab CE Omnibus + Runner |
| 2 | K3s variant using `gitlab/gitlab` Helm chart, ingress, cert-manager |
| 3 | Cloud VM (DigitalOcean / GCE / EC2) with Pulumi-managed VM + DNS |
| 4 | Symphony GitLab tracker integration (out of band — Symphony SPEC currently only supports `tracker.kind: linear`) |

## Symphony note

Symphony's current SPEC ([openai/symphony `SPEC.md` §5.3.1](https://github.com/openai/symphony/blob/main/SPEC.md#531-tracker-object)) only supports `tracker.kind: linear`. This preset prepares the GitLab-side infrastructure; bridging GitLab issues into Symphony requires either (a) a GitLab tracker adapter implemented against Symphony's extensible front-matter, (b) a GitLab→Linear-shaped proxy, or (c) bypassing Symphony for direct GitLab→Codex orchestration. That work is tracked separately and is **not part of this preset**.
