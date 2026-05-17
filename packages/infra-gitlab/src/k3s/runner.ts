import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

import type { K3sConfig } from "./config.js";

export interface K3sRunnerArgs {
  readonly cfg: K3sConfig;
  readonly namespace: k8s.core.v1.Namespace;
  readonly provider: k8s.Provider;
  readonly dependsOn?: pulumi.Resource[];
}

export interface K3sRunnerService {
  readonly serviceAccount: k8s.core.v1.ServiceAccount;
  readonly role: k8s.rbac.v1.Role;
  readonly roleBinding: k8s.rbac.v1.RoleBinding;
  readonly configPvc: k8s.core.v1.PersistentVolumeClaim;
  readonly deployment: k8s.apps.v1.Deployment;
}

export function createK3sRunner(name: string, args: K3sRunnerArgs): K3sRunnerService {
  const { cfg, namespace, provider, dependsOn } = args;
  const namespaceName = namespace.metadata.name;
  const labels = { app: name };

  const serviceAccount = new k8s.core.v1.ServiceAccount(
    `${name}-service-account`,
    {
      metadata: { name, namespace: namespaceName },
    },
    { provider },
  );

  const role = new k8s.rbac.v1.Role(
    `${name}-role`,
    {
      metadata: { name, namespace: namespaceName },
      rules: [
        {
          apiGroups: [""],
          resources: [
            "pods",
            "pods/attach",
            "pods/exec",
            "pods/log",
            "secrets",
            "configmaps",
            "services",
            "events",
          ],
          verbs: ["get", "list", "watch", "create", "delete", "patch", "update"],
        },
      ],
    },
    { provider },
  );

  const roleBinding = new k8s.rbac.v1.RoleBinding(
    `${name}-role-binding`,
    {
      metadata: { name, namespace: namespaceName },
      subjects: [
        {
          kind: "ServiceAccount",
          name: serviceAccount.metadata.name,
          namespace: namespaceName,
        },
      ],
      roleRef: {
        apiGroup: "rbac.authorization.k8s.io",
        kind: "Role",
        name: role.metadata.name,
      },
    },
    { provider },
  );

  const configPvc = new k8s.core.v1.PersistentVolumeClaim(
    `${name}-config`,
    {
      metadata: { name: `${name}-config`, namespace: namespaceName },
      spec: {
        accessModes: ["ReadWriteOnce"],
        storageClassName: cfg.storageClassName,
        resources: { requests: { storage: cfg.runnerConfigStorageSize } },
      },
    },
    { provider },
  );

  const deployment = new k8s.apps.v1.Deployment(
    `${name}-deployment`,
    {
      metadata: { name, namespace: namespaceName, labels },
      spec: {
        replicas: 1,
        selector: { matchLabels: labels },
        template: {
          metadata: { labels },
          spec: {
            serviceAccountName: serviceAccount.metadata.name,
            containers: [
              {
                name,
                image: pulumi.interpolate`gitlab/gitlab-runner:${cfg.runnerImageTag}`,
                volumeMounts: [{ name: "config", mountPath: "/etc/gitlab-runner" }],
              },
            ],
            volumes: [{ name: "config", persistentVolumeClaim: { claimName: configPvc.metadata.name } }],
          },
        },
      },
    },
    {
      provider,
      dependsOn: [...(dependsOn ?? []), serviceAccount, roleBinding, configPvc],
    },
  );

  return { serviceAccount, role, roleBinding, configPvc, deployment };
}
