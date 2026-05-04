import * as docker from "@pulumi/docker";
import * as pulumi from "@pulumi/pulumi";

import type { InfraConfig } from "./config.js";
import type { GitLabVolumes } from "./network.js";

export interface GitLabArgs {
  readonly cfg: InfraConfig;
  readonly network: docker.Network;
  readonly volumes: GitLabVolumes;
}

export interface GitLabService {
  readonly image: docker.RemoteImage;
  readonly container: docker.Container;
  readonly externalUrl: pulumi.Output<string>;
}

export function createGitLab(name: string, args: GitLabArgs): GitLabService {
  const { cfg, network, volumes } = args;

  const image = new docker.RemoteImage(`${name}-image`, {
    name: pulumi.interpolate`gitlab/gitlab-ce:${cfg.gitlabImageTag}`,
    keepLocally: true,
  });

  const externalUrl = pulumi.interpolate`http://${cfg.gitlabHostname}:${cfg.gitlabHttpPort}`;

  // Omnibus self-config: external_url + bind to container's internal HTTP/SSH ports.
  // Bundled Postgres/Redis are used; no external dependencies in Phase 1.
  const omnibusConfig = pulumi.interpolate`
external_url '${externalUrl}'
gitlab_rails['gitlab_shell_ssh_port'] = ${cfg.gitlabSshPort}
nginx['listen_port'] = 80
nginx['listen_https'] = false
`;

  const envs: pulumi.Input<string>[] = [
    pulumi.interpolate`GITLAB_OMNIBUS_CONFIG=${omnibusConfig}`,
  ];
  if (cfg.rootPassword !== undefined) {
    envs.push(pulumi.interpolate`GITLAB_ROOT_PASSWORD=${cfg.rootPassword}`);
  }

  const container = new docker.Container(`${name}-container`, {
    name,
    image: image.imageId,
    hostname: cfg.gitlabHostname,
    restart: "unless-stopped",
    envs,
    ports: [
      { internal: 80, external: cfg.gitlabHttpPort, protocol: "tcp" },
      { internal: 22, external: cfg.gitlabSshPort, protocol: "tcp" },
    ],
    volumes: [
      { volumeName: volumes.config.name, containerPath: "/etc/gitlab" },
      { volumeName: volumes.logs.name, containerPath: "/var/log/gitlab" },
      { volumeName: volumes.data.name, containerPath: "/var/opt/gitlab" },
    ],
    networksAdvanced: [{ name: network.name }],
    // Omnibus needs SYS_PTRACE for runit + first-boot chef-solo.
    capabilities: { adds: ["SYS_PTRACE"] },
    shmSize: 256,
    healthcheck: {
      tests: [
        "CMD-SHELL",
        "curl -fsS http://localhost/-/health || exit 1",
      ],
      interval: "30s",
      timeout: "10s",
      retries: 20,
      startPeriod: "5m",
    },
  });

  return { image, container, externalUrl };
}
