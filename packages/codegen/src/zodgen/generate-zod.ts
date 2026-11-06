/**
 * OpenAPI 3.2 Document → Zod 4 source code generator
 *
 * Emits TypeScript code with:
 *   - import { z } from 'zod'
 *   - export const <Name>Schema = z.object(...)
 *   - export type <Name> = z.infer<typeof <Name>Schema>
 * Formatted with formatGeneratedTs.
 */

import {
  escapeJsonPointerToken,
  foldSchema,
  type OasDocument,
  type OasSchema,
  type LintResult,
  type LintSeverity,
  type LintCategory,
} from '@oa-sdk/parser'
import { formatGeneratedTs, toTypeScriptIdentifier, pascalCase } from '@oa-sdk/core'
import type { OpenApiCollectProfile } from '../cli/lib/openapi-collect.js'
import { prepareCodegenDocument, findCircularSchemas, parseRefTarget, extractRefsFromNode } from '../schema-graph/index.js'
export { parseRefTarget, extractRefsFromNode, findCircularSchemas } from '../schema-graph/index.js'
import {
  createZod4Algebra,
  prepareSchemaForZod,
  collectDiscriminatorProperties,
  type Zod4AlgebraOptions,
} from './schema-to-zod.js'

export interface GenerateZodOptions extends Zod4AlgebraOptions {
  /** Include auto-generated banner comment (default: true) */
  banner?: boolean | undefined
  /** Emission style: 'both' exports schemas & inferred types; 'schema' exports only schemas (default: 'both') */
  style?: 'schema' | 'both' | undefined
  /** Explicit flag to enable/disable type exports (defaults to true unless style === 'schema') */
  exportTypes?: boolean | undefined
  /** Run preflight schema validation (default: true) */
  validate?: boolean | undefined
  /** Categories to validate when preflight validation is enabled (default: ['structure', 'refs', 'components']) */
  lintCategories?: LintCategory[] | undefined
  /** Minimum severity that causes preflight validation to fail and halt generation (default: 'error') */
  failOnSeverity?: LintSeverity | undefined
  /** Normalize OpenAPI document before generation (default: true) */
  normalize?: boolean | undefined
  /** Normalization profile to use when normalize is enabled (default: 'generic') */
  normalizeProfile?: OpenApiCollectProfile | undefined
  /** Force generation even if fatal preflight validation issues are detected */
  force?: boolean | undefined
  /** Custom rule configuration for preflight linting ('off' | 'warn' | 'error') */
  rules?: Record<string, 'off' | 'warn' | 'error'> | undefined
  /** Base path for resolving relative external $refs during linting/validation */
  basePath?: string | undefined
  /** Source location lookup function for mapping pointers to line/column */
  lookupSourceLocation?: ((filePath: string, pointer: string) => { line: number; column: number } | undefined) | undefined
  /** Optional cache for schema $ref extraction (defaults to module-scoped WeakMap cache) */
  schemaRefCache?: WeakMap<object, Set<string>> | undefined
}

export class ZodGenerationPreflightError extends Error {
  readonly diagnostics: LintResult[]

