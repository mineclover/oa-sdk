import * as pulumi from "@pulumi/pulumi";

import type { InfraConfig } from "../config.js";

const cfg = new pulumi.Config();

export interface K3sConfig {
  readonly namespace: string;
  readonly kubeconfig: pulumi.Output<string> | undefined;
  readonly gitlabHostname: string;
  readonly gitlabImageTag: string;
  readonly runnerImageTag: string;
  readonly enableRunner: boolean;
  readonly rootPassword: pulumi.Output<string> | undefined;
  readonly storageClassName: string | undefined;
  readonly gitlabConfigStorageSize: string;
  readonly gitlabLogsStorageSize: string;
  readonly gitlabDataStorageSize: string;
  readonly runnerConfigStorageSize: string;
  readonly certManagerClusterIssuer: string;
  readonly createCertManagerIssuer: boolean;
  readonly letsEncryptEmail: string | undefined;
  readonly letsEncryptServer: string;
  readonly ingressClassName: string;
  readonly sshServiceType: "ClusterIP" | "NodePort" | "LoadBalancer";
  readonly gitlabSshNodePort: number | undefined;
  readonly gitlabSshExternalPort: number;
}

export function loadK3sConfig(base: InfraConfig): K3sConfig {
  const sshServiceType = cfg.get("k3sSshServiceType") ?? "NodePort";
  if (
    sshServiceType !== "ClusterIP" &&
    sshServiceType !== "NodePort" &&
    sshServiceType !== "LoadBalancer"
  ) {
    throw new Error(
      `Unsupported infra-gitlab:k3sSshServiceType '${sshServiceType}'. Expected ClusterIP, NodePort, or LoadBalancer.`,
    );
  }

  return {
    namespace: cfg.get("k3sNamespace") ?? "gitlab",
    kubeconfig: cfg.getSecret("kubeconfig"),
    gitlabHostname: base.gitlabHostname === "localhost" ? "gitlab.127.0.0.1.nip.io" : base.gitlabHostname,
    gitlabImageTag: base.gitlabImageTag,
    runnerImageTag: base.runnerImageTag,
    enableRunner: base.enableRunner,
    rootPassword: base.rootPassword,
    storageClassName: cfg.get("k3sStorageClassName") ?? undefined,
    gitlabConfigStorageSize: cfg.get("k3sGitlabConfigStorageSize") ?? "2Gi",
    gitlabLogsStorageSize: cfg.get("k3sGitlabLogsStorageSize") ?? "5Gi",
    gitlabDataStorageSize: cfg.get("k3sGitlabDataStorageSize") ?? "20Gi",
    runnerConfigStorageSize: cfg.get("k3sRunnerConfigStorageSize") ?? "1Gi",
    certManagerClusterIssuer: cfg.get("k3sCertManagerClusterIssuer") ?? "letsencrypt-staging",
    createCertManagerIssuer: cfg.getBoolean("k3sCreateCertManagerIssuer") ?? false,
    letsEncryptEmail: cfg.get("k3sLetsEncryptEmail") ?? undefined,
    letsEncryptServer:
      cfg.get("k3sLetsEncryptServer") ?? "https://acme-staging-v02.api.letsencrypt.org/directory",
    ingressClassName: cfg.get("k3sIngressClassName") ?? "traefik",
    sshServiceType,
    gitlabSshNodePort: cfg.getNumber("k3sGitlabSshNodePort") ?? 32222,
    gitlabSshExternalPort:
      cfg.getNumber("k3sGitlabSshExternalPort") ?? cfg.getNumber("k3sGitlabSshNodePort") ?? 32222,
  };
}
