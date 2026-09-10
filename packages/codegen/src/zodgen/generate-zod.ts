/**
 * OpenAPI 3.2 Document → Zod 4 source code generator
 *
 * Emits TypeScript code with:
 *   - import { z } from 'zod'
 *   - export const <Name>Schema = z.object(...)
 *   - export type <Name> = z.infer<typeof <Name>Schema>
 * Formatted with formatGeneratedTs.
 */

import { parseDocument, foldSchema, type OasDocument, type OasSchema } from '@oa-sdk/parser'
import { formatGeneratedTs, toTypeScriptIdentifier, pascalCase } from '@oa-sdk/core'
import { createZod4Algebra, prepareSchemaForZod, type Zod4AlgebraOptions } from './schema-to-zod.js'

export interface GenerateZodOptions extends Zod4AlgebraOptions {
  /** Include auto-generated banner comment (default: true) */
  banner?: boolean
  /** Emission style: 'both' exports schemas & inferred types; 'schema' exports only schemas (default: 'both') */
  style?: 'schema' | 'both'
  /** Explicit flag to enable/disable type exports (defaults to true unless style === 'schema') */
  exportTypes?: boolean
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
  const parsed = parseDocument(doc, [])
  const schemas = parsed.schemas ?? {}

  const suffix = options.schemaSuffix ?? 'Schema'
  const refNameOverrides: Record<string, string> = { ...options.refNameOverrides }

  // Map all component schema refs to lazy accessors
  for (const name of Object.keys(schemas)) {
    const ident = toTypeScriptIdentifier(pascalCase(name))
    const schemaConstName = `${ident}${suffix}`
    refNameOverrides[`#/components/schemas/${name}`] = `z.lazy(() => ${schemaConstName})`
    const encoded = encodeURIComponent(name)
    if (encoded !== name) {
      refNameOverrides[`#/components/schemas/${encoded}`] = `z.lazy(() => ${schemaConstName})`
    }
  }

  const defaultValues = options.defaultValues ?? new WeakMap<OasSchema, unknown>()
  const algebra = createZod4Algebra({
    ...options,
    refNameOverrides,
    defaultValues,
    schemaSuffix: suffix,
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
    const ident = toTypeScriptIdentifier(pascalCase(name))
    const schemaConstName = `${ident}${suffix}`
    const cleanSchema = prepareSchemaForZod(rawSchema, defaultValues)
    const zodExpr = foldSchema(cleanSchema, algebra)

    lines.push(`export const ${schemaConstName} = ${zodExpr}`)
    if (shouldExportTypes) {
      lines.push(`export type ${ident} = z.infer<typeof ${schemaConstName}>`)
    }
    lines.push('')
  }

  return formatGeneratedTs(lines.join('\n'))
}
