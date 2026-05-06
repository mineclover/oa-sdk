/**
 * Normalized issue model. The Tracker adapter is responsible for mapping its
 * native issue payload into this shape.
 */
export interface Issue {
  /** Stable internal id (GitLab returns a numeric id; we keep it as string for portability). */
  readonly id: string;
  /** Human-readable identifier — for GitLab this is the per-project issue IID (`#42`). */
  readonly iid: string;
  readonly title: string;
  readonly description: string;
  readonly labels: ReadonlyArray<string>;
  readonly url: string;
  readonly state: string;
  readonly authorUsername: string | undefined;
  readonly updatedAt: string;
}

export interface LabelConfig {
  readonly ready: string;
  readonly running: string;
  readonly done: string;
  readonly failed: string;
}

export const DEFAULT_LABELS: LabelConfig = {
  ready: "agent-ready",
  running: "agent-running",
  done: "agent-done",
  failed: "agent-failed",
};

/**
 * Workspace assigned to one issue for the lifetime of an agent run.
 */
export interface Workspace {
  readonly path: string;
  readonly key: string;
  readonly createdNow: boolean;
}

export interface AgentInput {
  readonly workspacePath: string;
  readonly prompt: string;
  readonly issue: Readonly<Issue>;
  readonly env?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
}

export interface AgentArtifacts {
  readonly branch?: string;
  readonly commits?: ReadonlyArray<string>;
  readonly mrUrl?: string;
}

export type AgentStatus = "succeeded" | "failed" | "timed-out" | "cancelled";

export interface AgentResult {
  readonly status: AgentStatus;
  readonly summary: string;
  readonly error?: string;
  readonly artifacts?: AgentArtifacts;
}

export interface Agent {
  readonly name: string;
  run(input: AgentInput): Promise<AgentResult>;
}

export interface PromptBuilder {
  build(issue: Readonly<Issue>): string | Promise<string>;
}

export interface Tracker {
  /** Fetch issues currently eligible for dispatch (e.g. labelled as ready, not running/done/failed). */
  listEligibleIssues(labels: LabelConfig): Promise<ReadonlyArray<Issue>>;
  /** Atomically transition labels — orchestrator uses this to claim, complete, or fail an issue. */
  transitionLabels(
    issueId: string,
    transition: { add?: ReadonlyArray<string>; remove?: ReadonlyArray<string> },
  ): Promise<void>;
  /** Post a note (comment) on the issue. */
  postNote(issueId: string, body: string): Promise<void>;
}

export interface WorkspaceManager {
  /** Idempotently ensure a workspace for the given issue exists. */
  ensure(issue: Readonly<Issue>): Promise<Workspace>;
}
