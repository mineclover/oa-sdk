import { DEFAULTS, defaultLog, type LogRecord, type OrchestratorConfig } from "./config.js";
import {
  DEFAULT_LABELS,
  type AgentResult,
  type AgentTokens,
  type Issue,
  type LabelConfig,
} from "./types.js";

interface RuntimeOptions {
  readonly labels: LabelConfig;
  readonly pollIntervalMs: number;
  readonly maxConcurrent: number;
  readonly maxAttempts: number;
  readonly retryBackoffBaseMs: number;
  readonly maxRetryBackoffMs: number;
  readonly maxTurns: number;
  readonly continueLabel: string | undefined;
  readonly reconciliationIntervalMs: number;
}

interface RunMetrics {
  inFlight: number;
  totalDispatched: number;
  totalSucceeded: number;
  totalFailed: number;
  totalCancelled: number;
  tokens: { input: number; output: number; total: number };
}

/**
 * Run the orchestrator until `signal` aborts. Single-instance assumption.
 *
 * Phase B.2 features:
 *   - per-turn retry with exponential backoff (`maxAttempts` × bounded backoff)
 *   - continuation turns up to `maxTurns` when `continueLabel` remains set
 *   - reconciliation watcher per in-flight issue: cancels the agent if the
 *     issue is closed or loses the running label externally
 *   - token usage aggregation across runs (logged at shutdown)
 */
export async function run(config: OrchestratorConfig): Promise<void> {
  const opts = resolveOpts(config);
  const log = config.log ?? defaultLog;
  const signal = config.signal;
  const inFlight = new Set<string>();
  const metrics: RunMetrics = {
    inFlight: 0,
    totalDispatched: 0,
    totalSucceeded: 0,
    totalFailed: 0,
    totalCancelled: 0,
    tokens: { input: 0, output: 0, total: 0 },
  };

  log({
    level: "info",
    msg:
      `orchestrator starting agent=${config.agent.name} ` +
      `pollIntervalMs=${String(opts.pollIntervalMs)} maxConcurrent=${String(opts.maxConcurrent)} ` +
      `maxAttempts=${String(opts.maxAttempts)} maxTurns=${String(opts.maxTurns)}` +
      (opts.continueLabel !== undefined ? ` continueLabel=${opts.continueLabel}` : "") +
      ` reconciliationIntervalMs=${String(opts.reconciliationIntervalMs)}`,
  });

  while (!isAborted(signal)) {
    try {
      const issues = await config.tracker.listEligibleIssues(opts.labels);
      for (const issue of issues) {
        if (isAborted(signal)) break;
        if (inFlight.has(issue.id)) continue;
        if (inFlight.size >= opts.maxConcurrent) break;

        inFlight.add(issue.id);
        metrics.inFlight = inFlight.size;
        metrics.totalDispatched++;
        void processIssue(issue, config, opts, log, metrics)
          .catch((err: unknown) => {
            log({ level: "error", msg: "unhandled processIssue rejection", issueId: issue.id, issueIid: issue.iid, error: err });
          })
          .finally(() => {
            inFlight.delete(issue.id);
            metrics.inFlight = inFlight.size;
          });
      }
    } catch (err) {
      log({ level: "error", msg: "tick failed", error: err });
    }

    await sleep(opts.pollIntervalMs, signal);
  }

  log({ level: "info", msg: `orchestrator stopping; waiting for ${String(inFlight.size)} in-flight worker(s)` });
  while (inFlight.size > 0) {
    await sleep(200);
  }
  log({
    level: "info",
    msg:
      `orchestrator stopped. dispatched=${String(metrics.totalDispatched)} ` +
      `succeeded=${String(metrics.totalSucceeded)} failed=${String(metrics.totalFailed)} ` +
      `cancelled=${String(metrics.totalCancelled)} ` +
      `tokens(in/out/total)=${String(metrics.tokens.input)}/${String(metrics.tokens.output)}/${String(metrics.tokens.total)}`,
  });
}

