/**
 * packages/codegen/src/spec-projector.ts
 *
 * High-fidelity Schema Projection Engine for @oa-sdk:
 * Projects the schema entry of a profile target (Zod master schemas or a spec file) to:
 *   1. OpenAPI specifications with canonical x-schema-engine-* extensions
 *      (3.1.0 from Zod; a spec file keeps its own `openapi` version)
 *   2. JSON Schema Draft 2020-12 documents with $defs
 *   3. Standalone type guards via AJV
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { z } from 'zod'
import {
  OPENAPI_PROJECTION_PROFILE_EXTENSION,
  OPENAPI_PROJECTION_VERSION_HASH_EXTENSION,
  OPENAPI_PROJECTION_SOURCES_EXTENSION,
  OPENAPI_PROJECTION_REFS_EXTENSION,
  type SchemaRefEdge,
  type SchemaSourceCoordinate,
} from '@oa-sdk/openapi-projection-contract'
import { appendJsonPointer, loadSchema } from '@oa-sdk/parser'
import type { ProfileTargetConfig, GuardTargetConfig } from './config.js'
import { loadModule, profileTargetArtifactPaths, resolveProfileTarget } from './cli/lib/config-loader.js'
import { zodToSchema } from './zod-to-schema.js'
import { generateStandaloneGuards } from './standalone-guards/index.js'
import type { GeneratedGuardArtifact } from './standalone-guards/types.js'
import { auditCspBundle, type CspAuditResult } from './cli/commands/audit-csp.js'

export interface TargetSpecProjectionResult {
  target: ProfileTargetConfig
  openApiDoc: Record<string, unknown>
  jsonSchemaDoc: Record<string, unknown>
  versionHash: string
  openApiPath: string
  jsonSchemaPath: string
  /** Operations under `paths` (see `countPathOperations`), not the number of paths. */
  operationCount: number
  schemaCount: number
}

export interface TargetGuardProjectionResult {
  artifacts: GeneratedGuardArtifact[]
  guardCount: number
  outDir: string
  cspAudit?: CspAuditResult | undefined
}

/**
 * Strips x-schema-engine-* vendor extensions from an OpenAPI document
 * prior to hashing to avoid circular self-referential hash instability.
 */
export function stripSchemaEngineExtensions<T extends Record<string, unknown>>(
  doc: T,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(doc)) {
    if (!key.startsWith('x-schema-engine-')) {
      result[key] = value
    }
  }
  return result
}

/**
 * Deterministic JSON stringifier with RFC 8785 UTF-16 code-unit key ordering,
 * whitespace stripping, and cross-platform CRLF -> LF normalization.
 */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'string') {
      return JSON.stringify(value.replace(/\r\n/g, '\n'))
    }
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(item => (item === undefined ? 'null' : stableStringify(item))).join(',')}]`
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}

/**
 * Computes deterministic SHA-256 content hash.
 */
export function computeSha256(content: unknown): string {
  const str = typeof content === 'string' ? content : stableStringify(content)
  return 'sha256:' + createHash('sha256').update(str).digest('hex')
}

/**
 * Computes deterministic x-schema-engine-version-hash for an OpenAPI document.
 * Strips all x-schema-engine-* vendor extensions prior to hashing to guarantee
 * bit-for-bit parity between stored spec artifacts and in-memory projections.
 */
export function computeVersionHash(doc: unknown): string {
  let target = doc
  if (typeof target === 'string') {
    try {
      target = JSON.parse(target)
    } catch {
      return computeSha256(target)
    }
  }
  if (target !== null && typeof target === 'object' && !Array.isArray(target)) {
    const coreDoc = stripSchemaEngineExtensions(target as Record<string, unknown>)
    return computeSha256(coreDoc)
  }
  return computeSha256(target)
}

/**
 * Remaps #/$defs/ references to #/components/schemas/ for OpenAPI 3.1.
 */
export function remapRefsToOpenApi<T>(obj: T): T {
  if (!obj || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(remapRefsToOpenApi) as unknown as T
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (key === '$ref' && typeof value === 'string') {
      result[key] = value.replace(/#\/\$defs\//g, '#/components/schemas/')
    } else if (typeof value === 'string' && value.includes('#/$defs/')) {
      result[key] = value.replace(/#\/\$defs\//g, '#/components/schemas/')
    } else {
      result[key] = remapRefsToOpenApi(value)
    }
  }
  return result as T
}

/**
 * Remaps #/components/schemas/ references to #/$defs/ for JSON Schema Draft 2020-12.
 */
export function remapRefsToJsonSchema<T>(obj: T): T {
  if (!obj || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(remapRefsToJsonSchema) as unknown as T
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (key === '$ref' && typeof value === 'string') {
      result[key] = value.replace(/#\/components\/schemas\//g, '#/$defs/')
    } else if (typeof value === 'string' && value.includes('#/components/schemas/')) {
      result[key] = value.replace(/#\/components\/schemas\//g, '#/$defs/')
    } else {
      result[key] = remapRefsToJsonSchema(value)
    }
  }
  return result as T
}

/**
 * Extracts $ref edges from an OpenAPI document.
 */
export function extractRefsFromDocument(doc: unknown, defaultSourcePath = ''): SchemaRefEdge[] {
  const refs: SchemaRefEdge[] = []
  function walk(node: unknown, pointer: string) {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${pointer}/${index}`))
      return
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const currentPointer = appendJsonPointer(pointer, key)
      if (key === '$ref' && typeof value === 'string') {
        const to = value.startsWith('#/') ? value : undefined
        refs.push({
          from: pointer,
          ...(to ? { to } : {}),
          ref: value,
          kind: pointer.includes('/requestBody')
            ? 'requestBody'
            : pointer.includes('/responses')
            ? 'response'
            : 'schema-component',
          source: {
            kind: 'file',
            filePath: defaultSourcePath,
            pointer,
          },
        })
      } else {
        walk(value, currentPointer)
      }
    }
  }
  walk(doc, '#')
  return refs
}

