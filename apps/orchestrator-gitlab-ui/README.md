# orchestrator-gitlab-ui

Operational dashboard for `@oa-sdk/orchestrator-gitlab`.

The app keeps presentation components, static dashboard fixtures, and pure domain normalization logic separate. Issue task editing, GLFM reference search, and document save actions call the orchestrator HTTP API when configured; the rest of the dashboard still uses local fixtures.

Document editor serialization follows the local [GLFM reference](../../docs/references/glfm/index.md).
The editor stores Plate state locally, but the save boundary is the generated GitLab Markdown payload.

## Scripts

- `pnpm --filter @oa-sdk/orchestrator-gitlab-ui dev`
- `pnpm --filter @oa-sdk/orchestrator-gitlab-ui test`
- `pnpm --filter @oa-sdk/orchestrator-gitlab-ui typecheck`
- `pnpm --filter @oa-sdk/orchestrator-gitlab-ui build`

## Orchestrator API

Runtime API calls use the same localhost HTTP surface exposed by `orchestrator-gitlab`:

- `VITE_ORCHESTRATOR_GITLAB_API_BASE_URL=http://127.0.0.1:7081`
- `VITE_ORCHESTRATOR_GITLAB_AUTH_TOKEN=<http.auth_token>`

The same values can be set at runtime in `localStorage` under `orchestrator-gitlab-ui.api.baseUrl` and `orchestrator-gitlab-ui.api.authToken`.

## Structure

- `src/components`: reusable dashboard panels.
- `src/data`: fixture data and display class helpers.
- `src/domain`: pure normalization and summary builders with unit tests.
- `src/editor`: document editor persistence and GitLab Markdown serialization helpers.
