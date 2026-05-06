#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

import type { OrchestratorConfig } from "./config.js";
import { run } from "./orchestrator.js";

interface ParsedArgs {
  readonly command: "run" | "dry-run" | "help";
  readonly configPath: string | undefined;
  readonly issueIid: string | undefined;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === "help" || args.configPath === undefined) {
    printHelp();
    process.exit(args.command === "help" ? 0 : 1);
  }

  const config = await loadConfig(args.configPath);

  const ac = new AbortController();
  const stop = (): void => {
    ac.abort();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  const runtimeConfig: OrchestratorConfig = {
    ...config,
    signal: ac.signal,
  };

  if (args.command === "dry-run") {
    // Phase A dry-run: one tick, single issue if --issue passed, no actual loop.
    // The provided agent runs as configured. Operator is responsible for using
    // EchoAgent in dry-runs to avoid side effects.
    await runOnce(runtimeConfig, args.issueIid);
    return;
  }

  await run(runtimeConfig);
}

async function loadConfig(rawPath: string): Promise<OrchestratorConfig> {
  const abs = resolve(process.cwd(), rawPath);
  const mod: unknown = await import(pathToFileURL(abs).href);
  const candidate =
    typeof mod === "object" && mod !== null && "default" in mod
      ? (mod as { default: unknown }).default
      : mod;
  if (candidate === null || typeof candidate !== "object") {
    throw new Error(`config at ${rawPath} did not export an object`);
  }
  return candidate as OrchestratorConfig;
}

async function runOnce(config: OrchestratorConfig, issueIid: string | undefined): Promise<void> {
  // Minimal one-tick path used by `dry-run`. Reuses `run()` would require a
  // tick cap; for clarity, we reimplement a single pass here.
  const issues = await config.tracker.listEligibleIssues({
    ready: config.labels?.ready ?? "agent-ready",
    running: config.labels?.running ?? "agent-running",
    done: config.labels?.done ?? "agent-done",
    failed: config.labels?.failed ?? "agent-failed",
  });
  const targets = issueIid !== undefined ? issues.filter((i) => i.iid === issueIid) : issues.slice(0, 1);
  if (targets.length === 0) {
    console.log(`dry-run: no eligible issues${issueIid !== undefined ? ` matching iid=${issueIid}` : ""}`);
    return;
  }
  const target = targets[0];
  if (target === undefined) return;
  const workspace = await config.workspace.ensure(target);
  const prompt = await config.prompt.build({ issue: target, turnNumber: 1, attempt: 1 });
  const result = await config.agent.run({
    workspacePath: workspace.path,
    prompt,
    issue: target,
    turnNumber: 1,
    attempt: 1,
  });
  console.log(JSON.stringify({ issue: target.iid, workspace: workspace.path, result }, null, 2));
}

function parseArgs(argv: ReadonlyArray<string>): ParsedArgs {
  if (argv.length === 0) {
    return { command: "help", configPath: undefined, issueIid: undefined };
  }
  const command = argv[0];
  let configPath: string | undefined;
  let issueIid: string | undefined;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--config" || a === "-c") {
      configPath = argv[++i];
    } else if (a === "--issue") {
      issueIid = argv[++i];
    } else if (a === "--help" || a === "-h") {
      return { command: "help", configPath: undefined, issueIid: undefined };
    }
  }
  if (command === "run" || command === "dry-run") {
    return { command, configPath, issueIid };
  }
  return { command: "help", configPath: undefined, issueIid: undefined };
}

function printHelp(): void {
  console.log(`orchestrator-gitlab — Phase A MVP

Usage:
  orchestrator-gitlab run     --config <path>
  orchestrator-gitlab dry-run --config <path> [--issue <iid>]

The config file is a JS/TS module that default-exports an OrchestratorConfig
(see @oa-sdk/orchestrator-gitlab types).
`);
}

void main().catch((err: unknown) => {
  console.error("orchestrator-gitlab fatal:", err);
  process.exit(1);
});
