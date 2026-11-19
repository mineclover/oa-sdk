/**
 * @oa-sdk/codegen — Standalone Lightweight Type Guard Generator Types
 */

/**
 * Normalized validation diagnostic entry exposed via `guard.errors` and `validate*().errors`.
 */
export interface StandaloneGuardError {
  instancePath: string
  schemaPath: string
  keyword: string
  params?: Record<string, unknown> | undefined
  message?: string | undefined
}

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
  /** Whether to enable Tier 1 fast-path predicate generation for this guard */
  fastPath?: boolean | undefined
  /** Explicit discriminator property name for O(1) union dispatch table */
  discriminator?: string | { propertyName: string; mapping?: Record<string, string> } | undefined
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
  /** Filter generation to only the requested schema type names or guard function names */
  schemas?: string[] | undefined
  /** Whether to output individual modular files per schema in guards/ alongside root index.js */
  split?: boolean | undefined
  /** Optional module/package specifier for TypeScript type imports (e.g., '@oa-sdk/models' or './types.js') */
  typeImportSpecifier?: string | undefined
  /** Schema name -> generated TypeScript declaration name. Does not change schema identity or guard exports. */
  typeNames?: Readonly<Record<string, string>> | undefined
  /** Render artifacts without creating directories, package metadata, or files. */
  dryRun?: boolean | undefined
  /** Whether to generate TypeScript declaration (.d.ts) files. Defaults to true. */
  generateDeclarations?: boolean | undefined
  /** Also emit zero-dependency `validate<Name>()` and `assert<Name>()` helpers alongside `is<Name>()`. */
  includeAssertions?: boolean | undefined
  /** Controls `{ "type": "module" }` `package.json` emission in `outDir`. Defaults to `'auto'` (skip when an ancestor `package.json` already declares `"type": "module"`). */
  writePackageJson?: boolean | 'auto' | undefined
  /** Target module format. Defaults to 'esm'. */
  moduleFormat?: 'esm' | undefined
  /** Whether to generate Tier 1 O(1) fast-path validation predicates (*Fast) */
  tiered?: boolean | undefined
  /** Whether to generate O(1) polymorphic dispatch tables for discriminated unions */
  polymorphicDispatch?: boolean | undefined
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
