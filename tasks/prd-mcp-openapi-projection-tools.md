# PRD: MCP OpenAPI Projection Tools

Status: implemented on bun-graph-db `origin/main` (`c065557`). Verification: `bun run typecheck`,
`bun run build`, `bun run lint` (no errors; one Biome schema-version info), and the three focused
projection tests (15 tests, 301 assertions). All MCP PRD stories are complete. The shared PRD's
US-013 final cross-repo gate also passed on 2026-10-23 (`pnpm ci:local` all pass; bun-graph-db
focused projection/runtime/smoke suites 77 tests, 989 assertions).

## Overview

bun-graph-db can already produce OpenAPI 3.2 projection artifacts through internal adapters, REST export, and GraphQL export. Table-scoped MCP servers also consume the operation-contract projection internally to derive create/update input schemas. However, MCP clients cannot directly request the OpenAPI projection artifact itself or the shared `validateOpenApiProjection()` result.

This feature adds a table-scoped MCP tool for exporting OpenAPI projections. The tool returns `{ projection, validation }`, where `projection` is an `OpenApiProjectionResult` for the current table and `validation` is the shared contract validation result. MCP remains a consumer surface; REST/GraphQL export and the table projection service remain the source-agnostic projection path.

## Goals

- Add a table-scoped MCP tool for OpenAPI projection export.
- Support `component-bundle` and `operation-contract` profiles.
- Return `OpenApiProjectionResult` plus `validateOpenApiProjection()` output.
- Preserve refs, diagnostics, sources, version hash, profile, type targets, and `x-schema-engine-*` metadata.
- Verify projection export refreshes after table schema changes.
- Verify invalid projection/error diagnostic behavior is machine-readable.
- Keep MCP as a consumer of projection output, not the source of truth.

## Quality Gates

These commands must pass for every user story where applicable:

- `bun run typecheck` - Type checking
- `bun run lint --max-diagnostics=20` - Linting
- Focused MCP/projection tests for changed behavior
- `bun run build` - Build verification

For final verification story, also run:

- `bun test tests/unit/schema/schema-engine-vocabulary-adapter.test.ts`
- `bun test tests/integration/mcp-table-projection-tools-list.test.ts`
- `bun test tests/integration/projection-graphql-mcp-smoke.test.ts`
- Any new MCP projection export integration tests added by this PRD

## User Stories

### US-001: Define Table-Scoped MCP Projection Tool Contract
**Description:** As an MCP client developer, I want a table-scoped tool contract for OpenAPI projection export so that AI tools can discover table schema projections directly through MCP.

**Acceptance Criteria:**
- [x] Add a table-scoped MCP tool named `get-openapi-projection-{tableId}` or equivalent.
- [x] Tool description states that it returns an OpenAPI 3.2 projection artifact for the current table.
- [x] Tool input schema supports `profile`.
- [x] `profile` supports `component-bundle` and `operation-contract`.
- [x] Default `profile` is `component-bundle`.
- [x] Tool input schema uses enum constraints for supported profile values.
- [x] Tool output contract is documented in code comments or docs.
- [x] Existing table-scoped MCP tools remain listed.

### US-002: Register Projection Export Tool in Table MCP Server
**Description:** As an MCP client, I want table-scoped `tools/list` to include the projection export tool so that I know the projection is available.

**Acceptance Criteria:**
- [x] `TableMcpServer` registers the projection export tool during table tool initialization.
- [x] The tool appears in `tools/list` for table-scoped MCP servers.
- [x] The tool does not require `TableSchemaProjectionService` during list-time schema construction.
- [x] Missing projection service is represented in handler output, not by omitting the tool.
- [x] Focused tools/list test verifies the tool name, description, input schema, and profile enum.

### US-003: Implement MCP Projection Export Handler
**Description:** As an MCP client, I want to call the projection export tool so that I can retrieve the table OpenAPI projection from MCP.

**Acceptance Criteria:**
- [x] Handler obtains the current table projection through `TableSchemaProjectionService`.
- [x] For `component-bundle`, handler returns `toTableSchemaOpenApiProjectionResult(projection)`.
- [x] For `operation-contract`, handler returns `toTableSchemaOpenApiOperationContractProjectionResult(projection)`.
- [x] Handler calls `validateOpenApiProjection()` on the projection result.
- [x] Handler returns `{ projection, validation }`.
- [x] Returned `projection` includes `profile`, `projection`, `refs`, `diagnostics`, `sources`, `versionHash`, and `typeTargets` where available.
- [x] Returned projection document includes root-level `x-schema-engine-*` extension fields.
- [x] Unsupported profile values return a structured MCP error.
- [x] Missing projection service returns a structured MCP error.

### US-004: Add Unit Coverage for Projection Tool Handler
**Description:** As a maintainer, I want unit tests for the projection export handler so that contract regressions are caught quickly.

**Acceptance Criteria:**
- [x] Unit test verifies default profile behavior.
- [x] Unit test verifies `component-bundle` handler output shape.
- [x] Unit test verifies `operation-contract` handler output shape.
- [x] Unit test verifies `validation.valid` is true for valid projections.
- [x] Unit test verifies returned projection includes refs, sources, diagnostics, versionHash, and x-extension metadata.
- [x] Unit test verifies unsupported profile returns structured error.
- [x] Unit test verifies missing projection service returns structured error.
- [x] Tests do not require a real network server.

### US-005: Add MCP Projection Export Integration Scenario
**Description:** As an integration tester, I want to create a table and retrieve its OpenAPI projection through MCP so that end-to-end projection export is verified.

