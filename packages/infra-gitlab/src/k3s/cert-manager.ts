import * as k8s from "@pulumi/kubernetes";

import type { K3sConfig } from "./config.js";

export function createLetsEncryptClusterIssuer(
  name: string,
  cfg: K3sConfig,
  provider: k8s.Provider,
): k8s.apiextensions.CustomResource | undefined {
  if (!cfg.createCertManagerIssuer) {
    return undefined;
  }
  if (cfg.letsEncryptEmail === undefined) {
    throw new Error(
      "infra-gitlab:k3sLetsEncryptEmail is required when k3sCreateCertManagerIssuer is true.",
    );
  }

  return new k8s.apiextensions.CustomResource(
    name,
    {
      apiVersion: "cert-manager.io/v1",
      kind: "ClusterIssuer",
      metadata: { name: cfg.certManagerClusterIssuer },
      spec: {
        acme: {
          email: cfg.letsEncryptEmail,
          server: cfg.letsEncryptServer,
          privateKeySecretRef: { name: `${cfg.certManagerClusterIssuer}-account-key` },
          solvers: [{ http01: { ingress: { class: cfg.ingressClassName } } }],
        },
      },
    },
    { provider },
  );
}