async function processIssue(
  issue: Readonly<Issue>,
  config: OrchestratorConfig,
  opts: RuntimeOptions,
  log: (r: LogRecord) => void,
  metrics: RunMetrics,
): Promise<void> {
  const issueId = issue.id;
  const issueIid = issue.iid;

  log({ level: "info", msg: "claiming", issueId, issueIid, agent: config.agent.name });
  await config.tracker.transitionLabels(issueId, {
    add: [opts.labels.running],
    remove: [opts.labels.ready],
  });

  let workspace;
  try {
    workspace = await config.workspace.ensure(issue);
  } catch (err) {
    log({ level: "error", msg: "workspace ensure failed", issueId, issueIid, error: err });
    await finalize(config, issueId, opts, {
      status: "failed",
      summary: "Workspace preparation failed before the agent could run.",
      error: stringifyError(err),
    }).catch((postErr: unknown) => {
      log({ level: "error", msg: "label finalize after workspace failure failed", issueId, issueIid, error: postErr });
    });
    metrics.totalFailed++;
    return;
  }

  // Reconciliation watcher: if the tracker reports the issue closed or the
  // running label disappears externally, abort the in-flight agent.
  const reconcileAC = new AbortController();
  const reconcileTimer =
    opts.reconciliationIntervalMs > 0
      ? startReconciler({
          tracker: config.tracker,
          issueId,
          issueIid,
          intervalMs: opts.reconciliationIntervalMs,
          runningLabel: opts.labels.running,
          orchestratorSignal: config.signal,
          onTerminate: (reason) => {
            log({ level: "info", msg: `reconciliation terminating in-flight agent: ${reason}`, issueId, issueIid });
            reconcileAC.abort();
          },
          log,
        })
      : null;

  let lastResult: AgentResult | undefined;

  try {
    let turnNumber = 1;
    while (turnNumber <= opts.maxTurns && !isAborted(config.signal) && !reconcileAC.signal.aborted) {
      const turnResult = await runTurnWithRetry({
        config,
        issue,
        workspacePath: workspace.path,
        turnNumber,
        opts,
        reconcileSignal: reconcileAC.signal,
        previousTurnResult: lastResult,
        log,
        metrics,
      });
      lastResult = turnResult;

      // Per-turn note so each turn is visible to the operator.
      await config.tracker.postNote(issueId, formatNote(config.agent.name, turnNumber, turnResult)).catch(
        (err: unknown) => {
          log({ level: "error", msg: "postNote failed", issueId, issueIid, error: err });
        },
      );

      if (turnResult.status === "cancelled") {
        log({ level: "info", msg: `turn ${String(turnNumber)} cancelled — stopping turn loop`, issueId, issueIid });
        break;
      }
      if (turnResult.status !== "succeeded") {
        log({ level: "info", msg: `turn ${String(turnNumber)} ended with ${turnResult.status} — stopping turn loop`, issueId, issueIid });
        break;
      }

      // Continuation check: only if continueLabel is configured and still present.
      if (opts.continueLabel === undefined) {
        break;
      }
      if (turnNumber + 1 > opts.maxTurns) {
        log({ level: "info", msg: `maxTurns=${String(opts.maxTurns)} reached after successful turn`, issueId, issueIid });
        break;
      }
      let stillContinue = false;
      try {
        const refreshed = await config.tracker.getIssue(issueId);
        stillContinue = refreshed.labels.includes(opts.continueLabel);
      } catch (err) {
        log({ level: "warn", msg: "getIssue for continuation check failed; ending turn loop", issueId, issueIid, error: err });
      }
      if (!stillContinue) {
        log({ level: "info", msg: `continueLabel '${opts.continueLabel}' not present — ending turn loop`, issueId, issueIid });
        break;
      }
      turnNumber++;
    }

    const finalResult: AgentResult =
      lastResult ?? {
        status: "failed",
        summary: "no turns ran for this issue",
      };

    if (finalResult.status === "succeeded") metrics.totalSucceeded++;
    else if (finalResult.status === "cancelled") metrics.totalCancelled++;
    else metrics.totalFailed++;

    await finalizeLabels(config, issueId, opts, finalResult).catch((err: unknown) => {
      log({ level: "error", msg: "finalize labels failed", issueId, issueIid, error: err });
    });
  } finally {
    reconcileTimer?.stop();
  }
}