**Acceptance Criteria:**
- [x] Integration test creates a table.
- [x] Integration test creates at least two attribute types.
- [x] Integration test creates attributes for the table.
- [x] Integration test lists table-scoped MCP tools and finds the projection export tool.
- [x] Integration test calls projection export tool with `component-bundle`.
- [x] Returned component-bundle projection validates with `validateOpenApiProjection()`.
- [x] Returned component-bundle projection includes `components.schemas`.
- [x] Returned component-bundle projection includes refs, sources, diagnostics, versionHash, and typeTargets.
- [x] Integration test calls projection export tool with `operation-contract`.
- [x] Returned operation-contract projection includes create/update operation paths.
- [x] Returned operation-contract projection validates with `validateOpenApiProjection()`.

### US-006: Verify Projection Refresh After Schema Change
**Description:** As an MCP client, I want projection export output to refresh after table schema changes so that AI tools do not consume stale contracts.

**Acceptance Criteria:**
- [x] Integration test captures initial projection `versionHash`.
- [x] Test updates or creates an attribute/attribute type for the table.
- [x] Table-scoped MCP schema cache refresh occurs through existing invalidation path.
- [x] Calling the projection export tool after schema change returns a different `versionHash`.
- [x] New or changed attribute appears in `components.schemas`.
- [x] `x-schema-engine-version-hash` matches returned `versionHash`.
- [x] Existing create/update MCP input schemas still reflect the refreshed projection.
- [x] Test verifies no stale projection artifact is returned after refresh.

### US-007: Verify Invalid Projection and Diagnostic Behavior
**Description:** As a maintainer, I want invalid projection cases to be visible through MCP so that clients can distinguish unavailable projections from valid schemas.

**Acceptance Criteria:**
- [x] Test constructs or injects a projection with error diagnostics, such as a missing attribute type.
- [x] Projection export tool returns projection diagnostics in the response when possible.
- [x] `validation.valid` is false when diagnostics contain errors.
- [x] MCP response does not crash or omit diagnostics.
- [x] Table-scoped create/update tool fallback behavior remains safe.
- [x] `_meta.tableSchemaProjection.usable` remains false for unusable projections.
- [x] Error response shape is stable and machine-readable.

### US-008: Document MCP Projection Export Usage
**Description:** As an MCP consumer, I want documentation for the projection export tool so that I can retrieve and validate table schemas through MCP.

**Acceptance Criteria:**
- [x] Update schema projection experiment docs with MCP projection export usage.
- [x] Update shared SchemaEngine boundary docs to list MCP projection export as a consumer surface.
- [x] Document available profiles.
- [x] Document response shape `{ projection, validation }`.
- [x] Document that MCP is a consumer, not the source of truth.
- [x] Document REST and GraphQL projection export remain available.
- [x] Include example MCP call payloads for both profiles.
- [x] Include troubleshooting notes for invalid projections and `usable: false`.

### US-009: Final MCP Projection Export Verification
**Description:** As a release maintainer, I want final verification for MCP OpenAPI projection export so that the feature is safe to rely on.

**Acceptance Criteria:**
- [x] `bun run typecheck` passes.
- [x] `bun run lint --max-diagnostics=20` passes.
- [x] `bun run build` passes.
- [x] Focused MCP projection export unit tests pass.
- [x] MCP tools/list projection integration test passes.
- [x] GraphQL/MCP projection smoke test passes.
- [x] Invalid projection fallback test passes.
- [x] No temporary test artifacts remain.
- [x] Remaining dirty files are documented if unrelated work exists.

## Functional Requirements

- FR-1: Table-scoped MCP servers must expose an OpenAPI projection export tool.
- FR-2: The tool must support `component-bundle` and `operation-contract`.
- FR-3: The tool must default to `component-bundle`.
- FR-4: The tool must return an `OpenApiProjectionResult`.
- FR-5: The tool must return `validateOpenApiProjection()` output.
- FR-6: The projection result must preserve refs, diagnostics, sources, versionHash, and typeTargets where available.
- FR-7: The OpenAPI projection document must include `x-schema-engine-*` metadata extensions.
- FR-8: MCP projection export must refresh after table schema changes.
- FR-9: Invalid projection diagnostics must be visible to MCP clients.
- FR-10: MCP must remain a consumer of OpenAPI projection output, not the source of truth.

## Non-Goals

- Do not replace REST or GraphQL projection export.
- Do not move projection creation into MCP-only code.
- Do not create a new shared schema engine.
- Do not remove compatibility fallback for existing MCP schema generation.
- Do not add UI/browser workflows.
- Do not implement full JSON Schema value validation through MCP in this PRD.
- Do not support `full-api-document` profile for table-scoped MCP projection export.

## Technical Considerations

- Reuse `TableSchemaProjectionService.project()`.
- Reuse `toTableSchemaOpenApiProjectionResult()`.
- Reuse `toTableSchemaOpenApiOperationContractProjectionResult()`.
- Reuse `validateOpenApiProjection()`.
- Keep tool response JSON-serializable.
- Avoid caching projection export separately from existing table-scoped MCP server cache until stale behavior is proven.
- Prefer stable machine-readable error objects over free-form error strings.
- Make tests use in-process MCP/table middleware where possible.

## Success Metrics

- MCP clients can retrieve component-bundle OpenAPI projection for a table.
- MCP clients can retrieve operation-contract OpenAPI projection for a table.
- Returned projection validates with shared validator.
- Projection output refreshes after table schema changes.
- Invalid projections surface diagnostics without crashing.
- Existing table-scoped MCP create/update tools keep working.

## Open Questions

- Should the MCP projection export tool support `full-api-document` in the future for whole-API exports?
- Should projection export tool support selecting only the document without refs/sources for smaller payloads?
- Should projection validation support payload validation in a later MCP tool?
- Should projection exports be cached separately if large tables make projection expensive?