/**
 * Number of operations under `paths`, as `@oa-sdk/parser` indexes them: every
 * fixed-field HTTP method (OAS 3.2 `query` included) and every
 * `additionalOperations` entry of each Path Item, following Path Item `$ref`s
 * within the document. Webhooks are not operations of the described server and
 * are not counted.
 *
 * Only the parser's route index is built (`loadSchema`), not the rest of the
 * `parseDocument` IR. The route index skips any value it cannot read as a Path
 * Item or an Operation, so the count never fails, and a document whose other
 * parts the IR cannot index (a `null` entry in `tags`, say) is still
 * projected: a summary figure must not decide whether projection succeeds.
 */
function countPathOperations(doc: Record<string, unknown>): number {
  // No passes: the document is indexed as it is, following local `$ref`s by JSON pointer.
  let count = 0
  for (const methods of loadSchema(doc, []).values()) count += methods.size
  return count
}

/**
 * Checks whether an unknown export value is a Zod schema.
 */
function isZodType(value: unknown): value is z.ZodTypeAny {
  return Boolean(
    value &&
    typeof value === 'object' &&
    ('_def' in (value as any) || typeof (value as any).safeParse === 'function')
  )
}

/**
 * Dynamically loads schemaEntry and extracts Zod schemas and optional paths/projection.
 */
