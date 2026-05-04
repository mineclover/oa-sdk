import * as docker from "@pulumi/docker";
import * as pulumi from "@pulumi/pulumi";

import type { InfraConfig } from "./config.js";

export interface RunnerArgs {
  readonly cfg: InfraConfig;
  readonly network: docker.Network;
  readonly configVolume: docker.Volume;
  readonly dependsOn?: pulumi.Resource[];
}

export interface RunnerService {
  readonly image: docker.RemoteImage;
  readonly container: docker.Container;
}

export function createRunner(name: string, args: RunnerArgs): RunnerService {
  const { cfg, network, configVolume, dependsOn } = args;

  const image = new docker.RemoteImage(`${name}-image`, {
    name: pulumi.interpolate`gitlab/gitlab-runner:${cfg.runnerImageTag}`,
    keepLocally: true,
  });

  // Runner is started unregistered. After GitLab is healthy, the operator runs
  // `pnpm register:runner` (or the equivalent docker exec) to register against
  // the GitLab instance using a token they obtain from the Admin Area / Group
  // settings. Pulumi does not orchestrate registration because it depends on
  // GitLab being fully booted (~5 min first-boot) and on a token that is not
  // known until after that.
  const container = new docker.Container(
    `${name}-container`,
    {
      name,
      image: image.imageId,
      restart: "unless-stopped",
      volumes: [
        { volumeName: configVolume.name, containerPath: "/etc/gitlab-runner" },
        // Docker socket for the docker executor — required for `docker run` jobs.
        { hostPath: "/var/run/docker.sock", containerPath: "/var/run/docker.sock" },
      ],
      networksAdvanced: [{ name: network.name }],
    },
    dependsOn !== undefined ? { dependsOn } : undefined,
  );

  return { image, container };
}
