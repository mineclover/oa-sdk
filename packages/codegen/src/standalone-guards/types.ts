/**
 * @oa-sdk/codegen — Standalone Lightweight Type Guard Generator Types
 */

/**
 * Target schema definition for a standalone type guard.
 */
export interface StandaloneGuardTarget {
  /** Name of the exported type guard function (e.g., 'isUserProfile') */
  name: string
  /** Name of the TypeScript type to narrow to (e.g., 'UserProfile'). If empty/omitted, defaults to 'unknown'. */
  typeName?: string | undefined
  /** Schema definition (either a JSON pointer / URI string like '#/$defs/UserProfile' or an inline schema object) */
  schema: Record<string, unknown> | string
}

/**
 * Options for generating standalone lightweight type guards.
 */
export interface StandaloneGuardGeneratorOptions {
  /** Input OpenAPI 3.1 or JSON Schema Draft 2020-12 document */
  schemaDocument: Record<string, unknown>
  /** Output directory where guards will be written */
  outDir: string
  /** Explicit list of guard targets. If omitted, discovered automatically from schemaDocument */
  guards?: StandaloneGuardTarget[] | undefined
  /** Optional module/package specifier for TypeScript type imports (e.g., '@oa-sdk/models' or './types.js') */
  typeImportSpecifier?: string | undefined
  /** Whether to generate TypeScript declaration (.d.ts) files. Defaults to true. */
  generateDeclarations?: boolean | undefined
  /** Target module format. Defaults to 'esm'. */
  moduleFormat?: 'esm' | undefined
}

/**
 * Emitted file artifact produced by the generator.
 */
export interface GeneratedGuardArtifact {
  /** Absolute or relative file path */
  filePath: string
  /** Generated file content */
  content: string
  /** File artifact kind */
  kind: 'js' | 'dts'
}
