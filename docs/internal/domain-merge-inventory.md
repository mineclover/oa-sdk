# Legacy Domain Merge Inventory

Snapshot for Definition Builder Domain Backfill US-001. This file records the
legacy source checklist that was used to migrate domain merge inputs into
definition fragments. The active schema build no longer reads
`packages/schemas/src/profiles` or `packages/schemas/src/domains`.

## Legacy Merge Inputs

The removed merge command was `pnpm --filter @oa-sdk/schemas run merge`, which
ran `packages/schemas/scripts/merge.ts`. The script read
`packages/schemas/src/openapi.yaml`, injects one profile server list, then merges
domain specs with `common` first and the remaining domains alphabetically.

## Profile Files

| File | Current servers | Fragment or target mapping |
|------|-----------------|----------------------------|
| `packages/schemas/src/profiles/local.yaml` | `http://localhost:4010` Mock server, `http://localhost:3000` Local dev server | Profile-specific target `servers` config for local parity |
| `packages/schemas/src/profiles/staging.yaml` | `https://api.staging.example.com/v1` Staging | Profile-specific target `servers` config for staging parity |
| `packages/schemas/src/profiles/production.yaml` | `https://api.example.com/v1` Production | Profile-specific target `servers` config for production parity |

## Domain Specs

| File | Current sections | Fragment checklist |
|------|------------------|--------------------|
| `packages/schemas/src/domains/common/spec.yaml` | Shared `components.schemas`, `components.responses`, `components.parameters`, `components.securitySchemes`; no `paths` | Shared component fragments |
| `packages/schemas/src/domains/health/spec.yaml` | `tags`, `paths`, `components.schemas` | Health path and schema fragments, plus tag metadata |
| `packages/schemas/src/domains/users/spec.yaml` | `tags`, `paths`, `components.schemas` | Users path and schema fragments, plus tag metadata |

## Shared Components

Current shared components in `packages/schemas/src/domains/common/spec.yaml`:

| Component section | Keys | Definition fragment kind |
|-------------------|------|--------------------------|
| `components.schemas` | `Error`, `ValidationError` | `schema:shared/common/{Name}` |
| `components.responses` | `BadRequest`, `Unauthorized`, `Forbidden`, `NotFound`, `UnprocessableEntity`, `InternalServerError`, `ServiceUnavailable` | `response:shared/common/{Name}` |
| `components.parameters` | `Page`, `Limit` | `parameter:shared/common/{Name}` |
| `components.securitySchemes` | `bearerAuth`, `oauth2` | `securityScheme:shared/common/{Name}` |

## Health Paths And Operations

Current paths and operations in `packages/schemas/src/domains/health/spec.yaml`:

| Path | Operations | Local refs to preserve |
|------|------------|------------------------|
| `/health` | `GET getHealth` | `#/components/schemas/HealthStatus`, `#/components/responses/ServiceUnavailable` |
| `/health/stream` | `GET streamHealthEvents` | `#/components/responses/ServiceUnavailable` |

Additional health source sections:

| Source section | Keys | Definition fragment kind |
|----------------|------|--------------------------|
| `tags` | `health` | `tag` fragment or target metadata |
| `components.schemas` | `HealthStatus` | `schema:public/health/HealthStatus` unless a later target intentionally scopes health as internal-only |

## Users Paths And Operations

Current paths and operations in `packages/schemas/src/domains/users/spec.yaml`:

| Path | Operations | Local refs to preserve |
|------|------------|------------------------|
| `/users` | `GET listUsers`, `POST createUser` | Shared `Page`, `Limit`, `Unauthorized`, `BadRequest`, `UnprocessableEntity`, `InternalServerError`; schemas `User`, `CreateUserRequest`; security scheme `bearerAuth` |
| `/users/{id}` | `GET getUserById`, `PATCH updateUser`, `DELETE deleteUser` | Shared `Unauthorized`, `Forbidden`, `NotFound`, `BadRequest`, `UnprocessableEntity`; schemas `User`, `UpdateUserRequest`; security scheme `bearerAuth`; path parameter `id` |

Additional users source sections:

| Source section | Keys | Definition fragment kind |
|----------------|------|--------------------------|
| `tags` | `users` | `tag` fragment or target metadata |
| `components.schemas` | `User`, `CreateUserRequest`, `UpdateUserRequest` | `schema:public/users/{Name}` |
| Inline path/operation parameters | `/users.get.parameters[role]`, `/users/{id}.parameters[id]` | Keep inside owning `path` fragment unless reused; extract to `parameter` only if needed |
| Inline request bodies | `createUser`, `updateUser` request bodies | Keep inside owning `path` fragment unless reused; extract to `requestBody` only if needed |

## Artifact Paths And Validation Commands

| Artifact or command | Current value |
|---------------------|---------------|
| OpenAPI 3.2 merged artifact | `packages/schemas/src/.merged.yaml` |
| OpenAPI 3.1 downgrade artifact | `packages/schemas/src/.merged.3.1.yaml` |
| OpenAPI 3.1 downgrade sidecar | `packages/schemas/src/.merged.3.1.meta.json` |
| Schema package validation | `pnpm --filter @oa-sdk/schemas run validate` |
| Root schema validation | `pnpm schema:validate` |
| Root quality gates for this PRD | `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm schema:validate`, `pnpm build:scripts && pnpm check:api-index`, `pnpm check:feature-tests` |

`pnpm --filter @oa-sdk/schemas run validate` now expands to `build:typespec`,
downgrade, Spectral lint of `src/.merged.yaml`, and Redocly lint.
`pnpm schema:validate` also builds parser/codegen first and runs strict
`oa-gen validate --require-32` against `packages/schemas/src/.merged.yaml`.

## Source Section To Fragment Kind Map

| Current source section | Definition builder destination |
|------------------------|--------------------------------|
| `packages/schemas/src/openapi.yaml#/info` | Target-level emitted metadata; not a domain fragment |
| `packages/schemas/src/openapi.yaml#/tags/*` | `tag` fragments or target metadata before replacement |
| `packages/schemas/src/profiles/*.yaml#/servers/*` | Profile-specific target `servers`; optional `server` fragments only if targets later need reusable server definitions |
| `domains/common/spec.yaml#/components/schemas/*` | `schema:shared/common/{Name}` |
| `domains/common/spec.yaml#/components/responses/*` | `response:shared/common/{Name}` |
| `domains/common/spec.yaml#/components/parameters/*` | `parameter:shared/common/{Name}` |
| `domains/common/spec.yaml#/components/securitySchemes/*` | `securityScheme:shared/common/{Name}` |
| `domains/health/spec.yaml#/paths/*` | `path:public/health/{Name}` with current operations embedded |
| `domains/health/spec.yaml#/components/schemas/*` | `schema:public/health/{Name}` unless intentionally internal-only |
| `domains/users/spec.yaml#/paths/*` | `path:public/users/{Name}` with current operations embedded |
| `domains/users/spec.yaml#/components/schemas/*` | `schema:public/users/{Name}` |
| Domain-local `tags` arrays | `tag` fragments or target metadata |
| Inline operation request bodies, responses, examples, security, and per-path parameters | Preserve inside the owning `path` fragment unless a later story deliberately extracts reusable `requestBody`, `response`, or `parameter` fragments |
| `packages/schemas/src/.merged.yaml`, `.merged.3.1.yaml`, `.merged.3.1.meta.json` | Generated artifacts only; do not backfill as fragment sources |
