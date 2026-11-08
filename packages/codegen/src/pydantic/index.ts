/**
 * OAS 3.2 → Pydantic v2 code generation as a staged data pipeline.
 * Design: docs/internal/architecture/pydantic-codegen-pipeline.md
 */
// S2 is shared with the Zod generator; re-exported so every stage can be composed by hand.
export { analyzeSchemaGraph } from '../schema-graph/index.js'
export type { DiscriminatorFamily, SchemaGraphAnalysis } from '../schema-graph/index.js'
export * from './options.js'
export * from './ir.js'
export * from './prepare.js'
export * from './lower.js'
export * from './passes/index.js'
export * from './render.js'
export * from './render-operations.js'
export * from './emit.js'
export * from './build.js'
