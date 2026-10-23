# PRD: Shared OpenAPI Projection Validation

Status: bun-graph-db side implemented on `origin/main` (`c065557`). OA SDK-side contract work is complete for US-002 through US-007: `@oa-sdk/openapi-projection-contract`, projection profiles, metadata extensions, `validateOpenApiProjection()`, and Definition Builder projection validation are implemented. US-008 through US-012 are marked complete against the pinned bun-graph-db tree; verification was `bun run typecheck` plus the three focused projection tests (15 tests, 301 assertions). US-001 vocabulary reconciliation and US-013 final full cross-repo gates remain open.

## Overview

OA SDK and bun-graph-db currently expose different schema projection surfaces. OA SDK builds OpenAPI 3.2 documents from file-based definition fragments, while bun-graph-db projects runtime table metadata into `$defs` JSON Schema artifacts and MCP input schemas. This prevents validation tooling from being source-agnostic.

This feature aligns both systems around an OpenAPI 3.2 Projection Interface. Each system keeps its native source model, but exposes a common `OpenApiProjectionResult` that contains an OpenAPI 3.2 document, profile, refs, diagnostics, source coordinates, and version hash.

This PRD intentionally creates a contract package and validation entrypoint, not a shared schema engine implementation. OA SDK and bun-graph-db remain responsible for their own source loading, projection construction, caching, MCP, GraphQL, REST, and CLI orchestration.

## Goals

- Define a shared `@oa-sdk/openapi-projection-contract` package.
- Support `component-bundle`, `operation-contract`, and `full-api-document` projection profiles.
- Add `validateOpenApiProjection()` as the shared validation entrypoint.
- Adapt OA SDK Definition Builder output into `OpenApiProjectionResult`.
- Adapt bun-graph-db `TableSchemaProjection` output into `OpenApiProjectionResult`.
- Preserve refs, diagnostics, source coordinates, version hash, and projection metadata.
- Align bun-graph-db MCP tools/list schema generation with OpenAPI projection components.
- Keep shared package scope limited to contract types and validation helpers.

## Quality Gates

These commands must pass for every user story where applicable:

- `pnpm typecheck` - OA SDK type checking
- `pnpm test` or focused package tests - OA SDK verification
- `pnpm schema:validate` - OA SDK schema validation when OpenAPI output changes
- `pnpm build:scripts && pnpm check:api-index` - OA SDK API export documentation check when public exports change
- `bun run typecheck` - bun-graph-db type checking
- `bun run lint --max-diagnostics=20` - bun-graph-db linting
- Focused bun-graph-db projection tests for changed projection/MCP behavior

For final verification story, also run:

- `pnpm build`
- `bun run build`
- OA SDK `oa-gen build-spec` + `oa-gen validate` for all definition builder targets
- bun-graph-db GraphQL/MCP projection smoke tests

## User Stories

### US-001: Reconcile Existing Vocabulary Draft and Adapter Tests
**Description:** As a maintainer, I want the current draft vocabulary docs and adapter tests corrected before adding a package so that the new contract starts from a consistent baseline.

**Acceptance Criteria:**
- [ ] OA SDK adapter test maps registry diagnostics, target diagnostics, emit diagnostics, and validation diagnostics into the shared diagnostic envelope.
- [ ] OA SDK adapter test includes at least one diagnostic case proving registry diagnostics survive mapping.
- [ ] bun-graph-db shared boundary doc defines every type referenced in its vocabulary block, including `SchemaTypeTarget` or removes unused references.
- [ ] OA SDK and bun-graph-db vocabulary docs use the same field names for `projection`, `refs`, `diagnostics`, `sources`, `versionHash`, and `typeTargets`.
- [ ] Existing adapter tests remain thin field mappings and do not duplicate projection logic.

### US-002: Create OpenAPI Projection Contract Package
**Description:** As a schema platform maintainer, I want a shared contract package so that both systems can import the same projection result types without importing each other's source-specific code.

**Acceptance Criteria:**
- [x] Add workspace package `packages/openapi-projection-contract`.
- [x] Package name is `@oa-sdk/openapi-projection-contract`.
- [x] Package exports `OpenApiProjectionResult`.
- [x] Package exports `OpenApiProjectionProfile`.
- [x] Package exports `SchemaRefEdge`, `SchemaDiagnostic`, `SchemaSourceCoordinate`, `SchemaValidateResult`, and `SchemaTypeTarget`.
- [x] Package has no dependency on OA SDK parser internals, codegen CLI internals, bun-graph-db repositories, MCP, GraphQL, REST, SQLite, or filesystem loading.
- [x] Package build script emits ESM and type declarations.
- [x] Contract package import smoke test passes from inside OA SDK workspace.
- [x] OA SDK API index is updated if public package exports are tracked there.

