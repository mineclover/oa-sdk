/**
 * @oa-sdk/parser — OpenAPI 3.2 spec 파서
 *
 * SWC 스타일 Parse → Transform → Generate 파이프라인의 Parse/Transform 계층.
 *
 * 소비자:
 *   @oa-sdk/mock-server — IR → mock 핸들러
 *   @oa-sdk/codegen     — IR → TypeScript 타입 (Phase 4)
 *   @oa-sdk/router      — IR → 서버 라우터 스텁 (Phase 5)
 */

// ─── OAS 3.2 전체 타입 (types/ 디렉터리) ──────────────────────────────────
export type * from './types/index.js'

// ─── IR 타입 ──────────────────────────────────────────────────────────────
export type {
  HttpMethod,
  OperationEntry,
  RouteIndex,
  MatchResult,
  ParsedDocument,
} from './types.js'

// ─── 풀 문서 파서 ─────────────────────────────────────────────────────────
export { parseDocument } from './parse.js'
export type { ParseDocumentOptions } from './parse.js'

// ─── 레거시 호환: 라우트 중심 로더 ────────────────────────────────────────
export { loadSchema, matchRoute, HTTP_METHODS } from './schema-loader.js'

// ─── 파이프라인 (SpecPass[]) ──────────────────────────────────────────────
export { runPipeline, derefPass, createDerefPass, DEFAULT_PASSES } from './pipeline.js'
export type { SpecPass } from './pipeline.js'

// ─── Fold 패턴 (SchemaAlgebra) ────────────────────────────────────────────
export { foldSchema } from './fold.js'
export type { SchemaAlgebra } from './fold.js'

// ─── Folder 패턴 (SchemaFolder / DerefFolder) ────────────────────────────
export { SchemaFolder } from './folder.js'
export { DerefFolder, derefSpec, derefSpecWithDiagnostics } from './deref.js'
export type { DerefCycleStrategy, DerefDiagnostic, DerefDiagnosticCode, DerefOptions } from './deref.js'

// ─── Query API ────────────────────────────────────────────────────────────
export { findOperation, findByTag, findByPath, getSchema, getTag, groupByTag, describeApi, resolveServerUrl } from './query.js'

// ─── Ref Graph ─────────────────────────────────────────────────────────────
export { collectRefs, isRelativeRef, resolvePointer, resolveRefGraph } from './ref-graph.js'
export type { RefGraph, RefGraphDiagnostic, RefGraphDiagnosticCode, RefGraphNode, RefGraphOptions, RefKind } from './ref-graph.js'

// ─── Source Locations ──────────────────────────────────────────────────────
export { createSourceLocationIndex, createYamlSourceLocationIndex } from './source-location.js'
export type { SourceLocation, SourceLocationIndex, SourceLocationIndexOptions, SourceLocationSyntax } from './source-location.js'

// ─── Definition IDs ────────────────────────────────────────────────────────
export {
  CANONICAL_DEFINITION_KINDS,
  COMPONENT_LIKE_DEFINITION_KINDS,
  parseDefinitionId,
  validateDefinitionId,
  validateDefinitionIds,
} from './definition-id.js'
export type {
  CanonicalDefinitionId,
  ComponentLikeDefinitionKind,
  DefinitionId,
  DefinitionIdDiagnostic,
  DefinitionIdDiagnosticCode,
  DefinitionIdListValidationResult,
  DefinitionIdValidationResult,
  DefinitionKind,
} from './definition-id.js'

// ─── Definition Nodes ──────────────────────────────────────────────────────
export { createDefinitionNode, createDefinitionRef } from './definition-node.js'
export type {
  CreateDefinitionNodeInput,
  CreateDefinitionRefInput,
  DefinitionMetadata,
  DefinitionNode,
  DefinitionRef,
} from './definition-node.js'

// ─── Lint ─────────────────────────────────────────────────────────────────
export { lintDocument } from './lint.js'
export type { LintResult, LintSeverity, LintOptions } from './lint.js'

// ─── Validate ─────────────────────────────────────────────────────────────
export { validateDocument } from './validate.js'
export type { ValidationResult } from './validate.js'
