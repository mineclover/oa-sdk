/**
 * @oa-sdk/codegen/typespec — Zero-Zod TypeSpec (.tsp) compilation, alias extraction & JSON Schema 2020-12 subpath
 */

export {
  compileTypeSpecInMemory,
  resolveTypeSpecEntrypoint,
  absolutizeTspInput,
  type TypeSpecCompilationError,
  type TypeSpecCompilerOptions,
  type TypeSpecCompilerResult,
} from '../plugin/compiler.js'
export { createTypeSpecFallbackHost } from './host.js'
export {
  extractTypeSpecNamedAliases,
  renderNamedAliasDeclarations,
  type TypeSpecNamedAlias,
} from './aliases.js'
export {
  compileTypeSpecToJsonSchemas,
  type TypeSpecJsonSchemaOptions,
  type TypeSpecJsonSchemaResult,
} from './json-schema.js'
