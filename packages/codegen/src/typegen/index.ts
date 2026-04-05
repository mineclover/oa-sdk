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

export { generateTypes, generateTypesFromSpec } from './generate-types.js'
export type { TypegenOptions } from './generate-types.js'
export { schemaToTs, typescriptAlgebra } from './schema-to-ts.js'
export { pascalCase, escapeKey, collectTypeNames } from '@oa-sdk/core'