### US-003: Define Projection Profiles and Semantics
**Description:** As a validation tool author, I want projection profile semantics defined in code and docs so that validation can be profile-aware.

**Acceptance Criteria:**
- [x] `OpenApiProjectionProfile` supports `component-bundle`, `operation-contract`, and `full-api-document`.
- [x] `component-bundle` permits empty `paths` and requires `components.schemas`.
- [x] `operation-contract` requires at least one operation under `paths`.
- [x] `full-api-document` requires normal OpenAPI document validation.
- [x] Contract docs explain which profile OA SDK and bun-graph-db should emit first.
- [x] Contract tests cover valid profile values and invalid profile values.
- [x] Profile semantics are not tied to one source model.

### US-004: Implement validateOpenApiProjection
**Description:** As a validation user, I want a shared `validateOpenApiProjection()` entrypoint so that both systems can validate projection envelopes consistently.

**Acceptance Criteria:**
- [x] Contract package exports `validateOpenApiProjection(result)`.
- [x] Validation checks OpenAPI document structural validity through a dependency-light path or a clearly documented injected validator.
- [x] Validation checks profile-specific requirements.
- [x] Validation checks refs entries have required `from`, `ref`, `kind`, and `source`.
- [x] Validation checks diagnostics entries have valid severity, code, and message.
- [x] Validation checks sources entries use supported file or DB coordinate variants.
- [x] Validation treats any diagnostic with `severity: error` as projection-invalid.
- [x] Validation returns structured diagnostics and does not throw for ordinary invalid projection data.
- [x] Validation does not read files, query repositories, open SQLite, construct MCP servers, or execute GraphQL.

### US-005: Define Projection Metadata Extensions
**Description:** As a debugging user, I want standard OpenAPI extensions for projection metadata so that source and ref provenance can survive serialization.

**Acceptance Criteria:**
- [x] Define extension names `x-schema-engine-profile`, `x-schema-engine-version-hash`, `x-schema-engine-sources`, and `x-schema-engine-refs`.
- [x] Contract package exports constants for these extension names.
- [x] Contract package documents which metadata belongs in standard OpenAPI fields versus `x-*` extensions.
- [x] Extension serialization preserves file source coordinates.
- [x] Extension serialization preserves DB source coordinates.
- [x] Extension serialization preserves ref graph metadata.
- [x] Extension fields do not invalidate OpenAPI document validation.

### US-006: Add OA SDK Definition Builder Projection Adapter
**Description:** As an OA SDK maintainer, I want Definition Builder output adapted to `OpenApiProjectionResult` so that OA SDK target builds can use the shared validation contract.

**Acceptance Criteria:**
- [x] Add adapter from Definition Builder registry/selection/emit result to `OpenApiProjectionResult`.
- [x] Adapter sets profile to `full-api-document`.
- [x] Adapter maps emitted OpenAPI document to `document`.
- [x] Adapter maps registry ref edges to `SchemaRefEdge`.
- [x] Adapter includes registry, target, output naming, emit, and validation diagnostics.
- [x] Adapter maps file source paths, JSON Pointers, and line/column where available into file source coordinates.
- [x] Adapter computes or forwards a stable `versionHash`.
- [x] Adapter preserves alias/collision metadata through `metadata` or documented extension fields.
- [x] Tests cover successful document projection.
- [x] Tests cover registry diagnostics surviving adapter mapping.

### US-007: Validate OA SDK Builder Projections
**Description:** As an OA SDK user, I want generated target documents to pass the shared projection validator so that builder outputs conform to the common validation interface.

**Acceptance Criteria:**
- [x] Existing definition builder targets can be adapted to `OpenApiProjectionResult`.
- [x] `validateOpenApiProjection()` passes for public, admin, internal, and book-notebook targets.
- [x] Tests assert emitted target documents contain no `oa://` refs.
- [x] Tests assert path parameters and operationIds are valid in emitted target documents.
- [x] Tests assert collision reports remain available.
- [x] Tests assert `full-api-document` profile rejects invalid emitted documents.
- [x] Focused test or CLI path verifies `oa-gen build-spec` output can be validated through the shared entrypoint.

