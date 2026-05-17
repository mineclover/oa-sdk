import * as pulumi from "@pulumi/pulumi";

const cfg = new pulumi.Config();

export interface CloudVmConfig {
  readonly name: string;
  readonly dataVolumeName: string;
  readonly region: string;
  readonly size: string;
  readonly image: string;
  readonly sshKeys: string[];
  readonly sshAllowedCidrs: string[];
  readonly domainName: string;
  readonly hostname: string;
  readonly gitlabImageTag: string;
  readonly runnerImageTag: string;
  readonly enableRunner: boolean;
  readonly gitlabSshPort: number;
  readonly volumeSizeGb: number;
  readonly rootPassword: pulumi.Output<string> | undefined;
  readonly tags: string[];
  readonly backups: boolean;
  readonly backupRetentionSeconds: number;
}

function getRequiredString(key: string): string {
  const value = cfg.get(key);
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required Pulumi config: ${key}`);
  }
  return value;
}

function getStringArray(key: string, fallback: string[]): string[] {
  const value = cfg.getObject<string[]>(key);
  return value === undefined || value.length === 0 ? fallback : value;
}

export function loadCloudVmConfig(): CloudVmConfig {
  const name = cfg.get("name") ?? "gitlab";

  return {
    name,
    dataVolumeName: cfg.get("dataVolumeName") ?? `${name}-data`,
    region: cfg.get("region") ?? "sfo3",
    size: cfg.get("size") ?? "s-2vcpu-4gb",
    image: cfg.get("image") ?? "ubuntu-24-04-x64",
    sshKeys: getStringArray("sshKeys", []),
    sshAllowedCidrs: getStringArray("sshAllowedCidrs", ["0.0.0.0/0"]),
    domainName: getRequiredString("domainName"),
    hostname: cfg.get("hostname") ?? "gitlab",
    gitlabImageTag: cfg.get("gitlabImageTag") ?? "latest",
    runnerImageTag: cfg.get("runnerImageTag") ?? "latest",
    enableRunner: cfg.getBoolean("enableRunner") ?? true,
    gitlabSshPort: cfg.getNumber("gitlabSshPort") ?? 2222,
    volumeSizeGb: cfg.getNumber("volumeSizeGb") ?? 100,
    rootPassword: cfg.getSecret("rootPassword"),
    tags: getStringArray("tags", ["oa-sdk", "gitlab", "cloud-vm"]),
    backups: cfg.getBoolean("backups") ?? true,
    backupRetentionSeconds: cfg.getNumber("backupRetentionSeconds") ?? 604800,
  };
}
