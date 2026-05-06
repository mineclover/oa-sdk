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
