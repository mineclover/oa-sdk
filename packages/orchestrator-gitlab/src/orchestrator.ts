import { DEFAULTS, defaultLog, type LogRecord, type OrchestratorConfig } from "./config.js";
import { DEFAULT_LABELS, type AgentResult, type Issue, type LabelConfig } from "./types.js";

/**
 * Run the orchestrator until `signal` aborts. Phase A is single-instance.
 *
 * Loop per tick:
 *   1. fetch eligible issues from the tracker
 *   2. for each issue not currently claimed: claim (label transition), spawn
 *      agent against a fresh workspace, await result, post note + finalize
 *      label transition (`done` or `failed`)
 *   3. enforce maxConcurrent backpressure
 */
export async function run(config: OrchestratorConfig): Promise<void> {
  const labels = mergeLabels(config.labels);
  const pollIntervalMs = config.pollIntervalMs ?? DEFAULTS.pollIntervalMs;
  const maxConcurrent = config.maxConcurrent ?? DEFAULTS.maxConcurrent;
  const log = config.log ?? defaultLog;
  const signal = config.signal;

  const inFlight = new Set<string>();

  log({ level: "info", msg: `orchestrator starting agent=${config.agent.name} pollIntervalMs=${String(pollIntervalMs)} maxConcurrent=${String(maxConcurrent)}` });

  while (!isAborted(signal)) {
    try {
      const issues = await config.tracker.listEligibleIssues(labels);
      for (const issue of issues) {
        if (isAborted(signal)) break;
        if (inFlight.has(issue.id)) continue;
        if (inFlight.size >= maxConcurrent) break;

        inFlight.add(issue.id);
        // Fire-and-forget per-issue worker; we manage concurrency via inFlight size.
        void processIssue(issue, config, labels, log)
          .catch((err: unknown) => {
            log({ level: "error", msg: "unhandled processIssue rejection", issueId: issue.id, issueIid: issue.iid, error: err });
          })
          .finally(() => {
            inFlight.delete(issue.id);
          });
      }
    } catch (err) {
      log({ level: "error", msg: "tick failed", error: err });
    }

    await sleep(pollIntervalMs, signal);
  }

  log({ level: "info", msg: `orchestrator stopping; waiting for ${String(inFlight.size)} in-flight worker(s)` });
  while (inFlight.size > 0) {
    await sleep(200);
  }
  log({ level: "info", msg: "orchestrator stopped" });
}

async function processIssue(
  issue: Readonly<Issue>,
  config: OrchestratorConfig,
  labels: LabelConfig,
  log: (r: LogRecord) => void,
): Promise<void> {
  const issueId = issue.id;
  const issueIid = issue.iid;

  log({ level: "info", msg: `claiming`, issueId, issueIid, agent: config.agent.name });
  await config.tracker.transitionLabels(issueId, {
    add: [labels.running],
    remove: [labels.ready],
  });

  let workspace;
  try {
    workspace = await config.workspace.ensure(issue);
  } catch (err) {
    log({ level: "error", msg: "workspace ensure failed", issueId, issueIid, error: err });
    await finalize(config, issueId, labels, {
      status: "failed",
      summary: "Workspace preparation failed before the agent could run.",
      error: stringifyError(err),
    }).catch((postErr: unknown) => {
      log({ level: "error", msg: "label finalize after workspace failure failed", issueId, issueIid, error: postErr });
    });
    return;
  }

  const prompt = await config.prompt.build(issue);

  log({ level: "info", msg: `dispatching`, issueId, issueIid, agent: config.agent.name, extra: { workspace: workspace.path, createdNow: workspace.createdNow } });

  let result: AgentResult;
  try {
    const input: Parameters<typeof config.agent.run>[0] = {
      workspacePath: workspace.path,
      prompt,
      issue,
    };
    if (config.signal !== undefined) {
      Object.assign(input, { signal: config.signal });
    }
    result = await config.agent.run(input);
  } catch (err) {
    result = {
      status: "failed",
      summary: "Agent threw during execution.",
      error: stringifyError(err),
    };
  }

  log({ level: "info", msg: `agent done status=${result.status}`, issueId, issueIid, agent: config.agent.name });
  await finalize(config, issueId, labels, result);
}

async function finalize(
  config: OrchestratorConfig,
  issueId: string,
  labels: LabelConfig,
  result: AgentResult,
): Promise<void> {
  await config.tracker.postNote(issueId, formatNote(config.agent.name, result));
  const isSuccess = result.status === "succeeded";
  await config.tracker.transitionLabels(issueId, {
    add: [isSuccess ? labels.done : labels.failed],
    remove: [labels.running, labels.ready],
  });
}

function formatNote(agentName: string, result: AgentResult): string {
  const header = `🤖 **${agentName}** — \`${result.status}\``;
  const body: string[] = [header, "", result.summary];
  if (result.error !== undefined && result.error.length > 0) {
    body.push("", "<details><summary>error</summary>", "", "```", result.error, "```", "</details>");
  }
  if (result.artifacts !== undefined) {
    const a = result.artifacts;
    const lines: string[] = [];
    if (a.branch !== undefined) lines.push(`- branch: \`${a.branch}\``);
    if (a.commits !== undefined && a.commits.length > 0) {
      lines.push(`- commits: ${a.commits.map((c) => `\`${c}\``).join(", ")}`);
    }
    if (a.mrUrl !== undefined) lines.push(`- MR: ${a.mrUrl}`);
    if (lines.length > 0) {
      body.push("", "**artifacts**", ...lines);
    }
  }
  return body.join("\n");
}

function mergeLabels(overrides: Partial<LabelConfig> | undefined): LabelConfig {
  if (overrides === undefined) return DEFAULT_LABELS;
  return {
    ready: overrides.ready ?? DEFAULT_LABELS.ready,
    running: overrides.running ?? DEFAULT_LABELS.running,
    done: overrides.done ?? DEFAULT_LABELS.done,
    failed: overrides.failed ?? DEFAULT_LABELS.failed,
  };
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) {
    return err.stack ?? `${err.name}: ${err.message}`;
  }
  return String(err);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((res) => {
    if (isAborted(signal)) {
      res();
      return;
    }
    const t = setTimeout(() => {
      cleanup();
      res();
    }, ms);
    const onAbort = (): void => {
      cleanup();
      res();
    };
    const cleanup = (): void => {
      clearTimeout(t);
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal !== undefined && signal.aborted;
}
