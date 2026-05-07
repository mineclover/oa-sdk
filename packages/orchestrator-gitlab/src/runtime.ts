import type { Issue } from "./types.js";

export interface InFlightInfo {
  readonly issue: Readonly<Issue>;
  readonly agentName: string;
  readonly startedAt: number;
  /** 1-based current turn within the worker session. */
  turnNumber: number;
  /** 1-based current attempt within the current turn. */
  attempt: number;
  /** Last status seen on the most recently completed turn (or undefined if mid-first-turn). */
  lastTurnStatus?: string;
}

export interface RunMetrics {
  inFlight: number;
  totalDispatched: number;
  totalSucceeded: number;
  totalFailed: number;
  totalCancelled: number;
  tokens: { input: number; output: number; total: number };
}

export interface RuntimeError {
  readonly msg: string;
  readonly at: number;
}

/**
 * Mutable runtime state shared by `run()`, the HTTP server, and the hot-reload
 * watcher. Callers may read this directly for observability; mutation is
 * orchestrator-internal.
 *
 * The shape stays stable across releases — additions are non-breaking, removals
 * are breaking. Treat as a public API for embedders.
 */
export class OrchestratorRuntime {
  startedAt = 0;
  shuttingDown = false;
  readonly inFlight: Map<string, InFlightInfo> = new Map();
  readonly metrics: RunMetrics = {
    inFlight: 0,
    totalDispatched: 0,
    totalSucceeded: 0,
    totalFailed: 0,
    totalCancelled: 0,
    tokens: { input: 0, output: 0, total: 0 },
  };
  /** Last orchestrator-level error (per tick). Per-worker errors are not tracked here. */
  lastError: RuntimeError | undefined;
  /** Number of successful WORKFLOW.md hot reloads. */
  reloadCount = 0;
  /** Last reload error, if any. Cleared on next successful reload. */
  lastReloadError: RuntimeError | undefined;
}

/** Read-only snapshot suitable for JSON serialization (HTTP `/state` endpoint). */
export interface RuntimeSnapshot {
  readonly startedAt: number;
  readonly uptimeMs: number;
  readonly shuttingDown: boolean;
  readonly inFlight: ReadonlyArray<InFlightSnapshot>;
  readonly metrics: Readonly<RunMetrics>;
  readonly lastError: RuntimeError | undefined;
  readonly reloadCount: number;
  readonly lastReloadError: RuntimeError | undefined;
}

export interface InFlightSnapshot {
  readonly issueId: string;
  readonly issueIid: string;
  readonly title: string;
  readonly url: string;
  readonly agent: string;
  readonly turnNumber: number;
  readonly attempt: number;
  readonly startedAt: number;
  readonly elapsedMs: number;
  readonly lastTurnStatus: string | undefined;
}

export function snapshot(rt: OrchestratorRuntime, now = Date.now()): RuntimeSnapshot {
  const inFlight: InFlightSnapshot[] = [];
  for (const [id, v] of rt.inFlight) {
    inFlight.push({
      issueId: id,
      issueIid: v.issue.iid,
      title: v.issue.title,
      url: v.issue.url,
      agent: v.agentName,
      turnNumber: v.turnNumber,
      attempt: v.attempt,
      startedAt: v.startedAt,
      elapsedMs: Math.max(0, now - v.startedAt),
      lastTurnStatus: v.lastTurnStatus,
    });
  }
  return {
    startedAt: rt.startedAt,
    uptimeMs: rt.startedAt > 0 ? Math.max(0, now - rt.startedAt) : 0,
    shuttingDown: rt.shuttingDown,
    inFlight,
    metrics: { ...rt.metrics, tokens: { ...rt.metrics.tokens } },
    lastError: rt.lastError,
    reloadCount: rt.reloadCount,
    lastReloadError: rt.lastReloadError,
  };
}
