import * as pulumi from "@pulumi/pulumi";

import type { CloudVmConfig } from "./config.js";

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

export function renderCloudInit(cfg: CloudVmConfig): pulumi.Output<string> {
  const rootPassword = (cfg.rootPassword ?? pulumi.output("")).apply(shellQuote);
  const externalUrl = `https://${cfg.hostname}.${cfg.domainName}`;
  const tags = cfg.tags.join(",");

  return pulumi.interpolate`#cloud-config
package_update: true
package_upgrade: true
packages:
  - ca-certificates
  - caddy
  - curl
  - docker.io
  - jq

write_files:
  - path: /etc/caddy/Caddyfile
    permissions: "0644"
    content: |
      ${cfg.hostname}.${cfg.domainName} {
        encode gzip
        reverse_proxy 127.0.0.1:8929
      }
  - path: /usr/local/sbin/oa-gitlab-start
    permissions: "0755"
    content: |
      #!/usr/bin/env bash
      set -euo pipefail

      export GITLAB_EXTERNAL_URL=${shellQuote(externalUrl)}
      export GITLAB_SSH_PORT=${cfg.gitlabSshPort}
      export GITLAB_IMAGE_TAG=${shellQuote(cfg.gitlabImageTag)}
      export RUNNER_IMAGE_TAG=${shellQuote(cfg.runnerImageTag)}
      export ENABLE_RUNNER=${cfg.enableRunner ? "true" : "false"}
      export GITLAB_BACKUP_KEEP_TIME=${cfg.backupRetentionSeconds}
      export GITLAB_ROOT_PASSWORD=${rootPassword}
      export GITLAB_VOLUME_DEVICE=/dev/disk/by-id/scsi-0DO_Volume_${cfg.dataVolumeName}

      for attempt in {1..30}; do
        if [[ -e "$GITLAB_VOLUME_DEVICE" ]]; then
          mountpoint -q /mnt/gitlab || mount "$GITLAB_VOLUME_DEVICE" /mnt/gitlab
          break
        fi
        sleep 2
      done
      mountpoint -q /mnt/gitlab

      mkdir -p /mnt/gitlab/{config,logs,data,runner-config}
      chmod 700 /mnt/gitlab/config /mnt/gitlab/data

      docker network inspect gitlab-net >/dev/null 2>&1 || docker network create gitlab-net
      docker pull "gitlab/gitlab-ce:$GITLAB_IMAGE_TAG"

      if ! docker inspect gitlab >/dev/null 2>&1; then
        envs=(
          --env "GITLAB_OMNIBUS_CONFIG=external_url '$GITLAB_EXTERNAL_URL'
      gitlab_rails['gitlab_shell_ssh_port'] = $GITLAB_SSH_PORT
      gitlab_rails['backup_keep_time'] = $GITLAB_BACKUP_KEEP_TIME
      nginx['listen_port'] = 80
      nginx['listen_https'] = false"
        )
        if [[ -n "$GITLAB_ROOT_PASSWORD" ]]; then
          envs+=(--env "GITLAB_ROOT_PASSWORD=$GITLAB_ROOT_PASSWORD")
        fi

        docker run --detach \\
          --name gitlab \\
          --hostname ${cfg.hostname}.${cfg.domainName} \\
          --restart unless-stopped \\
          --shm-size 256m \\
          --cap-add SYS_PTRACE \\
          --network gitlab-net \\
          --publish 127.0.0.1:8929:80 \\
          --publish 0.0.0.0:$GITLAB_SSH_PORT:22 \\
          --volume /mnt/gitlab/config:/etc/gitlab \\
          --volume /mnt/gitlab/logs:/var/log/gitlab \\
          --volume /mnt/gitlab/data:/var/opt/gitlab \\
          "\${envs[@]}" \\
          "gitlab/gitlab-ce:$GITLAB_IMAGE_TAG"
      else
        docker start gitlab
      fi

      if [[ "$ENABLE_RUNNER" == "true" ]]; then
        docker pull "gitlab/gitlab-runner:$RUNNER_IMAGE_TAG"
        if ! docker inspect gitlab-runner >/dev/null 2>&1; then
          docker run --detach \\
            --name gitlab-runner \\
            --restart unless-stopped \\
            --network gitlab-net \\
            --volume /mnt/gitlab/runner-config:/etc/gitlab-runner \\
            --volume /var/run/docker.sock:/var/run/docker.sock \\
            "gitlab/gitlab-runner:$RUNNER_IMAGE_TAG"
        else
          docker start gitlab-runner
        fi
      fi
  - path: /usr/local/sbin/oa-gitlab-backup
    permissions: "0755"
    content: |
      #!/usr/bin/env bash
      set -euo pipefail
      docker exec gitlab gitlab-backup create
  - path: /etc/cron.d/oa-gitlab-backup
    permissions: "0644"
    content: |
      SHELL=/bin/bash
      PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
      17 3 * * * root /usr/local/sbin/oa-gitlab-backup >>/var/log/oa-gitlab-backup.log 2>&1

bootcmd:
  - mkdir -p /mnt/gitlab
  - if [ -e /dev/disk/by-id/scsi-0DO_Volume_${cfg.dataVolumeName} ]; then mountpoint -q /mnt/gitlab || mount /dev/disk/by-id/scsi-0DO_Volume_${cfg.dataVolumeName} /mnt/gitlab; fi

runcmd:
  - systemctl enable --now docker
  - systemctl enable --now caddy
  - /usr/local/sbin/oa-gitlab-start
  - systemctl reload caddy

final_message: "oa-sdk GitLab cloud VM bootstrap complete (${tags})"
`;
}
