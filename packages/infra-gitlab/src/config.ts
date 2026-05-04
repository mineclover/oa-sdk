import * as pulumi from "@pulumi/pulumi";

const cfg = new pulumi.Config();

export interface InfraConfig {
  readonly gitlabHostname: string;
  readonly gitlabHttpPort: number;
  readonly gitlabSshPort: number;
  readonly gitlabImageTag: string;
  readonly runnerImageTag: string;
  readonly enableRunner: boolean;
  readonly rootPassword: pulumi.Output<string> | undefined;
}

export function loadConfig(): InfraConfig {
  return {
    gitlabHostname: cfg.get("gitlabHostname") ?? "localhost",
    gitlabHttpPort: cfg.getNumber("gitlabHttpPort") ?? 8929,
    gitlabSshPort: cfg.getNumber("gitlabSshPort") ?? 2289,
    gitlabImageTag: cfg.get("gitlabImageTag") ?? "latest",
    runnerImageTag: cfg.get("runnerImageTag") ?? "latest",
    enableRunner: cfg.getBoolean("enableRunner") ?? true,
    rootPassword: cfg.getSecret("rootPassword"),
  };
}
