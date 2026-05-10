import { DEFAULTS, defaultLog, type LogRecord, type OrchestratorConfig } from "./config.js";
import { startHttpServer, type HttpServerHandle } from "./http-server.js";
import { isLiveConfigProvider, LiveConfigProvider } from "./live-config.js";
import {
  recordDispatched,
  recordTurn,
  recordWorkerExit,
  startProcessIssueSpan,
  startTurnSpan,
} from "./otel.js";
import { OrchestratorRuntime } from "./runtime.js";
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

export type ConfigInput = OrchestratorConfig | LiveConfigProvider;

export interface RunOptions {
  /** Inject a runtime so HTTP server / external observers can read live state. */
  readonly runtime?: OrchestratorRuntime;
}

/**
 * Run the orchestrator until the configured signal aborts. Single-instance.
 *
 * Accepts either a static `OrchestratorConfig` (snapshot at startup) or a
 * `LiveConfigProvider` whose `current()` is consulted every tick — Phase C.3
 * hot reload uses the latter.
 *
 * Phase B.2 + C.3 + Ops semantics:
 *   - per-turn retry with exponential backoff
 *   - continuation turns up to `maxTurns` when `continueLabel` remains set
 *   - reconciliation watcher cancels in-flight agent on issue close or running-label removal
 *   - token usage aggregation across runs (logged at shutdown)
 *   - hot reload via LiveConfigProvider — opts re-resolved each tick / dispatch / turn
 *   - optional observability HTTP server when `httpPort` is set
 */
