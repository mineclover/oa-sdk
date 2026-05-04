import * as docker from "@pulumi/docker";

export function createNetwork(name: string): docker.Network {
  return new docker.Network(name, {
    name,
    driver: "bridge",
  });
}

export interface GitLabVolumes {
  readonly config: docker.Volume;
  readonly logs: docker.Volume;
  readonly data: docker.Volume;
}

export function createGitLabVolumes(prefix: string): GitLabVolumes {
  return {
    config: new docker.Volume(`${prefix}-config`, { name: `${prefix}-config` }),
    logs: new docker.Volume(`${prefix}-logs`, { name: `${prefix}-logs` }),
    data: new docker.Volume(`${prefix}-data`, { name: `${prefix}-data` }),
  };
}

export function createRunnerConfigVolume(prefix: string): docker.Volume {
  return new docker.Volume(`${prefix}-runner-config`, {
    name: `${prefix}-runner-config`,
  });
}
