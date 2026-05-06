# PRD — `@oa-sdk/orchestrator-gitlab` Phase A (MVP)

## Background

Symphony's [SPEC](https://github.com/openai/symphony/blob/main/SPEC.md) defines an excellent shape for issue-driven coding-agent orchestration but its current SPEC §5.3.1 only supports `tracker.kind: linear`. Forking Symphony to add a GitLab tracker carries permanent upstream-merge friction; building a Linear-shaped proxy in front of GitLab requires faking a GraphQL surface for marginal gain. This package takes the third path: **reimplement the orchestrator natively for GitLab in TypeScript, treating Symphony's SPEC as a design reference rather than a code dependency**.

## Goal

A local TypeScript service that, given a GitLab project and an agent factory, polls GitLab issues with a known label, spins up an isolated workspace per issue, runs a pluggable coding agent inside, and reports the agent's outcome back to the issue as a note. Phase A is the smallest version of this loop that is end-to-end demoable.

## Non-goals (deferred)

| Item | Deferred to |
|------|-------------|
| Retry with exponential backoff | Phase B |
| State reconciliation (cancel running agents when issue closes) | Phase B |
| `max_turns` continuation (multi-turn within one worker session) | Phase B |
| `WORKFLOW.md`-compatible config + Liquid prompt templating | Phase C |
| Hot reload of config | Phase C |
| Restart recovery (durable orchestrator state) | Out of scope (tracker-driven) |
| Web dashboard / Phoenix LiveView equivalent | Out of scope |
| Sandbox enforcement beyond what the agent itself provides | Out of scope (Codex/Claude own this) |

## Key decisions

### D1. Multi-agent from day one
The `Agent` interface is the only seam between the orchestrator and the underlying coding tool. Phase A ships an `EchoAgent` (deterministic, used for tests + dry-run) and a `CodexAgent` (subprocess wrapper around the `codex` CLI). A `ClaudeAgent` shell exists as a stub; concrete implementation lands in Phase B once we settle on Claude Agent SDK vs `claude --print` headless mode.

### D2. Issue eligibility uses labels, not state
GitLab issues do not have a Linear-style structured workflow state. Phase A uses labels as the eligibility signal:

| Label | Meaning |
|-------|---------|
| `agent-ready` | Picked up by orchestrator on next tick |
| `agent-running` | Orchestrator added when claiming; prevents double-dispatch across orchestrator instances |
| `agent-done` | Added on agent success; orchestrator skips |
| `agent-failed` | Added on agent failure; orchestrator skips (operator inspects) |

These labels are configurable.

### D3. Programmatic config, no `WORKFLOW.md` yet
Phase A loads config from a TS module (`config.ts`) that the operator authors. This avoids the up-front cost of a templating engine and YAML schema. Phase C will add a `WORKFLOW.md`-compatible reader so existing Symphony users can carry their config across.

### D4. In-memory state only
Following Symphony's "tracker-driven recovery" stance (SPEC §2.1, §7.4), the orchestrator keeps no durable state. Restart re-derives claimed/running sets from the labels in GitLab. The trade-off: a crash between "spawn agent" and "label as running" can re-dispatch one issue. Phase B will tighten this with a label-write-before-spawn ordering.

### D5. Workspace identifier is the issue IID
Workspace path = `<workspaceRoot>/<projectSlug>-<issueIid>`. The slug is sanitized (`[A-Za-z0-9._-]` only). This matches Symphony §4.2 normalization.

### D6. Comments back to GitLab are agent-authored, summarized by orchestrator
The agent returns a structured `AgentResult` (status + summary + optional artifacts). The orchestrator formats this into a GitLab note. The agent is not given GitLab write tokens directly (Phase A) — keeps the agent unaware of the tracker and avoids leaking credentials into agent-managed processes.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       orchestrator                              │
│  ┌──────────────┐   ┌──────────────────┐   ┌─────────────────┐ │
│  │   Tracker    │──▶│    Workspace     │──▶│      Agent      │ │
│  │  (GitLab)    │   │     Manager      │   │  (Codex/Claude/ │ │
│  │              │   │                  │   │      Echo)      │ │
│  └──────┬───────┘   └──────────────────┘   └────────┬────────┘ │
│         │                                            │          │
│         │                  AgentResult               │          │
│         ◀────────────────────────────────────────────┘          │
│                  comment + label transition                     │
└─────────────────────────────────────────────────────────────────┘
```

Each box is an interface; the GitLab/Filesystem/Codex implementations are concrete classes. Tests substitute fakes.

## Public surface (Phase A)

```ts
// from @oa-sdk/orchestrator-gitlab
export function run(config: OrchestratorConfig): Promise<void>;
export interface OrchestratorConfig {
  tracker: Tracker;
  workspace: WorkspaceManager;
  agent: Agent;
  pollIntervalMs?: number;        // default 30_000
  labels?: Partial<LabelConfig>;  // override defaults from D2
  maxConcurrent?: number;         // default 5
  signal?: AbortSignal;           // graceful shutdown
}

export interface Agent {
  name: string;
  run(input: AgentInput): Promise<AgentResult>;
}

export interface AgentInput {
  workspacePath: string;
  prompt: string;
  issue: Readonly<Issue>;
  env?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
}

export interface AgentResult {
  status: "succeeded" | "failed" | "timed-out" | "cancelled";
  summary: string;
  error?: string;
  artifacts?: { branch?: string; commits?: string[]; mrUrl?: string };
}
```

## CLI (Phase A)

```bash
orchestrator-gitlab run --config ./orchestrator.config.js
orchestrator-gitlab dry-run --config ... --issue <iid>   # pick one issue, EchoAgent, no comment
```

## Success criteria

1. Against a real GitLab instance (the one the `@oa-sdk/infra-gitlab` preset stands up), creating an issue with label `agent-ready` causes:
   - a workspace directory to appear on disk,
   - the configured agent to be invoked once,
   - a comment posted on the issue containing the agent's summary,
   - the issue label to flip to `agent-done` (success) or `agent-failed`.
2. `EchoAgent` runs deterministically in tests — no network, no subprocess.
3. `CodexAgent` invokes the `codex` CLI in a temp workspace and surfaces its exit status and last stdout.
4. Typecheck clean under the repo's strict TS settings.
5. README + this PRD link from the root README package row and `docs/internal/todo.md`.

## Risks

| Risk | Mitigation |
|------|-----------|
| Codex CLI semantics change between versions | CodexAgent isolates the subprocess invocation; Phase B can swap to `codex app-server` stdio if needed |
| Label race between orchestrator instances | Phase A documents single-instance assumption; Phase B adds optimistic concurrency via GitLab's `If-Match` |
| Agent leaks credentials into workspace | `env` passed to the agent is a Phase A operator responsibility; agents must not be given GitLab tokens unless intentional |
| Polling cost on large projects | Filter by label server-side via `?labels=agent-ready&state=opened`; Phase B can switch to webhooks |
