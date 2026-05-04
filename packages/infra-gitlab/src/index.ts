import * as pulumi from "@pulumi/pulumi";

import { loadConfig } from "./config.js";
import { createGitLab } from "./gitlab.js";
import {
  createGitLabVolumes,
  createNetwork,
  createRunnerConfigVolume,
} from "./network.js";
import { createRunner } from "./runner.js";

const cfg = loadConfig();

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

export const gitlabUrl = gitlab.externalUrl;
export const gitlabContainerName = gitlab.container.name;
export const gitlabSshPort = pulumi.output(cfg.gitlabSshPort);
export const runnerContainerName: pulumi.Output<string> | undefined =
  runner?.container.name;
export const networkName = network.name;