export async function loadSchemaEntry(schemaEntryPath: string): Promise<{
  schemas: Record<string, z.ZodTypeAny>
  paths: Record<string, unknown>
  customProjection?: { openApiDoc: Record<string, unknown>; jsonSchemaDoc: Record<string, unknown> }
}> {
  // 0. Direct spec file support (.tsp, .yaml, .yml, .json)
  if (schemaEntryPath.endsWith('.tsp')) {
    const { compileTypeSpecInMemory } = await import('./cli/lib/typespec-mock-compiler.js')
    const compiled = await compileTypeSpecInMemory(schemaEntryPath)
    const openApiDoc = compiled.document as unknown as Record<string, unknown>
    const schemasObj = ((openApiDoc.components as any)?.schemas ?? {}) as Record<string, unknown>
    const pathsObj = (openApiDoc.paths ?? {}) as Record<string, unknown>
    return {
      schemas: {},
      paths: pathsObj,
      customProjection: {
        openApiDoc,
        jsonSchemaDoc: {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          $defs: remapRefsToJsonSchema(schemasObj),
        },
      },
    }
  }

  if (schemaEntryPath.endsWith('.yaml') || schemaEntryPath.endsWith('.yml') || schemaEntryPath.endsWith('.json')) {
    const { loadSpecDocumentAsync } = await import('./cli/lib/load-spec.js')
    const loaded = await loadSpecDocumentAsync(schemaEntryPath)
    const openApiDoc = loaded.document as unknown as Record<string, unknown>
    const schemasObj = ((openApiDoc.components as any)?.schemas ?? {}) as Record<string, unknown>
    const pathsObj = (openApiDoc.paths ?? {}) as Record<string, unknown>
    return {
      schemas: {},
      paths: pathsObj,
      customProjection: {
        openApiDoc,
        jsonSchemaDoc: {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          $defs: remapRefsToJsonSchema(schemasObj),
        },
      },
    }
  }

  const mod = await loadModule<any>(schemaEntryPath)

  // 1. Check if module exports a custom projection builder
  if (typeof mod.buildProjection === 'function') {
    const projected = await mod.buildProjection()
    return { schemas: {}, paths: {}, customProjection: projected }
  }
  if (typeof mod.default === 'function') {
    const projected = await mod.default()
    if (projected && typeof projected === 'object' && ('openApiDoc' in projected || 'openapi' in projected)) {
      return {
        schemas: {},
        paths: {},
        customProjection: 'openApiDoc' in projected ? projected : { openApiDoc: projected, jsonSchemaDoc: {} },
      }
    }
  }

  // 2. Extract schemas map
  const schemas: Record<string, z.ZodTypeAny> = {}
  let paths: Record<string, unknown> = (mod.paths ?? mod.operations ?? {}) as Record<string, unknown>
  if (Object.keys(paths).length === 0 && mod.default && typeof mod.default === 'object') {
    paths = (mod.default.paths ?? mod.default.operations ?? {}) as Record<string, unknown>
  }

  if (mod.schemas && typeof mod.schemas === 'object' && !isZodType(mod.schemas)) {
    for (const [name, schema] of Object.entries(mod.schemas)) {
      if (isZodType(schema)) {
        schemas[name] = schema
      }
    }
  } else if (mod.default && typeof mod.default === 'object' && !isZodType(mod.default) && !('openapi' in mod.default)) {
    for (const [name, schema] of Object.entries(mod.default)) {
      if (isZodType(schema)) {
        schemas[name] = schema
      }
    }
  }

  // Scan named exports
  for (const [key, value] of Object.entries(mod)) {
    if (isZodType(value)) {
      const cleanName = key.endsWith('Schema') && key.length > 6 ? key.slice(0, -6) : key
      if (!schemas[cleanName]) {
        schemas[cleanName] = value
      }
    }
  }

  return { schemas, paths }
}

/**
 * Projects a single profile target to an OpenAPI document and a JSON Schema
 * Draft 2020-12 bundle. A Zod module projects to OpenAPI 3.1.0; a spec file
 * (OpenAPI YAML/JSON, TypeSpec) keeps its own `openapi` version.
 *
 * The OpenAPI document keeps the `$ref`s of a spec file as written: one to
 * another file is relative to the schema entry, the file
 * `resolveProfileTarget(target, rootDir).resolvedSchemaEntry` names, and
 * resolves only from there (`parseDocument(openApiDoc, { basePath })`).
 */
