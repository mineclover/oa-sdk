import * as digitalocean from "@pulumi/digitalocean";
import * as pulumi from "@pulumi/pulumi";

import { loadCloudVmConfig } from "./config.js";
import { renderCloudInit } from "./user-data.js";

const cfg = loadCloudVmConfig();
const fqdn = `${cfg.hostname}.${cfg.domainName}`;

const dataVolume = new digitalocean.Volume("gitlab-data", {
  name: cfg.dataVolumeName,
  region: cfg.region,
  size: cfg.volumeSizeGb,
  initialFilesystemType: "ext4",
  initialFilesystemLabel: "gitlab-data",
  description: "Persistent GitLab Omnibus and runner state for oa-sdk infra-gitlab cloud VM.",
  tags: cfg.tags,
});

const droplet = new digitalocean.Droplet("gitlab", {
  name: cfg.name,
  region: cfg.region,
  size: cfg.size,
  image: cfg.image,
  sshKeys: cfg.sshKeys,
  monitoring: true,
  ipv6: true,
  backups: cfg.backups,
  tags: cfg.tags,
  volumeIds: [dataVolume.id],
  userData: renderCloudInit(cfg),
});

const firewall = new digitalocean.Firewall("gitlab", {
  name: `${cfg.name}-gitlab`,
  dropletIds: [droplet.id.apply((id) => Number(id))],
  inboundRules: [
    {
      protocol: "tcp",
      portRange: "22",
      sourceAddresses: cfg.sshAllowedCidrs,
    },
    {
      protocol: "tcp",
      portRange: "80",
      sourceAddresses: ["0.0.0.0/0", "::/0"],
    },
    {
      protocol: "tcp",
      portRange: "443",
      sourceAddresses: ["0.0.0.0/0", "::/0"],
    },
    {
      protocol: "tcp",
      portRange: String(cfg.gitlabSshPort),
      sourceAddresses: ["0.0.0.0/0", "::/0"],
    },
    {
      protocol: "icmp",
      sourceAddresses: ["0.0.0.0/0", "::/0"],
    },
  ],
  outboundRules: [
    {
      protocol: "tcp",
      portRange: "all",
      destinationAddresses: ["0.0.0.0/0", "::/0"],
    },
    {
      protocol: "udp",
      portRange: "all",
      destinationAddresses: ["0.0.0.0/0", "::/0"],
    },
    {
      protocol: "icmp",
      destinationAddresses: ["0.0.0.0/0", "::/0"],
    },
  ],
});

const dnsRecord = new digitalocean.DnsRecord("gitlab-a", {
  domain: cfg.domainName,
  type: "A",
  name: cfg.hostname,
  value: droplet.ipv4Address,
  ttl: 300,
});

export const gitlabUrl = pulumi.interpolate`https://${fqdn}`;
export const gitlabSshUrl = pulumi.interpolate`ssh://git@${fqdn}:${cfg.gitlabSshPort}`;
export const dropletId = droplet.id;
export const dropletIp = droplet.ipv4Address;
export const volumeId = dataVolume.id;
export const firewallId = firewall.id;
export const dnsRecordFqdn = pulumi.interpolate`${dnsRecord.fqdn}`;