export async function run(input: ConfigInput, options: RunOptions = {}): Promise<void> {
  const getConfig = (): OrchestratorConfig =>
    isLiveConfigProvider(input) ? input.current() : input;

  const initialConfig = getConfig();
  const log = initialConfig.log ?? defaultLog;
  const signal = initialConfig.signal;
  const runtime = options.runtime ?? new OrchestratorRuntime();
  runtime.startedAt = Date.now();

  let httpHandle: HttpServerHandle | undefined;
  if (initialConfig.httpPort !== undefined) {
    try {
      httpHandle = await startHttpServer(runtime, {
        host: initialConfig.httpHost ?? "127.0.0.1",
        port: initialConfig.httpPort,
        ...(initialConfig.httpAuthToken !== undefined ? { authToken: initialConfig.httpAuthToken } : {}),
      });
      log({ level: "info", msg: `http server listening on ${initialConfig.httpHost ?? "127.0.0.1"}:${String(httpHandle.port)}` });
    } catch (err) {
      log({ level: "error", msg: "failed to start observability http server", error: err });
    }
  }

  const opts0 = resolveOpts(initialConfig);
  log({
    level: "info",
    msg:
      `orchestrator starting agent=${initialConfig.agent.name} ` +
      `pollIntervalMs=${String(opts0.pollIntervalMs)} maxConcurrent=${String(opts0.maxConcurrent)} ` +
      `maxAttempts=${String(opts0.maxAttempts)} maxTurns=${String(opts0.maxTurns)}` +
      (opts0.continueLabel !== undefined ? ` continueLabel=${opts0.continueLabel}` : "") +
      ` reconciliationIntervalMs=${String(opts0.reconciliationIntervalMs)}` +
      (isLiveConfigProvider(input) ? " hotReload=on" : ""),
  });

  while (!isAborted(signal)) {
    try {
      const cfg = getConfig();
      const opts = resolveOpts(cfg);
      const issues = await cfg.tracker.listEligibleIssues(opts.labels);
      for (const issue of issues) {
        if (isAborted(signal)) break;
        if (runtime.inFlight.has(issue.id)) continue;
        if (runtime.inFlight.size >= opts.maxConcurrent) break;

        runtime.inFlight.set(issue.id, {
          issue,
          agentName: cfg.agent.name,
          startedAt: Date.now(),
          turnNumber: 1,
          attempt: 1,
        });
        runtime.metrics.inFlight = runtime.inFlight.size;
        runtime.metrics.totalDispatched++;
        recordDispatched(issue, cfg.agent.name);

        void processIssue(issue, getConfig, runtime, log)
          .catch((err: unknown) => {
            log({ level: "error", msg: "unhandled processIssue rejection", issueId: issue.id, issueIid: issue.iid, error: err });
          })
          .finally(() => {
            runtime.inFlight.delete(issue.id);
            runtime.metrics.inFlight = runtime.inFlight.size;
          });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      runtime.lastError = { msg, at: Date.now() };
      log({ level: "error", msg: "tick failed", error: err });
    }

    await sleep(resolveOpts(getConfig()).pollIntervalMs, signal);
  }

  runtime.shuttingDown = true;
  log({ level: "info", msg: `orchestrator stopping; waiting for ${String(runtime.inFlight.size)} in-flight worker(s)` });
  while (runtime.inFlight.size > 0) {
    await sleep(200);
  }

  if (httpHandle !== undefined) {
    try {
      await httpHandle.close();
    } catch (err) {
      log({ level: "warn", msg: "http server close failed", error: err });
    }
  }

  log({
    level: "info",
    msg:
      `orchestrator stopped. dispatched=${String(runtime.metrics.totalDispatched)} ` +
      `succeeded=${String(runtime.metrics.totalSucceeded)} failed=${String(runtime.metrics.totalFailed)} ` +
      `cancelled=${String(runtime.metrics.totalCancelled)} ` +
      `tokens(in/out/total)=${String(runtime.metrics.tokens.input)}/${String(runtime.metrics.tokens.output)}/${String(runtime.metrics.tokens.total)}` +
      ` reloads=${String(runtime.reloadCount)}`,
  });
}

async function processIssue(
  issue: Readonly<Issue>,
  getConfig: () => OrchestratorConfig,
  runtime: OrchestratorRuntime,
  log: (r: LogRecord) => void,
): Promise<void> {
  const issueId = issue.id;
  const issueIid = issue.iid;
  const cfg0 = getConfig();
  const opts0 = resolveOpts(cfg0);

  log({ level: "info", msg: "claiming", issueId, issueIid, agent: cfg0.agent.name });
  await cfg0.tracker.transitionLabels(issueId, {
    add: [opts0.labels.running],
    remove: [opts0.labels.ready],
  });

  let workspace;
  try {
    workspace = await cfg0.workspace.ensure(issue);
  } catch (err) {
    log({ level: "error", msg: "workspace ensure failed", issueId, issueIid, error: err });
    await finalize(cfg0, issueId, opts0, {
      status: "failed",
      summary: "Workspace preparation failed before the agent could run.",
      error: stringifyError(err),
    }).catch((postErr: unknown) => {
      log({ level: "error", msg: "label finalize after workspace failure failed", issueId, issueIid, error: postErr });
    });
    runtime.metrics.totalFailed++;
    return;
  }

  // Reconciliation watcher
  const reconcileAC = new AbortController();
  const reconcileTimer =
    opts0.reconciliationIntervalMs > 0
      ? startReconciler({
          getConfig,
          issueId,
          issueIid,
          intervalMs: opts0.reconciliationIntervalMs,
          orchestratorSignal: cfg0.signal,
          onTerminate: (reason) => {
            log({ level: "info", msg: `reconciliation terminating in-flight agent: ${reason}`, issueId, issueIid });
            reconcileAC.abort();
          },
          log,
        })
      : null;

  let lastResult: AgentResult | undefined;

  const issueSpan = startProcessIssueSpan(issue, cfg0.agent.name);

  try {
    let turnNumber = 1;
    // maxTurns is read fresh per outer iteration so a hot reload between turns can extend / contract the loop.
    while (turnNumber <= resolveOpts(getConfig()).maxTurns && !isAborted(getConfig().signal) && !reconcileAC.signal.aborted) {
      const inFlightInfo = runtime.inFlight.get(issueId);
      if (inFlightInfo !== undefined) {
        inFlightInfo.turnNumber = turnNumber;
        inFlightInfo.attempt = 1;
      }
      const turnStart = Date.now();
      const turnResult = await runTurnWithRetry({
        getConfig,
        issue,
        workspacePath: workspace.path,
        turnNumber,
        reconcileSignal: reconcileAC.signal,
        previousTurnResult: lastResult,
        log,
        runtime,
      });
      const turnDurationMs = Math.max(0, Date.now() - turnStart);
      lastResult = turnResult;
      if (inFlightInfo !== undefined) {
        inFlightInfo.lastTurnStatus = turnResult.status;
      }

      const histAgent = inFlightInfo?.agentName ?? getConfig().agent.name;
      const summary = turnResult.summary ?? "";
      const historyEntry = {
        at: turnStart,
        turnNumber,
        attempt: inFlightInfo?.attempt ?? 1,
        status: turnResult.status,
        durationMs: turnDurationMs,
        agent: histAgent,
        summarySnippet: summary.length > 256 ? `${summary.slice(0, 253)}...` : summary,
        ...(turnResult.tokens !== undefined ? { tokens: turnResult.tokens } : {}),
      };
      runtime.appendHistory(issueId, historyEntry);
      recordTurn(issue, histAgent, turnNumber, turnDurationMs, turnResult);

      const cfg = getConfig();
      await cfg.tracker.postNote(issueId, formatNote(cfg.agent.name, turnNumber, turnResult)).catch(
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

      const continueOpts = resolveOpts(getConfig());
      if (continueOpts.continueLabel === undefined) break;
      if (turnNumber + 1 > continueOpts.maxTurns) {
        log({ level: "info", msg: `maxTurns=${String(continueOpts.maxTurns)} reached after successful turn`, issueId, issueIid });
        break;
      }
      let stillContinue = false;
      try {
        const refreshed = await getConfig().tracker.getIssue(issueId);
        stillContinue = refreshed.labels.includes(continueOpts.continueLabel);
      } catch (err) {
        log({ level: "warn", msg: "getIssue for continuation check failed; ending turn loop", issueId, issueIid, error: err });
      }
      if (!stillContinue) {
        log({ level: "info", msg: `continueLabel '${continueOpts.continueLabel}' not present — ending turn loop`, issueId, issueIid });
        break;
      }
      turnNumber++;
    }

    const finalResult: AgentResult =
      lastResult ?? {
        status: "failed",
        summary: "no turns ran for this issue",
      };

    if (finalResult.status === "succeeded") runtime.metrics.totalSucceeded++;
    else if (finalResult.status === "cancelled") runtime.metrics.totalCancelled++;
    else runtime.metrics.totalFailed++;

    recordWorkerExit(issue, cfg0.agent.name, finalResult.status);
    issueSpan.end(finalResult);

    const finalCfg = getConfig();
    const finalOpts = resolveOpts(finalCfg);
    await finalizeLabels(finalCfg, issueId, finalOpts, finalResult).catch((err: unknown) => {
      log({ level: "error", msg: "finalize labels failed", issueId, issueIid, error: err });
    });
  } finally {
    reconcileTimer?.stop();
  }
}

interface TurnArgs {
  readonly getConfig: () => OrchestratorConfig;
  readonly issue: Readonly<Issue>;
  readonly workspacePath: string;
  readonly turnNumber: number;
  readonly reconcileSignal: AbortSignal;
  readonly previousTurnResult: AgentResult | undefined;
  readonly log: (r: LogRecord) => void;
  readonly runtime: OrchestratorRuntime;
}

async function runTurnWithRetry(args: TurnArgs): Promise<AgentResult> {
  const { getConfig, issue, workspacePath, turnNumber, reconcileSignal, previousTurnResult, log, runtime } = args;
  const issueId = issue.id;
  const issueIid = issue.iid;
  let lastResult: AgentResult = {
    status: "failed",
    summary: "no attempts ran",
  };

  // Re-resolve opts at attempt boundaries so a hot-reloaded maxAttempts/backoff takes effect mid-turn.
  let attemptOpts = resolveOpts(getConfig());

  for (let attempt = 1; attempt <= attemptOpts.maxAttempts; attempt++) {
    const cfg = getConfig();
    if (isAborted(cfg.signal) || reconcileSignal.aborted) {
      lastResult = {
        status: "cancelled",
        summary: `cancelled before attempt ${String(attempt)}`,
      };
      break;
    }

    const inFlightInfo = runtime.inFlight.get(issueId);
    if (inFlightInfo !== undefined) {
      inFlightInfo.attempt = attempt;
    }
    const combinedSignal = combineSignals(cfg.signal, reconcileSignal);

    const attemptSpan = startTurnSpan(issue, cfg.agent.name, turnNumber, attempt);
    let result: AgentResult;
    try {
      const promptInput: Parameters<typeof cfg.prompt.build>[0] = {
        issue,
        turnNumber,
        attempt,
        ...(previousTurnResult !== undefined ? { previousTurnResult } : {}),
      };
      const prompt = await cfg.prompt.build(promptInput);

      log({
        level: "info",
        msg: `dispatching turn=${String(turnNumber)} attempt=${String(attempt)}`,
        issueId,
        issueIid,
        agent: cfg.agent.name,
      });

      const agentInput: Parameters<typeof cfg.agent.run>[0] = {
        workspacePath,
        prompt,
        issue,
        turnNumber,
        attempt,
        ...(combinedSignal !== undefined ? { signal: combinedSignal } : {}),
      };

      try {
        result = await cfg.agent.run(agentInput);
      } catch (err) {
        result = {
          status: "failed",
          summary: "Agent threw during execution.",
          error: stringifyError(err),
        };
      }
    } catch (err) {
      result = {
        status: "failed",
        summary: "Prompt build failed.",
        error: stringifyError(err),
      };
    }
    attemptSpan.end(result);
    lastResult = result;
    if (result.tokens !== undefined) {
      addTokens(runtime.metrics.tokens, result.tokens);
    }

    log({
      level: "info",
      msg: `turn=${String(turnNumber)} attempt=${String(attempt)} status=${result.status}`,
      issueId,
      issueIid,
      agent: cfg.agent.name,
    });

    if (result.status === "succeeded") return result;
    if (result.status === "cancelled") return result;

    attemptOpts = resolveOpts(getConfig());
    if (attempt < attemptOpts.maxAttempts) {
      const backoff = Math.min(attemptOpts.retryBackoffBaseMs * 2 ** (attempt - 1), attemptOpts.maxRetryBackoffMs);
      log({
        level: "warn",
        msg: `retrying after ${String(backoff)}ms (attempt ${String(attempt + 1)}/${String(attemptOpts.maxAttempts)})`,
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
  readonly getConfig: () => OrchestratorConfig;
  readonly issueId: string;
  readonly issueIid: string;
  readonly intervalMs: number;
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
      const cfg = args.getConfig();
      const labels = resolveOpts(cfg).labels;
      const refreshed = await cfg.tracker.getIssue(args.issueId);
      if (cancelled) return;
      if (refreshed.state !== "opened") {
        args.onTerminate(`issue moved to state=${refreshed.state}`);
        return;
      }
      if (!refreshed.labels.includes(labels.running)) {
        args.onTerminate(`running label '${labels.running}' removed externally`);
        return;
      }
    } catch (err) {
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
