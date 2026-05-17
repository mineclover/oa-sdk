# `@oa-sdk/orchestrator-gitlab`

GitLab-native coding-agent orchestrator. Polls labelled GitLab issues, spins up an isolated workspace per issue, runs a pluggable coding agent, and reports back via a GitLab note.

> **Status — GitLab-native orchestration + context foundation.** The package now includes the issue-driven agent loop, Codex/Claude subprocess adapters, retries, reconciliation, multi-turn continuation, `WORKFLOW.md` loading/hot reload, HTTP/OTel observability, and a GitLab project context search/read API.
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

### Option A — `WORKFLOW.md` (Symphony-compatible front matter + Liquid prompt)

```yaml
---
tracker:
  kind: gitlab
  base_url: http://localhost:8929
  token: $GITLAB_TOKEN
  project_id: 1
  continue_label: agent-continue       # optional — enables continuation turns
polling:
  interval_ms: 5000
workspace:
  root: ~/code/orchestrator-workspaces
  project_slug: myproj
hooks:
  after_create: |
    git clone --depth 1 git@gitlab.example.com:myorg/myproj.git .
agent:
  kind: codex                            # echo | codex | claude
  max_concurrent_agents: 5
  max_turns: 5
  max_retry_backoff_ms: 60000
  options:
    timeout_ms: 1800000
---

You are working on GitLab issue {{ issue.identifier }}.

Title: {{ issue.title }}
{% if attempt %}Continuation attempt #{{ attempt }}.{% endif %}

{{ issue.description }}
```

Run:

```bash
GITLAB_TOKEN=glpat-xxxx orchestrator-gitlab run --workflow ./WORKFLOW.md
# Hot reload — pick up edits to WORKFLOW.md without restart:
GITLAB_TOKEN=glpat-xxxx orchestrator-gitlab run --workflow ./WORKFLOW.md --watch
```

Hot-reloadable: the prompt template, all `polling`/`agent`/`tracker.*` integers, label sets, `continue_label`. In-flight workers keep the snapshot they were dispatched with; new workers and the next-tick scheduler pick up the new values. Parse errors leave the previous (last-known-good) config in effect and surface on `runtime.lastReloadError` and the operator log — the service never crashes on a bad save.

### Observability HTTP server (optional)

Add `http` block to enable a localhost JSON surface:

```yaml
http:
  port: 7081           # required to enable
  host: 127.0.0.1      # default
  auth_token: $ORCH_HTTP_TOKEN   # optional bearer; /healthz stays public
documents:
  default_branch: main # fallback for repository document saves
```

Routes:

| Path | Behaviour |
|------|-----------|
| `GET /healthz` | `200 {"ok":true,"shuttingDown":false}` while alive, `503 {"ok":false,"shuttingDown":true}` after shutdown begins. Always unauthenticated. |
| `GET /state` | `200 RuntimeSnapshot` — uptime, metrics (dispatched/succeeded/failed/cancelled/tokens), `inFlight: InFlightSnapshot[]`, `reloadCount`, `lastReloadError`. |
| `GET /issues/:iid` | `200 InFlightSnapshot` for that IID's in-flight worker, `404` otherwise. |
| `GET /issues/:iid/tasks?remaining=true` | `200` issue task report for a specific GitLab issue. With `remaining=true`, returns the unchecked applicable task list derived from the issue description. |
| `POST /issues/:iid/tasks` | Adds a `- [ ]` task to the issue description. Body: `{ "text": "..." }`. |
| `PATCH /issues/:iid/tasks/:line` | Updates a task list item by source line. Body can include `text`, `checked`, or `inapplicable`. |
| `DELETE /issues/:iid/tasks/:line` | Removes a task list item by source line. |
| `GET /context/search?kinds=issue,merge_request&text=release&limit=8` | `200 GitlabContextSearchResponse` when `contextSearch` is configured. The UI uses this for GLFM `#iid` / `!iid` insertion. |
| `POST /documents/save` | Dry-runs or executes GitLab Wiki, repository file, and release note writes through the configured GitLab project client. Defaults to dry-run unless body has `{ "dryRun": false }`. |

`auth_token` (when set) gates `/state`, `/issues/:iid`, `/context/search`, and mutation endpoints via `Authorization: Bearer <token>`. Use Pulumi secrets / `$VAR` substitution to avoid committing the token.

Detailed endpoint contracts are maintained in [`docs/http-api.md`](./docs/http-api.md).

`documents.default_branch` controls the fallback branch for repository document writes when a request omits `branch`; it defaults to `main`.

The front-matter schema is a strict subset of Symphony's (SPEC §5.3) plus GitLab-specific keys (`tracker.base_url`, `tracker.project_id`, `tracker.labels`, `tracker.continue_label`, `tracker.reconciliation_interval_ms`). The Liquid template renders in **strict mode** — unknown variable or filter raises immediately. Symphony's `{{ issue.identifier }}` and `{% if attempt %}…{% endif %}` work unchanged via aliases (`issue.identifier === "#${iid}"`, `attempt === null` on the first try within a turn).

### Option B — TS config module

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

### Dry-run semantics

`dry-run` is a one-shot execution path for local verification.

For the selected issue, the command:

- loads config/workflow once,
- selects one eligible issue (or the `--issue <iid>` target),
- builds the prompt,
- runs the configured agent once with `turnNumber=1` and `attempt=1`,
- prints the result JSON to stdout.

It intentionally performs **no tracker writes**:

- no `transitionLabels(...)` calls (so no `agent-running` / `agent-done` / `agent-failed` label changes),
- no `postNote(...)` call.

It also does not enter the continuous polling loop (`run`), watch mode, or continuation turns.

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
| **C.1 + C.2** | `WorkflowFileLoader` (Symphony-compatible front matter + `$VAR` substitution + typed validation errors) and `LiquidPromptBuilder` (strict mode + `issue.identifier` / null-`attempt` aliases for Symphony WORKFLOW.md drop-in) | ✅ |
| **C.3** | Hot reload — `node:fs.watch` debounce, re-parse on change, swap `LiveConfigProvider`; in-flight workers untouched, last-known-good preserved on parse error | ✅ |
| **Ops.1** | Observability HTTP server: `GET /healthz` (200/503), `GET /state` (RuntimeSnapshot JSON), `GET /issues/:iid` (per-worker InFlightSnapshot); optional Bearer auth | ✅ |
| **Ops.2** | Per-issue history ring buffer (`GET /issues/:iid/history`, capped at 50 entries) + OpenTelemetry instrumentation (counters / UpDownCounter / Histogram + spans). `@opentelemetry/api` only — SDK is operator's choice; absent SDK = no-op | ✅ |

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
