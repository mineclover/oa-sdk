# `@oa-sdk/orchestrator-gitlab`

GitLab-native coding-agent orchestrator. Polls labelled GitLab issues, spins up an isolated workspace per issue, runs a pluggable coding agent, and reports back via a GitLab note.

> **Status — Phase A (MVP).** End-to-end loop, EchoAgent + CodexAgent. State reconciliation, retries, multi-turn continuation, and `WORKFLOW.md` compatibility are deferred to Phase B/C.
>
> Design rationale: see [`docs/prd-phase-a.md`](./docs/prd-phase-a.md).

## Why this exists

Symphony (openai/symphony) defines a great pattern for issue-driven agent orchestration but its [SPEC](https://github.com/openai/symphony/blob/main/SPEC.md) currently locks `tracker.kind` to `linear`. This package reimplements the same loop natively for GitLab in TypeScript, treating Symphony's SPEC as a design reference rather than a code dependency.

## How it works

```
GitLab issue                Tracker.listEligible()       claim → label `agent-running`
  labelled `agent-ready`  ──────────────────────────►  ┐
                                                       │
                                                       ▼
                                          Workspace ensure (per-issue dir)
                                                       │
                                                       ▼
                                              Agent.run({ workspace, prompt, issue })
                                                       │
                                                       ▼
                                          postNote()  +  label → `agent-done` | `agent-failed`
```

## Quickstart

```bash
pnpm --filter @oa-sdk/orchestrator-gitlab build
```

Author a config module (`orchestrator.config.js`):

```js
import { GitlabTracker, FsWorkspaceManager } from "@oa-sdk/orchestrator-gitlab";
import { EchoAgent } from "@oa-sdk/orchestrator-gitlab/agents/echo";

export default {
  tracker: new GitlabTracker({
    baseUrl: "http://localhost:8929",
    token: process.env.GITLAB_TOKEN,
    projectId: 1,
  }),
  workspace: new FsWorkspaceManager({
    root: "/tmp/orchestrator-workspaces",
    projectSlug: "myproj",
    afterCreate: async (ws) => {
      // optional: git clone, mise install, etc.
    },
  }),
  agent: new EchoAgent(),
  prompt: {
    build: (issue) => `Resolve issue ${issue.iid}: ${issue.title}\n\n${issue.description}`,
  },
  pollIntervalMs: 30_000,
  maxConcurrent: 5,
};
```

Run:

```bash
GITLAB_TOKEN=glpat-xxxx orchestrator-gitlab run --config ./orchestrator.config.js
# or single-issue dry-run, no comment loop:
GITLAB_TOKEN=glpat-xxxx orchestrator-gitlab dry-run --config ./orchestrator.config.js --issue 42
```

## Agents

All concrete adapters share `SubprocessAgent` (`@oa-sdk/orchestrator-gitlab/agents/subprocess`) — a generic spawn-with-timeout/abort/stdout-capture helper. Adding another CLI-based agent is a ~20-line subclass; see `agents/codex.ts` and `agents/claude.ts` as templates.

| Adapter | Module | Default invocation | Notes |
|---------|--------|-------------------|-------|
| `EchoAgent` | `@oa-sdk/orchestrator-gitlab/agents/echo` | — (in-process) | Deterministic; for tests, dry-run, smoke checks. |
| `CodexAgent` | `@oa-sdk/orchestrator-gitlab/agents/codex` | `codex exec <prompt>` | Override `bin`, `globalArgs`, `subcommand`, `timeoutMs`, `extraEnv` via constructor opts. |
| `ClaudeAgent` | `@oa-sdk/orchestrator-gitlab/agents/claude` | `claude --print` (prompt via stdin) | Override `bin`, `args`, `promptDelivery`, `timeoutMs`, `extraEnv` via constructor opts. Use `extraEnv: { ANTHROPIC_API_KEY: ... }` to forward auth. |
| (your own) | implement the `Agent` interface | — | Or extend `SubprocessAgent` with your bin's defaults. |

## Label contract

Eligibility is signalled by GitLab labels (configurable via `config.labels`):

| Label | Set by | Meaning |
|-------|--------|---------|
| `agent-ready` | operator | dispatch on next tick |
| `agent-running` | orchestrator | claimed; prevents double-dispatch |
| `agent-done` | orchestrator | success terminal |
| `agent-failed` | orchestrator | failure terminal — operator inspects |

## Stack with the GitLab infra preset

This orchestrator pairs with [`@oa-sdk/infra-gitlab`](../infra-gitlab/README.md), which stands up the GitLab CE instance the orchestrator polls.

## Testing

```bash
pnpm --filter @oa-sdk/orchestrator-gitlab test          # unit tests (FakeTracker + EchoAgent, no I/O)
pnpm --filter @oa-sdk/orchestrator-gitlab typecheck     # tsc --noEmit
```

### Integration tests against a real GitLab

End-to-end suite under `test/integration/` exercises `GitlabTracker` + the orchestrator loop against a live instance. Tests **skip cleanly** when env is missing — safe in CI.

```bash
GITLAB_INTEGRATION_BASE_URL=http://localhost:8929 \
GITLAB_INTEGRATION_TOKEN=glpat-xxxxxxxx \
GITLAB_INTEGRATION_PROJECT_ID=1 \
  pnpm --filter @oa-sdk/orchestrator-gitlab test:integration
```

Required token scope: `api`. Per run a unique label namespace (`agent-{ready,running,done,failed}-it-<runId>`) is used so tests do not collide with real workflows; created issues are closed in `afterAll` for cleanup. The `@oa-sdk/infra-gitlab` preset provides a suitable local instance.

## Roadmap

| Phase | Adds | Status |
|-------|------|--------|
| **A** | Polling + workspace + agent abstraction + Codex adapter + label transitions | ✅ |
| **B.1** | `SubprocessAgent` extracted; `ClaudeAgent` shipped on top of it | ✅ |
| **B.2** | Per-turn retry with exp backoff (`maxAttempts` × `retryBackoffBaseMs`/`maxRetryBackoffMs`); reconciliation watcher cancels in-flight agents on issue close or external label removal; continuation turns via `maxTurns` + `continueLabel`; `AgentTokens` aggregation in notes + shutdown summary | ✅ |
| C | `WORKFLOW.md`-compatible config + Liquid prompts + hot reload | ⏳ |

### Phase B.2 config (all optional, default to no behaviour change)

| Field | Default | Effect |
|-------|---------|--------|
| `maxAttempts` | `1` | retry on `failed`/`timed-out` up to N times per turn. `cancelled` never retries. |
| `retryBackoffBaseMs` | `1_000` | base for `min(base * 2^(attempt-1), max)` |
| `maxRetryBackoffMs` | `300_000` | cap on per-retry backoff |
| `maxTurns` | `1` | continuation cap. With `>1`, after a successful turn the orchestrator re-fetches the issue; if `continueLabel` still present, runs another turn. |
| `continueLabel` | `undefined` | required to actually run continuation turns. Operator removes the label to end the loop. |
| `reconciliationIntervalMs` | `15_000` | how often each in-flight worker re-fetches its issue. Set `0` to disable. |

Pending items tracked in [`docs/internal/todo.md` → orchestrator-gitlab](../../docs/internal/todo.md#orchestrator-gitlab-잔여-항목).
