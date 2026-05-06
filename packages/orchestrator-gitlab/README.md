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

| Adapter | Module | Status |
|---------|--------|--------|
| `EchoAgent` | `@oa-sdk/orchestrator-gitlab/agents/echo` | Stable — for tests + dry-run |
| `CodexAgent` | `@oa-sdk/orchestrator-gitlab/agents/codex` | Phase A — wraps `codex exec` subprocess |
| `ClaudeAgent` | — | Phase B — pending decision between Claude Agent SDK vs `claude --print` headless |

To plug in your own agent, implement the `Agent` interface (`name` + `run(input)` returning `AgentResult`) and pass it as `config.agent`.

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

| Phase | Adds |
|-------|------|
| **A** *(this)* | Polling + workspace + agent abstraction + Codex adapter + label transitions |
| B | Retries with exp backoff, state reconciliation (cancel on terminal), `max_turns`, ClaudeAgent |
| C | `WORKFLOW.md`-compatible config + Liquid prompts + hot reload |

Pending items tracked in [`docs/internal/todo.md` → orchestrator-gitlab](../../docs/internal/todo.md#orchestrator-gitlab-잔여-항목).