export async function projectTargetSpec(
  target: ProfileTargetConfig,
  rootDir: string,
): Promise<TargetSpecProjectionResult> {
  const { resolvedSchemaEntry, resolvedOutDir } = resolveProfileTarget(target, rootDir)

  const relSourcePath = path.relative(rootDir, resolvedSchemaEntry)
  const { schemas, paths, customProjection } = await loadSchemaEntry(resolvedSchemaEntry)

  let openApiDoc: Record<string, unknown>
  let jsonSchemaDoc: Record<string, unknown>

  if (customProjection) {
    openApiDoc = { ...customProjection.openApiDoc }
    jsonSchemaDoc = { ...customProjection.jsonSchemaDoc }
  } else {
    // Build refs context for recursive Zod schemas
    const refsMap = new Map<z.ZodTypeAny, string>()
    for (const [name, schema] of Object.entries(schemas)) {
      refsMap.set(schema, name)
    }

    const openApiComponents: Record<string, unknown> = {}
    const jsonDefs: Record<string, unknown> = {}

    for (const [name, schema] of Object.entries(schemas)) {
      const converted = zodToSchema(schema, { refs: refsMap }) as Record<string, unknown>
      openApiComponents[name] = remapRefsToOpenApi(converted)
      jsonDefs[name] = remapRefsToJsonSchema(converted)
    }

    openApiDoc = {
      openapi: '3.1.0',
      info: {
        title: target.title ?? `${target.id} Specification`,
        version: target.version ?? '1.0.0',
        description: `Canonical OpenAPI 3.1 specification for ${target.id} [${target.profile}].`,
      },
      paths: paths ?? {},
      components: {
        schemas: openApiComponents,
      },
    }

    jsonSchemaDoc = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: `https://oa-sdk.dev/schemas/v1/${target.id}.json`,
      title: target.title ?? `${target.id} Schema Bundle`,
      description: `JSON Schema Draft 2020-12 bundle for ${target.id}.`,
      $defs: jsonDefs,
    }
  }

  // Canonical core OpenAPI doc (stripped of any pre-existing vendor extensions)
  const coreOpenApiDoc = stripSchemaEngineExtensions(openApiDoc)
  const versionHash = computeVersionHash(coreOpenApiDoc)

  // Sources map
  const sources: Record<string, SchemaSourceCoordinate> = {}
  const components = (coreOpenApiDoc.components as Record<string, unknown> | undefined)?.schemas as
    | Record<string, unknown>
    | undefined
  if (components) {
    for (const name of Object.keys(components)) {
      sources[name] = {
        kind: 'file',
        filePath: relSourcePath,
        pointer: `#/components/schemas/${name}`,
      }
    }
  }

  // Refs extraction
  const refEdges = extractRefsFromDocument(coreOpenApiDoc, relSourcePath)

  // Attach vendor extensions
  const documentWithExtensions: Record<string, unknown> = {
    ...coreOpenApiDoc,
    [OPENAPI_PROJECTION_PROFILE_EXTENSION]: target.profile,
    [OPENAPI_PROJECTION_VERSION_HASH_EXTENSION]: versionHash,
    [OPENAPI_PROJECTION_SOURCES_EXTENSION]: sources,
    [OPENAPI_PROJECTION_REFS_EXTENSION]: refEdges,
  }

  const { openApiPath, jsonSchemaPath } = profileTargetArtifactPaths(resolvedOutDir, target.id)

  const operationCount = countPathOperations(coreOpenApiDoc)
  const schemaCount = Object.keys(components ?? {}).length

  return {
    target,
    openApiDoc: documentWithExtensions,
    jsonSchemaDoc,
    versionHash,
    openApiPath,
    jsonSchemaPath,
    operationCount,
    schemaCount,
  }
}

/**
 * Projects standalone type guards for configured guard target across all profile specs.
 */
export async function projectTargetGuards(
  guards: GuardTargetConfig,
  specResults: TargetSpecProjectionResult[],
  rootDir: string,
): Promise<TargetGuardProjectionResult> {
  const resolvedOutDir = path.isAbsolute(guards.outDir)
    ? path.resolve(guards.outDir)
    : path.resolve(rootDir, guards.outDir)

  // Aggregate all schemas from projected specs
  const aggregateDefs: Record<string, unknown> = {}
  const aggregateSchemas: Record<string, unknown> = {}

  for (const res of specResults) {
    const defs = (res.jsonSchemaDoc.$defs as Record<string, unknown>) ?? {}
    for (const [key, val] of Object.entries(defs)) {
      aggregateDefs[key] = val
    }
    const schemas = ((res.openApiDoc.components as Record<string, unknown>)?.schemas as Record<string, unknown>) ?? {}
    for (const [key, val] of Object.entries(schemas)) {
      aggregateSchemas[key] = val
    }
  }

  const combinedDoc: Record<string, unknown> = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://oa-sdk.dev/schemas/v1/guards.json',
    $defs: aggregateDefs,
    components: {
      schemas: aggregateSchemas,
    },
  }

  await fs.mkdir(resolvedOutDir, { recursive: true })

  const artifacts = await generateStandaloneGuards({
    schemaDocument: combinedDoc,
    outDir: resolvedOutDir,
    split: guards.split,
    moduleFormat: (guards.moduleFormat ?? 'esm') as any,
    generateDeclarations: true,
    tiered: guards.tiered,
    polymorphicDispatch: guards.polymorphicDispatch,
  })

  // Ensure artifacts are written to disk
  for (const artifact of artifacts) {
    await fs.mkdir(path.dirname(artifact.filePath), { recursive: true })
    await fs.writeFile(artifact.filePath, artifact.content, 'utf8')
  }

  let cspAudit: CspAuditResult | undefined
  if (guards.auditCsp) {
    cspAudit = await auditCspBundle(resolvedOutDir)
  }

  const guardCount = Object.keys(aggregateSchemas).length || Object.keys(aggregateDefs).length

  return {
    artifacts,
    guardCount,
    outDir: resolvedOutDir,
    ...(cspAudit !== undefined ? { cspAudit } : {}),
  }
}
