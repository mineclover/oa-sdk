import type {
  Agent,
  LabelConfig,
  PromptBuilder,
  Tracker,
  WorkspaceManager,
} from "./types.js";

export interface OrchestratorConfig {
  readonly tracker: Tracker;
  readonly workspace: WorkspaceManager;
  readonly agent: Agent;
  readonly prompt: PromptBuilder;
  readonly pollIntervalMs?: number;
  readonly labels?: Partial<LabelConfig>;
  readonly maxConcurrent?: number;
  /** Per-turn retry cap. Default 1 (no retry). On `failed`/`timed-out`, retries with exponential backoff up to this many attempts before giving up on the turn. `cancelled` never retries. */
  readonly maxAttempts?: number;
  /** Base for the exponential backoff between retries: actualBackoff = min(base * 2^(attempt-1), max). Default 1_000ms. */
  readonly retryBackoffBaseMs?: number;
  /** Cap on retry backoff. Default 300_000ms (5 minutes). */
  readonly maxRetryBackoffMs?: number;
  /** Maximum continuation turns within one worker session. Default 1 (no continuation). For continuation to actually happen, `continueLabel` must also be set and remain on the issue after a successful turn. */
  readonly maxTurns?: number;
  /** When set, after a successful turn the orchestrator re-fetches the issue and runs another turn iff this label is still present (and turn count is below `maxTurns`). */
  readonly continueLabel?: string;
  /** How often the reconciliation watcher refetches the issue to detect external state changes (closed, label removed, etc.). Default 15_000ms. Set 0 to disable. */
  readonly reconciliationIntervalMs?: number;
  readonly signal?: AbortSignal;
  /** Logger sink. Defaults to console for dev; tests can substitute a buffer. */
  readonly log?: (record: LogRecord) => void;
}

export interface LogRecord {
  readonly level: "debug" | "info" | "warn" | "error";
  readonly msg: string;
  readonly issueId?: string;
  readonly issueIid?: string;
  readonly agent?: string;
  readonly error?: unknown;
  readonly extra?: Record<string, unknown>;
}

export const DEFAULTS = {
  pollIntervalMs: 30_000,
  maxConcurrent: 5,
  maxAttempts: 1,
  retryBackoffBaseMs: 1_000,
  maxRetryBackoffMs: 300_000,
  maxTurns: 1,
  reconciliationIntervalMs: 15_000,
} as const;

export function defaultLog(record: LogRecord): void {
  const tag = record.issueIid !== undefined ? ` issue=${record.issueIid}` : "";
  const agent = record.agent !== undefined ? ` agent=${record.agent}` : "";
  const line = `[${record.level}]${tag}${agent} ${record.msg}`;
  if (record.level === "error") {
    console.error(line, record.error ?? "");
  } else {
    console.log(line);
  }
}
