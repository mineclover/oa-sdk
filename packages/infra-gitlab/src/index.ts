import * as pulumi from "@pulumi/pulumi";

import { loadConfig } from "./config.js";
import { createGitLab } from "./gitlab.js";
import {
  createGitLabVolumes,
  createNetwork,
  createRunnerConfigVolume,
} from "./network.js";
import { createRunner } from "./runner.js";
import { createK3sStack } from "./k3s/index.js";

const cfg = loadConfig();

interface StackOutputs {
  readonly gitlabUrl: pulumi.Output<string>;
  readonly gitlabContainerName: pulumi.Output<string> | undefined;
  readonly gitlabSshPort: pulumi.Output<number> | undefined;
  readonly runnerContainerName: pulumi.Output<string> | undefined;
  readonly networkName: pulumi.Output<string> | undefined;
  readonly gitlabNamespace: pulumi.Output<string> | undefined;
  readonly gitlabIngressName: pulumi.Output<string> | undefined;
  readonly gitlabSshServiceName: pulumi.Output<string> | undefined;
  readonly runnerDeploymentName: pulumi.Output<string> | undefined;
}

function createDockerStack(): StackOutputs {
  const network = createNetwork("gitlab-net");
  const volumes = createGitLabVolumes("gitlab");
  const gitlab = createGitLab("gitlab", { cfg, network, volumes });

  const runnerConfigVolume = cfg.enableRunner
    ? createRunnerConfigVolume("gitlab")
    : undefined;

  const runner =
    cfg.enableRunner && runnerConfigVolume !== undefined
      ? createRunner("gitlab-runner", {
          cfg,
          network,
          configVolume: runnerConfigVolume,
          dependsOn: [gitlab.container],
        })
      : undefined;

  return {
    gitlabUrl: gitlab.externalUrl,
    gitlabContainerName: gitlab.container.name,
    gitlabSshPort: pulumi.output(cfg.gitlabSshPort),
    runnerContainerName: runner?.container.name,
    networkName: network.name,
    gitlabNamespace: undefined,
    gitlabIngressName: undefined,
    gitlabSshServiceName: undefined,
    runnerDeploymentName: undefined,
  };
}

function createK3sStackOutputs(): StackOutputs {
  const k3s = createK3sStack(cfg);
  return {
    gitlabUrl: k3s.gitlabUrl,
    gitlabContainerName: undefined,
    gitlabSshPort: k3s.gitlabSshPort,
    runnerContainerName: undefined,
    networkName: undefined,
    gitlabNamespace: k3s.gitlabNamespace,
    gitlabIngressName: k3s.gitlabIngressName,
    gitlabSshServiceName: k3s.gitlabSshServiceName,
    runnerDeploymentName: k3s.runnerDeploymentName,
  };
}

const stack = cfg.target === "k3s" ? createK3sStackOutputs() : createDockerStack();

export const gitlabUrl = stack.gitlabUrl;
export const gitlabContainerName = stack.gitlabContainerName;
export const gitlabSshPort = stack.gitlabSshPort;
export const runnerContainerName = stack.runnerContainerName;
export const networkName = stack.networkName;
export const gitlabNamespace = stack.gitlabNamespace;
export const gitlabIngressName = stack.gitlabIngressName;
export const gitlabSshServiceName = stack.gitlabSshServiceName;
export const runnerDeploymentName = stack.runnerDeploymentName;