interface TurnArgs {
  readonly config: OrchestratorConfig;
  readonly issue: Readonly<Issue>;
  readonly workspacePath: string;
  readonly turnNumber: number;
  readonly opts: RuntimeOptions;
  readonly reconcileSignal: AbortSignal;
  readonly previousTurnResult: AgentResult | undefined;
  readonly log: (r: LogRecord) => void;
  readonly metrics: RunMetrics;
}

async function runTurnWithRetry(args: TurnArgs): Promise<AgentResult> {
  const { config, issue, workspacePath, turnNumber, opts, reconcileSignal, previousTurnResult, log, metrics } = args;
  const issueId = issue.id;
  const issueIid = issue.iid;
  let lastResult: AgentResult = {
    status: "failed",
    summary: "no attempts ran",
  };

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    if (isAborted(config.signal) || reconcileSignal.aborted) {
      lastResult = {
        status: "cancelled",
        summary: `cancelled before attempt ${String(attempt)}`,
      };
      break;
    }

    const promptInput: Parameters<typeof config.prompt.build>[0] = {
      issue,
      turnNumber,
      attempt,
      ...(previousTurnResult !== undefined ? { previousTurnResult } : {}),
    };
    const prompt = await config.prompt.build(promptInput);

    const combinedSignal = combineSignals(config.signal, reconcileSignal);
    log({
      level: "info",
      msg: `dispatching turn=${String(turnNumber)} attempt=${String(attempt)}`,
      issueId,
      issueIid,
      agent: config.agent.name,
    });

    const agentInput: Parameters<typeof config.agent.run>[0] = {
      workspacePath,
      prompt,
      issue,
      turnNumber,
      attempt,
      ...(combinedSignal !== undefined ? { signal: combinedSignal } : {}),
    };

    let result: AgentResult;
    try {
      result = await config.agent.run(agentInput);
    } catch (err) {
      result = {
        status: "failed",
        summary: "Agent threw during execution.",
        error: stringifyError(err),
      };
    }
    lastResult = result;
    if (result.tokens !== undefined) {
      addTokens(metrics.tokens, result.tokens);
    }

    log({
      level: "info",
      msg: `turn=${String(turnNumber)} attempt=${String(attempt)} status=${result.status}`,
      issueId,
      issueIid,
      agent: config.agent.name,
    });

    if (result.status === "succeeded") return result;
    if (result.status === "cancelled") return result;

    // failed | timed-out → retry if attempts remain
    if (attempt < opts.maxAttempts) {
      const backoff = Math.min(opts.retryBackoffBaseMs * 2 ** (attempt - 1), opts.maxRetryBackoffMs);
      log({
        level: "warn",
        msg: `retrying after ${String(backoff)}ms (attempt ${String(attempt + 1)}/${String(opts.maxAttempts)})`,
        issueId,
        issueIid,
      });
      await sleep(backoff, combinedSignal);
      if (combinedSignal !== undefined && combinedSignal.aborted) {
        return {
          status: "cancelled",
          summary: `cancelled during retry backoff after attempt ${String(attempt)}`,
        };
      }
    }
  }

  return lastResult;
}

interface ReconcilerArgs {
  readonly tracker: OrchestratorConfig["tracker"];
  readonly issueId: string;
  readonly issueIid: string;
  readonly intervalMs: number;
  readonly runningLabel: string;
  readonly orchestratorSignal: AbortSignal | undefined;
  readonly onTerminate: (reason: string) => void;
  readonly log: (r: LogRecord) => void;
}

