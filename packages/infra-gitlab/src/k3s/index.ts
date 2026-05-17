import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

import type { InfraConfig } from "../config.js";
import { createLetsEncryptClusterIssuer } from "./cert-manager.js";
import { loadK3sConfig } from "./config.js";
import { createK3sGitLab } from "./gitlab.js";
import { createK3sRunner } from "./runner.js";

export interface K3sStackOutputs {
  readonly gitlabUrl: pulumi.Output<string>;
  readonly gitlabNamespace: pulumi.Output<string>;
  readonly gitlabIngressName: pulumi.Output<string>;
  readonly gitlabSshServiceName: pulumi.Output<string>;
  readonly gitlabSshPort: pulumi.Output<number>;
  readonly runnerDeploymentName: pulumi.Output<string> | undefined;
}

export function createK3sStack(base: InfraConfig): K3sStackOutputs {
  const cfg = loadK3sConfig(base);
  const provider = new k8s.Provider("k3s", {
    kubeconfig: cfg.kubeconfig,
  });

  const namespace = new k8s.core.v1.Namespace(
    cfg.namespace,
    {
      metadata: { name: cfg.namespace },
    },
    { provider },
  );

  const issuer = createLetsEncryptClusterIssuer("gitlab-letsencrypt", cfg, provider);
  const gitlab = createK3sGitLab("gitlab", {
    cfg,
    namespace,
    provider,
  });

  const runner = cfg.enableRunner
    ? createK3sRunner("gitlab-runner", {
        cfg,
        namespace,
        provider,
        dependsOn: [gitlab.deployment],
      })
    : undefined;

  return {
    gitlabUrl: gitlab.externalUrl,
    gitlabNamespace: namespace.metadata.name,
    gitlabIngressName: gitlab.ingress.metadata.name,
    gitlabSshServiceName: gitlab.sshService.metadata.name,
    gitlabSshPort: pulumi.output(cfg.gitlabSshExternalPort),
    runnerDeploymentName: runner?.deployment.metadata.name,
  };
}
