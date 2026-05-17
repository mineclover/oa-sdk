# orchestrator-gitlab HTTP API

This document is the contract reference for the optional localhost HTTP
surface exposed by `http.port` in `WORKFLOW.md`.

## Authentication

When `http.auth_token` is configured, every endpoint except `GET /healthz`
requires:

```http
Authorization: Bearer <token>
```

The GitLab private token stays server-side. UI callers use this local bearer
token only.

## Health and Runtime

### `GET /healthz`

Returns `200` while the orchestrator is alive and `503` after shutdown begins.

```json
{ "ok": true, "shuttingDown": false }
```

### `GET /state`

Returns the runtime snapshot: uptime, metrics, in-flight workers, reload count,
and last reload error.

### `GET /issues/:iid`

Returns the in-flight worker snapshot for the issue IID, or `404` when the issue
is not currently being processed.

### `GET /issues/:iid/history`

Returns the recorded worker history ring buffer for the issue IID.

## Issue Tasks

Issue tasks are stored in GitLab issue `description` as GLFM task list items.
Mutations update the issue description through the GitLab Issues API.

Task line numbers are one-based source line numbers from the current issue
description. Clients should refresh after each mutation because line numbers can
shift after edits and deletes.

### `GET /issues/:iid/tasks`

Returns the full task report.

```json
{
  "iid": "42",
  "title": "Task issue",
  "state": "opened",
  "summary": { "count": 3, "completedCount": 1 },
  "tasks": [
    { "line": 1, "text": "Write docs", "checked": false, "inapplicable": false, "marker": "[ ]" }
  ],
  "remainingTasks": [
    { "line": 1, "text": "Write docs", "checked": false, "inapplicable": false, "marker": "[ ]" }
  ]
}
```

### `GET /issues/:iid/tasks?remaining=true`

Returns only the task summary and unchecked applicable tasks.

### `POST /issues/:iid/tasks`

Adds a new unchecked task to the issue description.

```json
{ "text": "Publish release note" }
```

### `PATCH /issues/:iid/tasks/:line`

Updates a task list item by source line.

```json
{ "checked": true }
```

```json
{ "text": "Publish release note", "checked": false }
```

```json
{ "inapplicable": true }
```

### `DELETE /issues/:iid/tasks/:line`

Deletes a task list item by source line.

## Context Search

### `GET /context/search`

Searches GitLab project context through the configured context search service.

Example:

```http
GET /context/search?kinds=issue,merge_request&text=release&limit=8
```

Used by the document editor to insert GLFM issue/MR references such as `#123`
and `!456`.

## Documents

### `POST /documents/save`

Validates or executes GitLab document writes for Wiki pages, repository Markdown
files, and release notes.

By default the endpoint runs as dry-run unless the request body includes
`"dryRun": false`.