interface ReconcilerHandle {
  stop(): void;
}

function startReconciler(args: ReconcilerArgs): ReconcilerHandle {
  let cancelled = false;
  const tick = async (): Promise<void> => {
    if (cancelled) return;
    if (isAborted(args.orchestratorSignal)) return;
    try {
      const refreshed = await args.tracker.getIssue(args.issueId);
      if (cancelled) return;
      if (refreshed.state !== "opened") {
        args.onTerminate(`issue moved to state=${refreshed.state}`);
        return;
      }
      if (!refreshed.labels.includes(args.runningLabel)) {
        args.onTerminate(`running label '${args.runningLabel}' removed externally`);
        return;
      }
    } catch (err) {
      // Transient errors should not kill the in-flight worker; log and try again next tick.
      args.log({ level: "warn", msg: "reconciliation fetch failed (will retry)", issueId: args.issueId, issueIid: args.issueIid, error: err });
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, args.intervalMs);

  return {
    stop(): void {
      cancelled = true;
      clearInterval(timer);
    },
  };
}

async function finalizeLabels(
  config: OrchestratorConfig,
  issueId: string,
  opts: RuntimeOptions,
  result: AgentResult,
): Promise<void> {
  const isSuccess = result.status === "succeeded";
  await config.tracker.transitionLabels(issueId, {
    add: [isSuccess ? opts.labels.done : opts.labels.failed],
    remove: [opts.labels.running, opts.labels.ready],
  });
}

async function finalize(
  config: OrchestratorConfig,
  issueId: string,
  opts: RuntimeOptions,
  result: AgentResult,
): Promise<void> {
  await config.tracker.postNote(issueId, formatNote(config.agent.name, 1, result));
  await finalizeLabels(config, issueId, opts, result);
}

function formatNote(agentName: string, turnNumber: number, result: AgentResult): string {
  const header = `🤖 **${agentName}** — turn ${String(turnNumber)} — \`${result.status}\``;
  const body: string[] = [header, "", result.summary];
  if (result.error !== undefined && result.error.length > 0) {
    body.push("", "<details><summary>error</summary>", "", "```", result.error, "```", "</details>");
  }
  if (result.tokens !== undefined) {
    body.push(
      "",
      `**tokens** in=${String(result.tokens.input)} out=${String(result.tokens.output)} total=${String(result.tokens.total)}`,
    );
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

function resolveOpts(config: OrchestratorConfig): RuntimeOptions {
  return {
    labels: mergeLabels(config.labels),
    pollIntervalMs: config.pollIntervalMs ?? DEFAULTS.pollIntervalMs,
    maxConcurrent: config.maxConcurrent ?? DEFAULTS.maxConcurrent,
    maxAttempts: config.maxAttempts ?? DEFAULTS.maxAttempts,
    retryBackoffBaseMs: config.retryBackoffBaseMs ?? DEFAULTS.retryBackoffBaseMs,
    maxRetryBackoffMs: config.maxRetryBackoffMs ?? DEFAULTS.maxRetryBackoffMs,
    maxTurns: config.maxTurns ?? DEFAULTS.maxTurns,
    continueLabel: config.continueLabel,
    reconciliationIntervalMs: config.reconciliationIntervalMs ?? DEFAULTS.reconciliationIntervalMs,
  };
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

function addTokens(acc: { input: number; output: number; total: number }, t: AgentTokens): void {
  acc.input += t.input;
  acc.output += t.output;
  acc.total += t.total;
}

function combineSignals(
  parent: AbortSignal | undefined,
  child: AbortSignal,
): AbortSignal {
  if (parent === undefined) return child;
  // AbortSignal.any is available since Node 20.3.
  return AbortSignal.any([parent, child]);
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
