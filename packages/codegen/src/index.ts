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

export type { OasSchema } from './zod-to-schema.js'
export type { CodegenConfig } from './config.js'
export type { OutputOptions, NamedSchema, CodegenResult } from './types.js'
export type { DrizzleCodegenOptions } from './drizzle/index.js'