### US-008: Wire bun-graph-db to the Contract Package
**Description:** As a bun-graph-db maintainer, I want to consume the shared projection contract without importing OA SDK implementation internals so that bun adapters compile against the same types.

**Acceptance Criteria:**
- [x] Add a local development dependency from bun-graph-db to `@oa-sdk/openapi-projection-contract` using the repository-relative path used in this workspace.
- [x] bun-graph-db imports only contract package types/helpers, not OA SDK parser/codegen internals.
- [x] bun-graph-db typecheck passes with the contract package dependency.
- [x] Document that the local file dependency is a development integration path until the package is published or vendored.
- [x] No bun-graph-db repository, GraphQL, MCP, or storage code is moved into the contract package.

### US-009: Add bun-graph-db Component-Bundle Adapter
**Description:** As a bun-graph-db maintainer, I want table schema projections adapted into OpenAPI 3.2 component bundles so that runtime DB metadata can use OpenAPI-compatible validation tooling.

**Acceptance Criteria:**
- [x] Add adapter from `TableSchemaProjection` to `OpenApiProjectionResult`.
- [x] Adapter sets profile to `component-bundle`.
- [x] Adapter emits OpenAPI 3.2 document with `openapi`, `info`, empty `paths`, and `components.schemas`.
- [x] Adapter maps `$defs` entries into `components.schemas`.
- [x] Adapter rewrites internal `$defs` refs to `#/components/schemas/...`.
- [x] Adapter preserves projection refs.
- [x] Adapter preserves projection diagnostics.
- [x] Adapter preserves DB source coordinates.
- [x] Adapter forwards `versionHash`.
- [x] Tests cover a valid table schema projection becoming a valid component-bundle projection.
- [x] Tests cover projection error diagnostics surviving adapter mapping.

### US-010: Add bun-graph-db Operation-Contract Adapter
**Description:** As a bun-graph-db validation user, I want create/update node contracts represented as OpenAPI operations so that request payload validation can use the common OpenAPI projection interface.

**Acceptance Criteria:**
- [x] Adapter can emit `operation-contract` profile for a table projection.
- [x] Operation contract includes create node path or synthetic path.
- [x] Create node operation requestBody references projected create input schema.
- [x] Update node operation requestBody references projected update input schema.
- [x] Update node operation includes a required `nodeId` path parameter or equivalent operation parameter.
- [x] OperationIds are stable and table-specific.
- [x] Response stubs are valid OpenAPI responses.
- [x] Tests validate operation-contract output with `validateOpenApiProjection()`.
- [x] Tests validate create payload success/failure through the shared validation path where supported.
- [x] Tests validate update payload partial semantics are preserved.

### US-011: Align bun-graph-db MCP tools/list Schema Generation
**Description:** As an MCP client, I want table-scoped tools/list schemas to derive from OpenAPI projection output so that MCP schema output does not drift from the shared validation surface.

**Acceptance Criteria:**
- [x] MCP schema generation can consume bun-graph-db `OpenApiProjectionResult`.
- [x] Existing `TableSchemaProjection` direct mapper remains only as a compatibility fallback during migration.
- [x] Create node MCP tool input schema is derived from OpenAPI projection components.
- [x] Update node MCP tool input schema is derived from OpenAPI projection components.
- [x] Projection diagnostics still appear in MCP `_meta`.
- [x] Unusable projections still fall back safely and set `usable: false`.
- [x] Existing table-scoped tools remain listed.
- [x] Focused MCP tools/list tests pass.
- [x] GraphQL/MCP projection smoke test confirms schema refresh after table schema changes.

### US-012: Document As-Is/To-Be Architecture
**Description:** As an architect, I want the as-is/to-be alignment documented so that future work does not confuse OpenAPI projection sharing with schema engine implementation sharing.

**Acceptance Criteria:**
- [x] OA SDK architecture docs describe the as-is/to-be alignment.
- [x] bun-graph-db shared SchemaEngine boundary docs describe the as-is/to-be alignment.
- [x] Docs state that native source models remain separate.
- [x] Docs state that OpenAPI 3.2 is the validation and exchange projection interface.
- [x] Docs state that the shared package is a contract and validation package, not a shared source loader or engine.
- [x] Docs include extraction gates for any future shared implementation.
- [x] Docs define the three projection profiles and intended consumers.
- [x] Docs include migration notes for bun-graph-db MCP schema generation.

