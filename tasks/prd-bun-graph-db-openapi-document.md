# PRD: Bun Graph DB OpenAPI Document Surface

## Status

Completed. Implemented in `references/bun-graph-db` and linked from the root
repository through the submodule pointer. The implementation keeps stable REST
and MCP endpoint discovery in the static full document while preserving runtime
table schemas as separate projection artifacts.

## Resolved Decisions

- The static full document endpoint is `GET /api/openapi`.
- The root MCP tool contract projection is exposed as the MCP tool
  `get-root-openapi-projection`.
- GraphQL introspection is not expanded into OpenAPI wrappers in this iteration.
- MCP protocol schemas model `initialize`, `tools/list`, and `tools/call`.
- MCP tool definitions and tool call result content blocks are modeled in the
  static full document; tool-specific argument schemas remain dynamic and are
  discovered through `tools/list` or root/table projection export.
- JSON-RPC batch requests are not documented because the current MCP server
  handles single JSON-RPC requests only.

## Overview

bun-graph-db exports dynamic table schema projections as OpenAPI 3.2 artifacts through REST, GraphQL, and table-scoped MCP. This PRD adds a full OpenAPI document for the stable bun-graph-db API surface and for the MCP JSON-RPC transport/tool discovery surface.

This feature adds a static OpenAPI 3.2 document surface for stable REST and MCP protocol endpoints while keeping runtime table shapes as dynamic projection artifacts. The full document should describe how clients discover tables, retrieve table projections, call MCP endpoints, and consume tool schemas. It must not inline every runtime table shape into a stale static document.

## Goals

- Expose a full OpenAPI 3.2 document for stable bun-graph-db REST and MCP endpoints.
- Represent table OpenAPI projection endpoints as stable discovery/export operations.
- Represent MCP JSON-RPC transport shapes for `initialize`, `tools/list`, and `tools/call`.
- Provide a root MCP tool projection/export path for clients that want OpenAPI-compatible tool contracts.
- Keep dynamic table schemas out of static full documents; use projection endpoints and `versionHash` for freshness.
- Validate generated OpenAPI documents with the shared projection contract where applicable.
- Document how OA SDK can consume bun-graph-db as an OpenAPI projection producer.

## Quality Gates

These commands must pass for every user story where applicable:

- `bun run typecheck` - Type checking in `references/bun-graph-db`
- `bun run lint --max-diagnostics=20` - Linting in `references/bun-graph-db`
- Focused OpenAPI/MCP projection tests for changed behavior
- `bun run build` - Build verification in `references/bun-graph-db`

For final verification story, also run:

- `bun test tests/unit/schema/schema-engine-vocabulary-adapter.test.ts`
- `bun test tests/unit/rest-api-controllers.test.ts`
- `bun test tests/integration/projection-graphql-mcp-smoke.test.ts`
- Any new full-document or root MCP projection tests added by this PRD

## User Stories

### US-001: Define Full Document Scope
**Description:** As an API maintainer, I want a clear full-document scope so that stable API surfaces are documented without freezing dynamic table schemas.

**Acceptance Criteria:**
- [x] Document that `full-api-document` covers stable REST and MCP protocol endpoints only.
- [x] Document that runtime table schemas remain available through table projection endpoints.
- [x] Document that table projections must be referenced or linked, not eagerly inlined into the static full document.
- [x] Include `versionHash` and projection profile guidance for schema freshness.
- [x] Add non-goals for client/router generation over arbitrary runtime table shapes.

### US-002: Add Static OpenAPI Document Builder
**Description:** As a client developer, I want bun-graph-db to build a stable OpenAPI 3.2 document so that I can inspect and generate clients for the stable API surface.

**Acceptance Criteria:**
- [x] Add a pure builder for the static bun-graph-db OpenAPI 3.2 document.
- [x] Builder returns `openapi: "3.2.0"`, `info`, `paths`, and reusable `components`.
- [x] Builder includes REST projection endpoint `GET /api/tables/{tableId}/openapi-projection`.
- [x] Builder includes MCP endpoints `/mcp` and `/sub/{tableId}/mcp` as JSON-RPC POST operations.
- [x] Builder includes reusable JSON-RPC request/response/error schemas.
- [x] Builder includes common query/path parameters such as `tableId` and projection `profile`.
- [x] Builder has unit tests for required paths, schemas, and parameters.

### US-003: Expose Full Document Through REST
**Description:** As an API consumer, I want to fetch the stable OpenAPI document over REST so that tooling can discover bun-graph-db without repository access.

**Acceptance Criteria:**
- [x] Add a REST endpoint such as `GET /api/openapi`.
- [x] Endpoint returns the static OpenAPI 3.2 document.
- [x] Endpoint response uses `application/json`.
- [x] Endpoint does not require a table id.
- [x] Endpoint does not inline dynamic table-specific schemas.
- [x] Unit or integration test verifies status, content type, and document shape.

### US-004: Represent MCP Tool Discovery in OpenAPI
**Description:** As an MCP client developer, I want MCP protocol calls represented in OpenAPI so that the transport contract is inspectable through standard tooling.

