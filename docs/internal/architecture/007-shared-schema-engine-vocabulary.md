# ADR-007 - OpenAPI Projection Contract Boundary

## Status

Accepted for OpenAPI projection sharing. Future shared SchemaEngine implementation remains gated and must not be inferred from the existence of `@oa-sdk/openapi-projection-contract`.

## Context

OA SDK and bun-graph-db now both treat schema material as a projection graph.

- OA SDK loads OpenAPI definition fragments, builds a canonical definition registry, rewrites refs, and emits target OpenAPI documents.
- bun-graph-db loads runtime table metadata from graph repositories, projects `$defs` JSON Schema documents, validates node values, and exposes projection freshness to MCP/docs flows.

Native source models remain separate. OA SDK file-backed definition fragments are not the source of truth for bun-graph-db, and bun-graph-db runtime table metadata is not the source of truth for OA SDK.

OpenAPI 3.2 is the validation and exchange projection interface between systems. The common layer is not file loading, repository access, CLI execution, MCP, REST, GraphQL, or SQLite invalidation. The common layer is an OpenAPI 3.2 projection artifact plus source-neutral provenance, diagnostics, refs, and version metadata.

The shared package is a contract and validation package, not a shared source loader or engine. It may define projection types, profile semantics, metadata extension names, and `validateOpenApiProjection()`. It must not load OA SDK fragments, query bun-graph-db repositories, own caches, construct MCP servers, execute GraphQL, or implement system-specific schema projection.

## As-Is Alignment

The current implementation proves sharing at the projection boundary only:

- `@oa-sdk/openapi-projection-contract` exports `OpenApiProjectionResult`, projection profiles, projection metadata extension helpers, and dependency-light validation.
- OA SDK adapts Definition Builder output into the `full-api-document` profile while keeping Definition Registry loading, target selection, source-location lookup, CLI output, and builder orchestration local.
- bun-graph-db adapts `TableSchemaProjection` into `component-bundle` and `operation-contract` OpenAPI 3.2 projections while keeping repositories, domain entity conversion, GraphQL, REST, MCP server construction, table-scoped cache invalidation, and runtime value validation local.
- bun-graph-db MCP tools/list schema generation now consumes the operation-contract projection first, resolves requestBody component refs into concrete MCP input schemas, and retains the direct `TableSchemaProjection` mapper only as a compatibility fallback.

## To-Be Alignment

The intended future shape is still projection sharing before implementation sharing:

- Source-specific systems continue to own native source models, loaders, invalidation, and transport adapters.
- Cross-system validation, debugging, and exchange should use OpenAPI 3.2 projection documents plus the shared envelope and root-level `x-schema-engine-*` metadata extensions.
- New consumers should choose the narrowest projection profile that matches their job instead of depending on source-specific adapters.
- A shared SchemaEngine implementation may be considered only after the extraction gates below are met by real call sites in both projects.

## Projection Profiles

| Profile | Shape | Intended consumers |
|---|---|---|
| `component-bundle` | OpenAPI 3.2 document with empty or absent `paths` and required `components.schemas`. | bun-graph-db table schema component export, source-agnostic component validators, docs/AI metadata, and tools that need reusable schemas without operation contracts. |
| `operation-contract` | OpenAPI 3.2 document with at least one operation under `paths`; request bodies may reference reusable components. | bun-graph-db table-scoped MCP tools/list schema generation, request payload contract tests, and clients that need create/update operation input shapes without a full public API document. |
| `full-api-document` | Normal OpenAPI 3.2 API document with API-level paths, operations, components, info, servers, and related fields. | OA SDK Definition Builder validation, `oa-gen build-spec` programmatic consumers, OpenAPI validators, and downstream codegen/router/client/mock flows. |

Profile semantics are based on the emitted OpenAPI projection shape, not on which project produced it.

## Vocabulary

The concrete shared vocabulary is exported by `@oa-sdk/openapi-projection-contract`. It is deliberately small enough to map from both projects without sharing source-specific implementation.

```ts
export type OpenApiProjectionResult<TProjection = Record<string, unknown>> = {
  profile: 'component-bundle' | 'operation-contract' | 'full-api-document'
  projection: TProjection
  refs: SchemaRefEdge[]
  diagnostics: SchemaDiagnostic[]
  sources: Record<string, SchemaSourceCoordinate>
  versionHash: string
  typeTargets?: SchemaTypeTarget[]
}

export type SchemaDiagnostic = {
  severity: 'error' | 'warning' | 'info'
  code: string
  message: string
  source?: SchemaSourceCoordinate
}

export type SchemaSourceCoordinate =
  | {
      kind: 'file'
      filePath: string
      pointer: string
      line?: number
      column?: number
    }
  | {
      kind: 'db'
      entity: string
      id: string
      pointer: string
    }

export type SchemaRefEdge = {
  from: string
  to?: string
  ref: string
  kind: string
  source: SchemaSourceCoordinate
}

export type SchemaValidateResult = {
  valid: boolean
  diagnostics: SchemaDiagnostic[]
}

export type SchemaTypeTarget = {
  id: string
  name: string
  kind: string
  source?: SchemaSourceCoordinate
}
```

## OA SDK Mapping

| Shared field | OA SDK source |
|---|---|
| `projection` | `DefinitionOpenApiEmitResult.document` or a registry/target-specific projection artifact |
| `refs` | `DefinitionRegistry.refEdges` mapped to file-backed `SchemaRefEdge` |
| `diagnostics` | Registry, target, output naming, emit, validation diagnostics normalized by severity/code/message |
| `sources` | `DefinitionRegistry.nodes` keyed by canonical id, with file path + JSON Pointer and optional source location |
| `versionHash` | Stable hash of selected canonical ids + content hashes, or CLI file hashes through `WorkspaceIndex` |
| `typeTargets` | Future typegen alias/output metadata |

OA SDK source loading, target config parsing, workspace indexing, CLI execution, and code generation remain outside the shared package.

## bun-graph-db Mapping

| Shared field | bun-graph-db source |
|---|---|
| `projection` | `TableSchemaProjection.document` |
| `refs` | `TableSchemaProjection.refs` |
| `diagnostics` | `TableSchemaProjection.diagnostics` and runtime validation errors |
| `sources` | `TableSchemaProjection.sources` |
| `versionHash` | `TableSchemaProjection.versionHash` |
| `typeTargets` | Future helper-type metadata from projected table schemas |

bun-graph-db repository loading, table/attribute entity conversion, GraphQL/REST/MCP transport code, table-scoped cache invalidation, docs generation, and runtime storage remain outside the shared package.

## Extraction Gates

The contract package already exists. Do not extract shared source loading, projection construction, runtime validation, cache management, or transport implementation until all of these are true:

- Each project has at least two non-test, non-adapter call sites that need the same value-level implementation primitive.
- Each project has adapter tests proving its native projection maps to this vocabulary without importing the other project.
- Adapters are thin field mappings, not reimplementations of projection logic.
- Diagnostic code families and source coordinate semantics are stable enough to version.
- Shared code can be tested without file I/O, database repositories, SQLite, GraphQL, REST, MCP, or CLI state.
- The proposed implementation does not require either native source model to replace the other.
- Incremental invalidation remains owned by the host system: OA SDK keeps `WorkspaceIndex`, and bun-graph-db keeps table-scoped MCP cache refresh/removal plus docs/template freshness markers.
- Package ownership, release cadence, public export policy, and migration rollback are explicit.

Until then, keep sharing at the OpenAPI 3.2 projection contract and validation layer.
