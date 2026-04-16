# ADR-007 — Shared Schema Engine Vocabulary Draft

## Status

Draft. Do not extract a shared package from this document alone.

## Context

OA SDK and bun-graph-db now both treat schema material as a projection graph.

- OA SDK loads OpenAPI definition fragments, builds a canonical definition registry, rewrites refs, and emits target OpenAPI documents.
- bun-graph-db loads runtime table metadata, projects a `$defs` JSON Schema document, validates node values, and exposes projection freshness to MCP/docs flows.

The common layer is not file loading, repository access, CLI execution, MCP, REST, GraphQL, or SQLite invalidation. The common layer is the shape of a pure schema projection artifact.

## Vocabulary

The names below are provisional. They are deliberately small enough to map from both projects without extracting code.

```ts
export type SchemaProjectionEnvelope<TProjection> = {
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

## bun-graph-db Mapping

| Shared field | bun-graph-db source |
|---|---|
| `projection` | `TableSchemaProjection.document` |
| `refs` | `TableSchemaProjection.refs` |
| `diagnostics` | `TableSchemaProjection.diagnostics` and runtime validation errors |
| `sources` | `TableSchemaProjection.sources` |
| `versionHash` | `TableSchemaProjection.versionHash` |
| `typeTargets` | Future helper-type metadata from projected table schemas |

## Extraction Gate

Do not create a shared package until all of these are true:

- Each project has at least one adapter test proving its native projection maps to this vocabulary without importing the other project.
- Adapters are thin field mappings, not reimplementations of projection logic.
- Diagnostic code families and source coordinate semantics are stable enough to version.
- Shared code can be tested without file I/O, database repositories, SQLite, GraphQL, REST, MCP, or CLI state.
- Both projects have more than one real call site that would consume the shared vocabulary directly.

Until then, keep this as a vocabulary contract and local adapter tests.