**Acceptance Criteria:**
- [x] OpenAPI components include schemas for `initialize`, `tools/list`, and `tools/call` JSON-RPC requests.
- [x] OpenAPI components include schemas for MCP content blocks and tool definitions.
- [x] `/mcp` POST request body accepts a JSON-RPC request union or documented generic envelope.
- [x] `/sub/{tableId}/mcp` POST request body accepts table-scoped JSON-RPC calls.
- [x] The document explains that tool-specific `arguments` schemas are discovered dynamically through `tools/list`.
- [x] Tests verify MCP protocol schemas are present in `components.schemas`.

### US-005: Add Root MCP OpenAPI Projection Export
**Description:** As an MCP consumer, I want a root-level projection of available MCP tool contracts so that I can translate tool schemas into OpenAPI-compatible components.

**Acceptance Criteria:**
- [x] Add a root MCP tool or REST endpoint that exports root MCP tool contracts as an OpenAPI projection artifact.
- [x] Projection includes tool argument schemas derived from `tools/list` input schemas.
- [x] Projection includes stable tool names and descriptions.
- [x] Projection includes diagnostics for tools that cannot be mapped to OpenAPI-compatible schemas.
- [x] Projection returns `profile`, `projection`, `refs`, `diagnostics`, `sources`, `versionHash`, and `typeTargets` where available.
- [x] Projection validates with `validateOpenApiProjection()` or returns machine-readable validation diagnostics.

### US-006: Keep Table-Scoped Projection Integration
**Description:** As an AI tool, I want static API discovery to link to table-scoped projection export so that I can retrieve current table schemas on demand.

**Acceptance Criteria:**
- [x] Full document includes the table projection export endpoint.
- [x] Full document documents supported table projection profiles: `component-bundle` and `operation-contract`.
- [x] Full document documents invalid profile behavior.
- [x] Existing table-scoped MCP `get-openapi-projection-{tableId}` tool remains supported.
- [x] Existing table projection tests continue to pass.
- [x] Static full document does not become stale when table attributes change.

### US-007: Document OA SDK Consumption Workflow
**Description:** As an OA SDK user, I want documentation showing how to consume bun-graph-db OpenAPI documents and projections so that I can generate clients, mocks, and types safely.

**Acceptance Criteria:**
- [x] Add docs explaining static full document vs dynamic table projection.
- [x] Add examples for fetching `GET /api/openapi`.
- [x] Add examples for fetching table projection through REST, GraphQL, and MCP.
- [x] Add guidance for OA SDK `validate`, `typegen`, `client`, and mock-server use.
- [x] Add warning that table runtime schemas should be consumed with `versionHash` freshness checks.

### US-008: Final Full Document Verification
**Description:** As a release maintainer, I want final verification for the OpenAPI document surface so that the feature is safe for tooling.

**Acceptance Criteria:**
- [x] `bun run typecheck` passes.
- [x] `bun run lint --max-diagnostics=20` passes.
- [x] `bun run build` passes.
- [x] Full document builder tests pass.
- [x] REST full document endpoint tests pass.
- [x] MCP protocol schema tests pass.
- [x] Existing projection smoke tests pass.
- [x] No temporary test artifacts remain.
- [x] Remaining dirty files are documented if unrelated work exists.

## Functional Requirements

- FR-1: The system must expose a stable OpenAPI 3.2 document for fixed REST and MCP endpoints.
- FR-2: The system must keep dynamic table schemas in projection export endpoints instead of inlining them into the full document.
- FR-3: The document must include reusable JSON-RPC schemas for MCP transport calls.
- FR-4: The document must include table projection export endpoint schemas and profile parameter schemas.
- FR-5: The system must provide a root MCP tool contract projection or equivalent endpoint.
- FR-6: Root MCP projection output must be machine-readable and validation-aware.
- FR-7: Documentation must explain how OA SDK consumes the static document and dynamic projections.

## Non-Goals

- Do not generate a static path per runtime table.
- Do not support `full-api-document` for table-scoped projection export.
- Do not replace GraphQL as an internal API surface.
- Do not remove table-scoped MCP projection export.
- Do not implement generated clients in this PRD.
- Do not solve authorization policy modeling beyond documenting existing endpoints and schemas.

## Technical Considerations

- Reuse `@oa-sdk/openapi-projection-contract` types and validation helpers where possible.
- Prefer pure document builder functions that are easy to unit test.
- Treat MCP tool schemas as dynamic contracts from `tools/list`.
- Consider a stable `x-schema-engine-*` extension block for source, refs, and version metadata.
- Avoid coupling full document generation to database state.
- If dynamic root tool contracts need cache invalidation, base it on tool registry version/fingerprint rather than table projection `versionHash`.

## Success Metrics

- `GET /api/openapi` returns a valid OpenAPI 3.2 document for stable endpoints.
- MCP JSON-RPC protocol calls are documented in OpenAPI components.
- OA SDK tooling can validate the document.
- Clients can discover how to retrieve current table schemas through projection endpoints.
- Existing dynamic table projection behavior remains unchanged.

## Open Questions

- Should a future REST endpoint mirror `get-root-openapi-projection` for non-MCP clients?
- Should selected GraphQL operations receive OpenAPI wrappers in a later iteration?
- Should JSON-RPC batch request support be implemented and then documented in the static full document?
