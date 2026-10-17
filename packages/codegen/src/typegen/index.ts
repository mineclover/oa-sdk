/**
 * @oa-sdk/codegen/typegen — OAS → TypeScript 타입 생성
 *
 * 사용 예시:
 *   import { parseDocument } from '@oa-sdk/parser'
 *   import { generateTypes } from '@oa-sdk/codegen/typegen'
 *
 *   const doc = parseDocument(spec)
 *   const tsCode = generateTypes(doc)
 *   writeFileSync('types.ts', tsCode)
 */

export { analyzeExternalSchemaRefs, generateTypes, generateTypesFromSpec } from './generate-types.js'
export type {
  ExternalSchemaRefAnalysis,
  ExternalSchemaRefDiagnostic,
  ExternalSchemaRefDiagnosticCode,
  ExternalSchemaTypeAlias,
  TypegenOptions,
  TypegenProvenanceEntry,
} from './generate-types.js'
export { createTypescriptAlgebra, schemaToTs, typescriptAlgebra } from './schema-to-ts.js'
export type { SchemaToTsOptions } from './schema-to-ts.js'
export { analyzeSchemaFidelity, projectSchemaToTs } from './schema-fidelity.js'
export type {
  SchemaToTsProjection,
  TypegenFidelity,
  TypegenFidelityAnalysis,
  TypegenFidelityDiagnostic,
  TypegenFidelityDiagnosticCode,
} from './schema-fidelity.js'
export { pascalCase, escapeKey, quoteTypeScriptString, collectTypeNames } from '@oa-sdk/core'
