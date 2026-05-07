#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

import type { OrchestratorConfig } from "./config.js";
import { watchWorkflow } from "./live-config.js";
import { run } from "./orchestrator.js";
import { OrchestratorRuntime } from "./runtime.js";
import { loadWorkflow } from "./workflow.js";

interface ParsedArgs {
  readonly command: "run" | "dry-run" | "help";
  readonly configPath: string | undefined;
  readonly workflowPath: string | undefined;
  readonly issueIid: string | undefined;
  readonly watch: boolean;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === "help" || (args.configPath === undefined && args.workflowPath === undefined)) {
    printHelp();
    process.exit(args.command === "help" ? 0 : 1);
  }

  const ac = new AbortController();
  const stop = (): void => {
    ac.abort();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  if (args.command === "dry-run") {
    const config = args.workflowPath !== undefined
      ? await loadWorkflow(resolve(process.cwd(), args.workflowPath))
      : await loadConfig(args.configPath as string);
    const runtimeConfig: OrchestratorConfig = { ...config, signal: ac.signal };
    await runOnce(runtimeConfig, args.issueIid);
    return;
  }

  // run mode
  const runtime = new OrchestratorRuntime();

  if (args.workflowPath !== undefined && args.watch) {
    const handle = await watchWorkflow(resolve(process.cwd(), args.workflowPath), {
      runtime,
    });
    // The OrchestratorConfig the provider holds was loaded without a signal.
    // We can't mutate readonly config; instead, we wrap a subclass-like provider
    // by handing a fresh provider whose current() injects the signal.
    const wrapped = {
      current(): OrchestratorConfig {
        const inner = handle.provider.current();
        return inner.signal === undefined ? { ...inner, signal: ac.signal } : inner;
      },
    } as unknown as Parameters<typeof run>[0];
    try {
      await run(wrapped, { runtime });
    } finally {
      handle.close();
    }
    return;
  }

  const config = args.workflowPath !== undefined
    ? await loadWorkflow(resolve(process.cwd(), args.workflowPath))
    : await loadConfig(args.configPath as string);
  const runtimeConfig: OrchestratorConfig = { ...config, signal: ac.signal };
  await run(runtimeConfig, { runtime });
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
  const empty: ParsedArgs = {
    command: "help",
    configPath: undefined,
    workflowPath: undefined,
    issueIid: undefined,
    watch: false,
  };
  if (argv.length === 0) {
    return empty;
  }
  const command = argv[0];
  let configPath: string | undefined;
  let workflowPath: string | undefined;
  let issueIid: string | undefined;
  let watch = false;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--config" || a === "-c") {
      configPath = argv[++i];
    } else if (a === "--workflow" || a === "-w") {
      workflowPath = argv[++i];
    } else if (a === "--issue") {
      issueIid = argv[++i];
    } else if (a === "--watch") {
      watch = true;
    } else if (a === "--help" || a === "-h") {
      return empty;
    }
  }
  if (command === "run" || command === "dry-run") {
    return { command, configPath, workflowPath, issueIid, watch };
  }
  return empty;
}

function printHelp(): void {
  console.log(`orchestrator-gitlab

Usage:
  orchestrator-gitlab run     [--config <path> | --workflow <path>] [--watch]
  orchestrator-gitlab dry-run [--config <path> | --workflow <path>] [--issue <iid>]

  --config / -c     JS/TS module default-exporting an OrchestratorConfig.
  --workflow / -w   WORKFLOW.md (Symphony-compatible front matter + Liquid prompt).
                    Mutually exclusive with --config.
  --watch           Hot reload — re-parse the WORKFLOW.md on file change and
                    apply the new config (next tick / next dispatch / next turn).
                    In-flight workers are NOT killed by reload. Requires --workflow.

Observability HTTP server: set httpPort in your config (or front matter
'http_port' in WORKFLOW.md). See README for /healthz, /state, /issues/:iid.

See @oa-sdk/orchestrator-gitlab README for both formats.
`);
}

void main().catch((err: unknown) => {
  console.error("orchestrator-gitlab fatal:", err);
  process.exit(1);
});
