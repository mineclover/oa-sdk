/**
 * @oa-sdk/codegen
 *
 * Zod 스키마 → OpenAPI 3.2 component YAML 생성 라이브러리.
 *
 * 변환 파이프라인:
 *   Zod Schema → OasSchema → components.yaml
 *
 * Drizzle과 함께 사용 시:
 *   Drizzle Table → drizzle-orm/zod → Zod Schema → OpenAPI Component
 */

export { zodToSchema } from './zod-to-schema.js'
export { generateComponents } from './generator.js'
export { defineConfig } from './config.js'
export { analyzeExternalSchemaRefs, generateTypes, generateTypesFromSpec } from './typegen/generate-types.js'
export { schemaToTs } from './typegen/schema-to-ts.js'
export { createMemoryWorkspaceIndex, createNoopWorkspaceIndex, createWorkspaceIndex } from './workspace-index.js'
export { createSQLiteWorkspaceIndex, SQLITE_WORKSPACE_INDEX_SCHEMA_VERSION } from './sqlite-workspace-index.js'

export type { OasSchema } from './zod-to-schema.js'
export type { CodegenConfig } from './config.js'
export type { ExternalSchemaRefAnalysis, ExternalSchemaRefDiagnostic, ExternalSchemaRefDiagnosticCode, TypegenOptions } from './typegen/generate-types.js'
export type { SchemaToTsOptions } from './typegen/schema-to-ts.js'
export type { OutputOptions, NamedSchema, CodegenResult } from './types.js'
export type { DrizzleCodegenOptions } from './drizzle/index.js'
export type {
  WorkspaceComponentFilter,
  WorkspaceComponentRecord,
  WorkspaceDiagnosticFilter,
  WorkspaceDiagnosticRecord,
  WorkspaceDiagnosticSeverity,
  WorkspaceFileIndexData,
  WorkspaceFileRecord,
  WorkspaceIndex,
  WorkspaceIndexCompatibilityMetadata,
  WorkspaceIndexDiff,
  WorkspaceIndexMode,
  WorkspaceIndexOptions,
  WorkspaceIndexSnapshot,
  WorkspaceRefFilter,
  WorkspaceRefKind,
  WorkspaceRefRecord,
  WorkspaceSourceLocationRecord,
  WorkspaceTypeAliasFilter,
  WorkspaceTypeAliasRecord,
} from './workspace-index.js'
export type { SQLiteWorkspaceIndex, SQLiteWorkspaceIndexOptions } from './sqlite-workspace-index.js'
