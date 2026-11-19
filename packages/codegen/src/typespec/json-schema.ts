import type { GeneratedGuardArtifact } from '@oa-sdk/ast-sync/guards'
import type { OasDocument, OasSchema } from '@oa-sdk/parser'
import { compileTypeSpecInMemory } from '../plugin/compiler.js'
import type { TspConfigInput } from '../plugin/types.js'
import { generateStandaloneGuards } from '../standalone-guards/index.js'
import { generateTypesFromSpec } from '../typegen/generate-types.js'
import type { TypeSpecNamedAlias } from './aliases.js'

export interface TypeSpecJsonSchemaOptions {
  /** Model names to emit JSON Schema Draft 2020-12 documents for (defaults to all models in `.tsp`). */
  models?: readonly string[] | undefined
  /** Optional `$id` URI per model name (`{ [modelName]: 'https://.../schema.json' }`). */
  schemaIds?: Readonly<Record<string, string>> | undefined
  /** OpenAPI target dialect used during TypeSpec extraction (default: `'3.1.0'`). */
  openApiVersion?: '3.0.0' | '3.1.0' | '3.2.0' | undefined
  /** Enforce `additionalProperties: false` on object schemas with `properties` that do not explicitly allow extras (default: `true`). */
  closedObjects?: boolean | undefined
  /** Convert single-element string `enum: [literal]` schemas into JSON Schema 2020-12 `const: literal` (default: `true`). */
  normalizeSingleEnumToConst?: boolean | undefined
  /** Emit TypeScript declarations (`typesDts`) preserving extracted named TypeSpec `alias` unions (default: `true`). */
  includeTypes?: boolean | undefined
  /** Render zero-dependency standalone ESM guards (`guardArtifacts`) in memory (default: `false`). */
  includeGuards?: boolean | undefined
  /** Emit `validate<Name>` and `assert<Name>` alongside `is<Name>` when `includeGuards` is true (default: `false`). */
  includeAssertions?: boolean | undefined
  /** Virtual/target output directory passed to `generateStandaloneGuards` (default: `'.'`). */
  guardsOutDir?: string | undefined
  /** Type import specifier used in generated guard `.d.ts` files (default: `'./types.js'`). */
  typeImportSpecifier?: string | undefined
  /** Controls `{ "type": "module" }` `package.json` emission if guards are later written (default: `'auto'`). */
  writePackageJson?: boolean | 'auto' | undefined
}

export interface TypeSpecJsonSchemaResult {
  entrypoint: string
  sourceFiles: string[]
  namedAliases: TypeSpecNamedAlias[]
  componentSchemas: Record<string, Record<string, unknown>>
  jsonSchemas: Record<string, Record<string, unknown>>
  openApiDocument: Record<string, unknown>
  typesDts?: string | undefined
  guardArtifacts?: GeneratedGuardArtifact[] | undefined
}

const KEY_PRIORITY = new Map<string, number>([
  ['$schema', 0],
  ['$id', 1],
  ['title', 2],
  ['description', 3],
  ['type', 4],
  ['const', 5],
  ['enum', 6],
  ['format', 7],
  ['pattern', 8],
  ['minLength', 9],
  ['maxLength', 10],
  ['minimum', 11],
  ['maximum', 12],
  ['minItems', 13],
  ['maxItems', 14],
  ['items', 15],
  ['properties', 16],
  ['required', 17],
  ['additionalProperties', 18],
  ['$defs', 99],
])

function orderSchemaKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.keys(obj).sort((a, b) => {
    const pa = KEY_PRIORITY.get(a) ?? 50
    const pb = KEY_PRIORITY.get(b) ?? 50
    if (pa !== pb) return pa - pb
    return a.localeCompare(b)
  })
  const ordered: Record<string, unknown> = {}
  for (const key of keys) {
    ordered[key] = obj[key]
  }
  return ordered
}

function normalizeSchemaNode(
  node: unknown,
  refPrefix: '#/$defs/' | '#/components/schemas/',
  opts: { closedObjects: boolean; normalizeSingleEnumToConst: boolean },
): unknown {
  if (Array.isArray(node)) {
    return node.map(item => normalizeSchemaNode(item, refPrefix, opts))
  }
  if (!node || typeof node !== 'object') {
    return node
  }

  const record = node as Record<string, unknown>
  const out: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(record)) {
    if (key === '$ref' && typeof value === 'string') {
      const refName = value.split('/').pop()!
      out.$ref = `${refPrefix}${refName}`
    } else if (key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)) {
      const sortedProps: Record<string, unknown> = {}
      for (const propKey of Object.keys(value as Record<string, unknown>).sort()) {
        sortedProps[propKey] = normalizeSchemaNode((value as Record<string, unknown>)[propKey], refPrefix, opts)
      }
      out.properties = sortedProps
    } else if (key === 'required' && Array.isArray(value)) {
      out.required = [...value].map(String).sort()
    } else if (
      opts.normalizeSingleEnumToConst
      && key === 'enum'
      && Array.isArray(value)
      && value.length === 1
      && record.type === 'string'
    ) {
      out.const = value[0]
    } else {
      out[key] = normalizeSchemaNode(value, refPrefix, opts)
    }
  }

  if (opts.closedObjects && out.type === 'object' && out.properties && out.additionalProperties === undefined) {
    out.additionalProperties = false
  }

  return orderSchemaKeys(out)
}