  constructor(diagnostics: LintResult[], message?: string) {
    const defaultMessage = formatPreflightErrorMessage(diagnostics)
    super(message ?? defaultMessage)
    this.name = 'ZodGenerationPreflightError'
    this.diagnostics = diagnostics
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

function formatDiagnosticLocation(
  diagnostic: LintResult,
  options?: {
    basePath?: string | undefined
    lookupSourceLocation?: ((filePath: string, pointer: string) => { line: number; column: number } | undefined) | undefined
  } | undefined,
): string {
  if (diagnostic.source?.filePath) {
    const coords = diagnostic.source.line !== undefined
      ? `:${diagnostic.source.line}:${diagnostic.source.column ?? 0}`
      : ''
    return `${diagnostic.path} (${diagnostic.source.filePath}${coords})`
  }
  if (options?.basePath) {
    const resolved = options.lookupSourceLocation?.(options.basePath, diagnostic.path)
    if (resolved) {
      return `${diagnostic.path} (${options.basePath}:${resolved.line}:${resolved.column})`
    }
    return `${diagnostic.path} (${options.basePath})`
  }
  return diagnostic.path
}

function formatPreflightErrorMessage(
  diagnostics: LintResult[],
  options?: Pick<GenerateZodOptions, 'basePath' | 'lookupSourceLocation'>,
): string {
  const lines = diagnostics.map(d => {
    const loc = formatDiagnosticLocation(d, options)
    return `  - [${d.severity.toUpperCase()}] [${d.rule}] ${d.message} (at ${loc})`
  })
  return `Zod 4 code generation aborted due to preflight validation failure (${diagnostics.length} issue(s)):\n${lines.join('\n')}`
}

function formatPreflightDiagnostics(
  diagnostics: LintResult[],
  options?: {
    basePath?: string | undefined
    lookupSourceLocation?: ((filePath: string, pointer: string) => { line: number; column: number } | undefined) | undefined
  } | undefined,
): string {
  return diagnostics
    .map(d => {
      const location = formatDiagnosticLocation(d, options)
      return `  - [${d.severity.toUpperCase()}] [${d.rule}] ${d.message} (at ${location})`
    })
    .join('\n')
}

function createDiagnostic(
  path: string,
  severity: LintSeverity,
  rule: string,
  message: string,
  options?: Pick<GenerateZodOptions, 'basePath' | 'lookupSourceLocation'>,
): LintResult {
  const result: LintResult = { path, severity, rule, message }
  if (options?.basePath) {
    const loc = options.lookupSourceLocation?.(options.basePath, path)
    result.source = {
      filePath: options.basePath,
      pointer: path,
      sourceFilePath: options.basePath,
      sourcePointer: path,
      ...(loc !== undefined ? { line: loc.line, column: loc.column } : {}),
    }
  }
  return result
}

/**
 * Generates formatted TypeScript source code containing Zod 4 schemas and inferred types
 * from an OpenAPI 3.2 document.
 *
 * @param doc OAS 3.2 document object
 * @param options Generation options
 * @returns Formatted TypeScript source code
 */
export function generateZodFromSpec(doc: OasDocument, options: GenerateZodOptions = {}): string {
  const prepared = prepareCodegenDocument(doc, options)
  if (prepared.fatal.length > 0) {
    if (options.force) {
      console.warn(
        `[generateZodFromSpec] Warning: Preflight validation detected ${prepared.fatal.length} fatal issue(s) (--force enabled, proceeding best-effort):\n` +
        formatPreflightDiagnostics(prepared.fatal, options),
      )
    } else {
      throw new ZodGenerationPreflightError(
        prepared.fatal,
        formatPreflightErrorMessage(prepared.fatal, options),
      )
    }
  }

  const schemas: Record<string, OasSchema> = prepared.schemas

  const circularSchemas = findCircularSchemas(schemas, options.schemaRefCache)
  const discriminatorProperties = new Set<string>(options.discriminatorProperties ?? [])
  for (const s of Object.values(schemas)) {
    collectDiscriminatorProperties(s, discriminatorProperties)
  }

  const suffix = options.schemaSuffix ?? 'Schema'
  const refNameOverrides: Record<string, string> = { ...options.refNameOverrides }

  // Disambiguate schema identifiers if any special character normalizations collide
  const schemaConstNames = new Map<string, string>()
  const typeNames = new Map<string, string>()
  const usedConstNames = new Set<string>()
  const usedTypeNames = new Set<string>()

  const sortedSchemaNames = Object.keys(schemas).sort((a, b) => a.localeCompare(b))
  for (const name of sortedSchemaNames) {
    const baseIdent = toTypeScriptIdentifier(pascalCase(name))
    let ident = baseIdent
    let typeCounter = 2
    while (usedTypeNames.has(ident)) {
      ident = `${baseIdent}${typeCounter++}`
    }
    usedTypeNames.add(ident)
    typeNames.set(name, ident)

    const baseConst = `${ident}${suffix}`
    let schemaConst = baseConst
    let constCounter = 2
    while (usedConstNames.has(schemaConst)) {
      schemaConst = `${baseConst}${constCounter++}`
    }
    usedConstNames.add(schemaConst)
    schemaConstNames.set(name, schemaConst)

    const schemaConstName = schemaConst
    refNameOverrides[`#/components/schemas/${name}`] = `z.lazy(() => ${schemaConstName})`
    const encoded = encodeURIComponent(name)
    if (encoded !== name) {
      refNameOverrides[`#/components/schemas/${encoded}`] = `z.lazy(() => ${schemaConstName})`
    }
    const jsonPointerToken = escapeJsonPointerToken(name)
    if (jsonPointerToken !== name) {
      refNameOverrides[`#/components/schemas/${jsonPointerToken}`] = `z.lazy(() => ${schemaConstName})`
      const encToken = encodeURIComponent(jsonPointerToken)
      if (encToken !== jsonPointerToken) {
        refNameOverrides[`#/components/schemas/${encToken}`] = `z.lazy(() => ${schemaConstName})`
      }
    }
  }

  const defaultValues = options.defaultValues ?? new WeakMap<OasSchema, unknown>()
  const algebra = createZod4Algebra({
    ...options,
    refNameOverrides,
    defaultValues,
    schemaSuffix: suffix,
    discriminatorProperties,
  })

  const lines: string[] = []
  if (options.banner !== false) {
    lines.push('// Auto-generated from OpenAPI 3.2 spec by @oa-sdk/codegen')
    lines.push('// Do not edit directly.')
    lines.push('')
  }
  lines.push("import { z } from 'zod'")
  lines.push('')

  const shouldExportTypes = options.exportTypes !== false && options.style !== 'schema'
  const sortedEntries = Object.entries(schemas).sort(([a], [b]) => a.localeCompare(b))

  for (const [name, rawSchema] of sortedEntries) {
    const ident = typeNames.get(name) ?? toTypeScriptIdentifier(pascalCase(name))
    const schemaConstName = schemaConstNames.get(name) ?? `${ident}${suffix}`
    const cleanSchema = prepareSchemaForZod(rawSchema, defaultValues)
    const zodExpr = foldSchema(cleanSchema, algebra)

    const typeAnnotation = circularSchemas.has(name) ? ': z.ZodTypeAny' : ''
    lines.push(`export const ${schemaConstName}${typeAnnotation} = ${zodExpr}`)
    if (shouldExportTypes) {
      lines.push(`export type ${ident} = z.infer<typeof ${schemaConstName}>`)
    }
    lines.push('')
  }

  return formatGeneratedTs(lines.join('\n'))
}
