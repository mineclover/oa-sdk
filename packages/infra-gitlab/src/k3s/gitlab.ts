import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

import type { K3sConfig } from "./config.js";

export interface K3sGitLabArgs {
  readonly cfg: K3sConfig;
  readonly namespace: k8s.core.v1.Namespace;
  readonly provider: k8s.Provider;
}

export interface K3sGitLabService {
  readonly rootPasswordSecret: k8s.core.v1.Secret | undefined;
  readonly configPvc: k8s.core.v1.PersistentVolumeClaim;
  readonly logsPvc: k8s.core.v1.PersistentVolumeClaim;
  readonly dataPvc: k8s.core.v1.PersistentVolumeClaim;
  readonly deployment: k8s.apps.v1.Deployment;
  readonly httpService: k8s.core.v1.Service;
  readonly sshService: k8s.core.v1.Service;
  readonly ingress: k8s.networking.v1.Ingress;
  readonly externalUrl: pulumi.Output<string>;
}

function storageClassName(cfg: K3sConfig): string | undefined {
  return cfg.storageClassName === undefined || cfg.storageClassName.length === 0
    ? undefined
    : cfg.storageClassName;
}

function createPvc(
  name: string,
  namespace: pulumi.Input<string>,
  size: string,
  cfg: K3sConfig,
  provider: k8s.Provider,
): k8s.core.v1.PersistentVolumeClaim {
  return new k8s.core.v1.PersistentVolumeClaim(
    name,
    {
      metadata: { name, namespace },
      spec: {
        accessModes: ["ReadWriteOnce"],
        storageClassName: storageClassName(cfg),
        resources: { requests: { storage: size } },
      },
    },
    { provider },
  );
}

export function createK3sGitLab(name: string, args: K3sGitLabArgs): K3sGitLabService {
  const { cfg, namespace, provider } = args;
  const namespaceName = namespace.metadata.name;
  const labels = { app: name };
  const externalUrl = pulumi.interpolate`https://${cfg.gitlabHostname}`;
  const omnibusConfig = pulumi.interpolate`
external_url '${externalUrl}'
gitlab_rails['gitlab_shell_ssh_port'] = ${cfg.gitlabSshExternalPort}
nginx['listen_port'] = 80
nginx['listen_https'] = false
`;

  const configPvc = createPvc(`${name}-config`, namespaceName, cfg.gitlabConfigStorageSize, cfg, provider);
  const logsPvc = createPvc(`${name}-logs`, namespaceName, cfg.gitlabLogsStorageSize, cfg, provider);
  const dataPvc = createPvc(`${name}-data`, namespaceName, cfg.gitlabDataStorageSize, cfg, provider);

  const env: k8s.types.input.core.v1.EnvVar[] = [
    { name: "GITLAB_OMNIBUS_CONFIG", value: omnibusConfig },
  ];
  const rootPasswordSecret =
    cfg.rootPassword === undefined
      ? undefined
      : new k8s.core.v1.Secret(
          `${name}-root-password`,
          {
            metadata: { name: `${name}-root-password`, namespace: namespaceName },
            stringData: { rootPassword: cfg.rootPassword },
          },
          { provider },
        );
  if (cfg.rootPassword !== undefined) {
    env.push({
      name: "GITLAB_ROOT_PASSWORD",
      valueFrom: {
        secretKeyRef: {
          name: rootPasswordSecret!.metadata.name,
          key: "rootPassword",
        },
      },
    });
  }

  const deployment = new k8s.apps.v1.Deployment(
    `${name}-deployment`,
    {
      metadata: { name, namespace: namespaceName, labels },
      spec: {
        replicas: 1,
        strategy: { type: "Recreate" },
        selector: { matchLabels: labels },
        template: {
          metadata: { labels },
          spec: {
            containers: [
              {
                name,
                image: pulumi.interpolate`gitlab/gitlab-ce:${cfg.gitlabImageTag}`,
                ports: [
                  { name: "http", containerPort: 80 },
                  { name: "ssh", containerPort: 22 },
                ],
                env,
                securityContext: {
                  capabilities: { add: ["SYS_PTRACE"] },
                },
                volumeMounts: [
                  { name: "config", mountPath: "/etc/gitlab" },
                  { name: "logs", mountPath: "/var/log/gitlab" },
                  { name: "data", mountPath: "/var/opt/gitlab" },
                ],
                readinessProbe: {
                  httpGet: { path: "/users/sign_in", port: "http" },
                  initialDelaySeconds: 180,
                  periodSeconds: 20,
                  timeoutSeconds: 10,
                  failureThreshold: 30,
                },
                livenessProbe: {
                  httpGet: { path: "/users/sign_in", port: "http" },
                  initialDelaySeconds: 300,
                  periodSeconds: 30,
                  timeoutSeconds: 10,
                  failureThreshold: 10,
                },
                resources: {
                  requests: { cpu: "500m", memory: "3Gi" },
                  limits: { memory: "4Gi" },
                },
              },
            ],
            volumes: [
              { name: "config", persistentVolumeClaim: { claimName: configPvc.metadata.name } },
              { name: "logs", persistentVolumeClaim: { claimName: logsPvc.metadata.name } },
              { name: "data", persistentVolumeClaim: { claimName: dataPvc.metadata.name } },
            ],
          },
        },
      },
    },
    { provider, dependsOn: [configPvc, logsPvc, dataPvc, ...(rootPasswordSecret === undefined ? [] : [rootPasswordSecret])] },
  );

  const httpService = new k8s.core.v1.Service(
    `${name}-http`,
    {
      metadata: { name, namespace: namespaceName, labels },
      spec: {
        type: "ClusterIP",
        selector: labels,
        ports: [{ name: "http", port: 80, targetPort: "http" }],
      },
    },
    { provider },
  );

  const sshPort: k8s.types.input.core.v1.ServicePort = {
    name: "ssh",
    port: 22,
    targetPort: "ssh",
  };
  if (cfg.sshServiceType === "NodePort" && cfg.gitlabSshNodePort !== undefined) {
    sshPort.nodePort = cfg.gitlabSshNodePort;
  }

  const sshService = new k8s.core.v1.Service(
    `${name}-ssh`,
    {
      metadata: { name: `${name}-ssh`, namespace: namespaceName, labels },
      spec: {
        type: cfg.sshServiceType,
        selector: labels,
        ports: [sshPort],
      },
    },
    { provider },
  );

  const ingress = new k8s.networking.v1.Ingress(
    `${name}-ingress`,
    {
      metadata: {
        name,
        namespace: namespaceName,
        annotations: {
          "cert-manager.io/cluster-issuer": cfg.certManagerClusterIssuer,
          "traefik.ingress.kubernetes.io/router.entrypoints": "websecure",
        },
      },
      spec: {
        ingressClassName: cfg.ingressClassName,
        tls: [{ hosts: [cfg.gitlabHostname], secretName: `${name}-tls` }],
        rules: [
          {
            host: cfg.gitlabHostname,
            http: {
              paths: [
                {
                  path: "/",
                  pathType: "Prefix",
                  backend: {
                    service: {
                      name: httpService.metadata.name,
                      port: { number: 80 },
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    },
    { provider, dependsOn: [httpService] },
  );

  return {
    rootPasswordSecret,
    configPvc,
    logsPvc,
    dataPvc,
    deployment,
    httpService,
    sshService,
    ingress,
    externalUrl,
  };
}