### US-013: Final Cross-Repo Verification
**Description:** As a release maintainer, I want full verification across OA SDK and bun-graph-db so that the OpenAPI projection contract is safe to build on.

**Acceptance Criteria:**
- [ ] OA SDK full quality gates pass.
- [ ] bun-graph-db full focused quality gates pass.
- [ ] `pnpm build` passes.
- [ ] `bun run build` passes.
- [ ] OA SDK `oa-gen build-spec` and `oa-gen validate` pass for all definition builder targets.
- [ ] bun-graph-db focused projection/runtime tests pass.
- [ ] bun-graph-db GraphQL/MCP projection smoke tests pass.
- [ ] No temporary generated output directories are left in the worktree.
- [ ] Remaining dirty files are documented by category if unrelated work is present.

## Functional Requirements

- FR-1: The system must expose a shared `OpenApiProjectionResult` contract.
- FR-2: The contract must include an OpenAPI 3.2 document, profile, refs, diagnostics, sources, and version hash.
- FR-3: The contract must support `component-bundle`, `operation-contract`, and `full-api-document` profiles.
- FR-4: OA SDK Definition Builder output must be adaptable to `OpenApiProjectionResult`.
- FR-5: bun-graph-db `TableSchemaProjection` output must be adaptable to `OpenApiProjectionResult`.
- FR-6: Shared validation must not depend on source-specific loading or runtime systems.
- FR-7: Source coordinates must support both file and DB provenance.
- FR-8: Ref metadata must survive projection and serialization.
- FR-9: Diagnostics must use a common envelope while allowing system-specific diagnostic codes.
- FR-10: bun-graph-db MCP schema generation must be alignable with OpenAPI projection components.
- FR-11: OpenAPI extensions must preserve projection metadata without invalidating the OpenAPI document.
- FR-12: Shared package scope must remain contract and validation entrypoint only.

## Non-Goals

- Do not extract a shared schema engine implementation.
- Do not move OA SDK file scanning or target config loading into the shared package.
- Do not move bun-graph-db repository loading or table schema lookup into the shared package.
- Do not replace bun-graph-db storage, GraphQL, REST, or MCP contracts.
- Do not require DB runtime metadata to become the source of truth for OA SDK.
- Do not require OA SDK definition fragments to become the source of truth for bun-graph-db.
- Do not implement complete JSON Schema validation from scratch if existing validators can be reused.
- Do not remove existing compatibility paths until replacement behavior is verified.

## Technical Considerations

- The new contract package should be type-first and dependency-light.
- The validator may reuse existing OpenAPI validation logic through an injected or minimal dependency path.
- bun-graph-db should map `$defs` to `components.schemas` and rewrite `$defs` refs for OpenAPI compatibility.
- `operation-contract` profile should use synthetic paths only when no real route is appropriate.
- `x-schema-engine-*` extensions should be stable enough for diagnostics and debugging but not treated as source of truth.
- The shared validator should treat `diagnostics` with `severity: error` as projection-invalid even when the OpenAPI document is structurally valid.
- Adapter tests should stay thin and should fail if they start duplicating projection logic.

## Success Metrics

- OA SDK and bun-graph-db both produce valid `OpenApiProjectionResult` artifacts.
- Shared validator accepts valid projections and rejects invalid projection envelopes.
- bun-graph-db table metadata can be represented as OpenAPI 3.2 `component-bundle`.
- bun-graph-db create/update node validation can be represented as OpenAPI 3.2 `operation-contract`.
- OA SDK Definition Builder outputs validate as `full-api-document`.
- MCP tools/list schema output can be traced back to OpenAPI projection components.
- No shared source-loading or DB-repository logic is introduced.

## Open Questions

- Should the contract package eventually move to a neutral namespace if bun-graph-db becomes independent from OA SDK?
- Should `SchemaRefEdge.from` and `to` eventually become structured IDs instead of strings?
- Should value validation use an existing JSON Schema validator directly, or remain profile-specific at first?
- Should `x-schema-engine-*` extensions be embedded in the document, emitted as sidecar JSON, or both?
- Should `operation-contract` paths use real service routes or synthetic validation-only routes?