function collectReachableSchemaNames(
  rootName: string,
  allSchemas: Readonly<Record<string, Record<string, unknown>>>,
): Set<string> {
  const visited = new Set<string>()
  const queue: string[] = []

  const scanNode = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const item of node) scanNode(item)
      return
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === '$ref' && typeof value === 'string') {
        const refName = value.split('/').pop()
        if (refName && refName !== rootName && !visited.has(refName) && refName in allSchemas) {
          visited.add(refName)
          queue.push(refName)
        }
      } else {
        scanNode(value)
      }
    }
  }

  const root = allSchemas[rootName]
  if (root) {
    scanNode(root)
  }
  while (queue.length > 0) {
    const dep = queue.shift()!
    const depSchema = allSchemas[dep]
    if (depSchema) scanNode(depSchema)
  }
  return visited
}

/**
 * Compiles any `.tsp` file (including pure data-model files with no `@service` or HTTP routes)
 * into Draft 2020-12 JSON Schemas, a normalized OpenAPI 3.1.0 document, TypeScript declarations
 * preserving named TypeSpec `alias` unions, and optional zero-eval standalone guards.
 */
export async function compileTypeSpecToJsonSchemas(
  input: TspConfigInput,
  options: TypeSpecJsonSchemaOptions = {},
): Promise<TypeSpecJsonSchemaResult> {
  const closedObjects = options.closedObjects !== false
  const normalizeSingleEnumToConst = options.normalizeSingleEnumToConst !== false
  const openApiVersion = options.openApiVersion ?? '3.1.0'

  const compiled = await compileTypeSpecInMemory(input, {
    openApiVersion,
    omitUnreachableTypes: false,
  })

  const rawSchemas: Record<string, unknown> = compiled.document.components?.schemas ?? {}

  const componentSchemas: Record<string, Record<string, unknown>> = {}
  for (const name of Object.keys(rawSchemas).sort()) {
    const rawSchema = rawSchemas[name]
    if (!rawSchema || typeof rawSchema !== 'object') continue
    componentSchemas[name] = normalizeSchemaNode(rawSchema, '#/components/schemas/', {
      closedObjects,
      normalizeSingleEnumToConst,
    }) as Record<string, unknown>
  }

  const targetModels = options.models && options.models.length > 0
    ? [...options.models]
    : Object.keys(componentSchemas)

  for (const modelName of targetModels) {
    if (!(modelName in componentSchemas)) {
      throw new Error(`TypeSpec compilation did not produce schema "${modelName}" in ${compiled.entrypoint}`)
    }
  }

  const jsonSchemas: Record<string, Record<string, unknown>> = {}
  for (const modelName of targetModels) {
    const rawRoot = rawSchemas[modelName]
    const normalizedRoot = normalizeSchemaNode(rawRoot, '#/$defs/', {
      closedObjects,
      normalizeSingleEnumToConst,
    }) as Record<string, unknown>

    const reachable = collectReachableSchemaNames(modelName, componentSchemas)
    const defs: Record<string, Record<string, unknown>> = {}
    for (const depName of Array.from(reachable).sort()) {
      const normalizedDep = normalizeSchemaNode(rawSchemas[depName], '#/$defs/', {
        closedObjects,
        normalizeSingleEnumToConst,
      }) as Record<string, unknown>
      defs[depName] = normalizedDep
    }

    const schemaId = options.schemaIds?.[modelName]
    const doc: Record<string, unknown> = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      ...(schemaId ? { $id: schemaId } : {}),
      title: modelName,
      ...normalizedRoot,
    }
    if (Object.keys(defs).length > 0) {
      doc.$defs = defs
    }
    jsonSchemas[modelName] = doc
  }

  const rawInfo = compiled.document.info
  const componentOasSchemas: Record<string, OasSchema> = {}
  for (const [name, schema] of Object.entries(componentSchemas)) {
    componentOasSchemas[name] = schema as OasSchema
  }
  const oasDocument: OasDocument = {
    openapi: openApiVersion,
    info: {
      title: rawInfo.title && rawInfo.title !== '(title)'
        ? rawInfo.title
        : 'TypeSpec Data Contracts',
      version: rawInfo.version || '1.0.0',
      ...(rawInfo.description ? { description: rawInfo.description } : {}),
    },
    paths: compiled.document.paths ?? {},
    components: {
      schemas: componentOasSchemas,
    },
  }
  const openApiDocument: Record<string, unknown> = {
    openapi: oasDocument.openapi,
    info: oasDocument.info,
    paths: oasDocument.paths ?? {},
    components: {
      schemas: componentSchemas,
    },
  }

  let typesDts: string | undefined
  if (options.includeTypes !== false) {
    typesDts = generateTypesFromSpec(oasDocument, {
      banner: false,
      extraAliases: compiled.namedAliases,
    })
  }

  let guardArtifacts: GeneratedGuardArtifact[] | undefined
  if (options.includeGuards === true && targetModels.length > 0) {
    guardArtifacts = await generateStandaloneGuards({
      schemaDocument: openApiDocument,
      outDir: options.guardsOutDir ?? '.',
      schemas: targetModels,
      dryRun: true,
      includeAssertions: options.includeAssertions,
      writePackageJson: options.writePackageJson,
      typeImportSpecifier: options.typeImportSpecifier ?? './types.js',
    })
  }

  return {
    entrypoint: compiled.entrypoint,
    sourceFiles: compiled.sourceFiles,
    namedAliases: compiled.namedAliases,
    componentSchemas,
    jsonSchemas,
    openApiDocument,
    ...(typesDts !== undefined ? { typesDts } : {}),
    ...(guardArtifacts !== undefined ? { guardArtifacts } : {}),
  }
}
