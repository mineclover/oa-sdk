/**
 * OAS 3.2 → Pydantic v2 code generation as a staged data pipeline.
 * Design: docs/internal/architecture/pydantic-codegen-pipeline.md
 */
export * from './options.js'
export * from './ir.js'
export * from './prepare.js'
export * from './lower.js'
export * from './passes/index.js'
export * from './render.js'
export * from './emit.js'
export * from './build.js'
