import {
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs'
import {
  extname,
  join,
  resolve,
} from 'node:path'
import {
  createDefinitionNode,
  createDefinitionRef,
  createSourceLocationIndex,
  parseDefinitionId,
  type CanonicalDefinitionId,
  type DefinitionNode,
  type DefinitionId,
  type DefinitionRef,
  type DefinitionTargetConfig,
  type OasInfo,
  type OasServer,
  type OasTag,
  type SourceLocation,
  type SourceLocationIndex,
} from '@oa-sdk/parser'
import { parse as parseYaml } from 'yaml'
import {
  createOpenApiSourceAdapterDiagnostic,
  createOpenApiSourceContentHash,
  createOpenApiSourceFragment,
  type OpenApiSourceAdapterDiagnostic,
  type OpenApiSourceFragment,
  type OpenApiSourceFragmentMetadata,
} from './openapi-source-fragments.js'

export type DefinitionFragmentLoadDiagnostic =
  OpenApiSourceAdapterDiagnostic<'definition-fragment/invalid-fragment', 'error'>

export type RawOpenApiFragmentLoadDiagnostic =
  OpenApiSourceAdapterDiagnostic<'openapi-fragment/invalid-fragment', 'error'>

export type JsonSchemaFragmentLoadDiagnostic =
  OpenApiSourceAdapterDiagnostic<'json-schema/invalid-schema', 'error'>

export type YamlOrJsonSourceFile = {
  path: string
  raw: string
  document: unknown
  sourceLocation: SourceLocationIndex
}

export type SourceFileAdapterResult<TDiagnostic extends OpenApiSourceAdapterDiagnostic = OpenApiSourceAdapterDiagnostic> = {
  sourcePath: string
  raw: string
  document?: unknown
  sourceLocation: SourceLocationIndex
  fragments: OpenApiSourceFragment[]
  diagnostics: TDiagnostic[]
}

export type DefinitionBuilderFragmentAdapterResult =
  SourceFileAdapterResult<DefinitionFragmentLoadDiagnostic> & {
    fragment?: OpenApiSourceFragment
    node?: DefinitionNode
  }

export type RawOpenApiFragmentAdapterResult =
  SourceFileAdapterResult<RawOpenApiFragmentLoadDiagnostic>

export type JsonSchemaFragmentAdapterOptions = {
  definitionId?: string | DefinitionId
  metadata?: OpenApiSourceFragmentMetadata
}

export type JsonSchemaFragmentAdapterResult =
  SourceFileAdapterResult<JsonSchemaFragmentLoadDiagnostic> & {
    fragment?: OpenApiSourceFragment
    node?: DefinitionNode
  }

export type LoadedDefinitionFragments = {
  nodes: DefinitionNode[]
  diagnostics: DefinitionFragmentLoadDiagnostic[]
  sourceLocations: ReadonlyMap<string, SourceLocationIndex>
  filePaths: string[]
}

export function readYamlOrJsonDocument(filePath: string): unknown {
  return readYamlOrJsonSourceFile(filePath).document
}

export function readYamlOrJsonSourceFile(filePath: string): YamlOrJsonSourceFile {
  const resolvedPath = resolve(process.cwd(), filePath)
  const raw = readFileSync(resolvedPath, 'utf8')
  return {
    path: resolvedPath,
    raw,
    document: parseDocument(raw, resolvedPath),
    sourceLocation: createSourceLocationIndex(raw, { filePath: resolvedPath }),
  }
}

export function loadDefinitionTargetConfig(targetPath: string): DefinitionTargetConfig {
  const parsed = readYamlOrJsonDocument(targetPath)
  if (!isRecord(parsed)) {
    throw new Error(`Target config must be an object: ${targetPath}`)
  }

  const name = readRequiredString(parsed, 'name', targetPath)
  const info = readOptionalInfo(parsed, 'info', targetPath)
  const scopes = readStringArray(parsed, 'scopes', targetPath)
  const domains = readStringArray(parsed, 'domains', targetPath)
  const servers = readServerArray(parsed, 'servers', targetPath)
  const tags = readOptionalTags(parsed, 'tags', targetPath)
  const includePaths = readStringArray(parsed, 'includePaths', targetPath)
  const includeDefinitions = readOptionalDefinitionIdArray(parsed, 'includeDefinitions', targetPath)
  const config: DefinitionTargetConfig = {
    name,
    scopes,
    domains,
    servers,
    includePaths,
  }
  if (info !== undefined) config.info = info
  if (tags !== undefined) config.tags = tags
  if (includeDefinitions !== undefined) config.includeDefinitions = includeDefinitions
  const aliases = readAliases(parsed)
  if (aliases !== undefined) {
    config.namingPolicy = { aliases }
  }

  return config
}

export function loadDefinitionFragments(fragmentsDir: string): LoadedDefinitionFragments {
  const nodes: DefinitionNode[] = []
  const diagnostics: DefinitionFragmentLoadDiagnostic[] = []
  const sourceLocations = new Map<string, SourceLocationIndex>()
  const filePaths = listDefinitionFiles(fragmentsDir)

  for (const filePath of filePaths) {
    const adapted = adaptDefinitionBuilderFragmentFile(filePath)
    sourceLocations.set(adapted.sourcePath, adapted.sourceLocation)
    diagnostics.push(...adapted.diagnostics)
    if (adapted.node !== undefined) nodes.push(adapted.node)
  }

  return {
    nodes,
    diagnostics,
    sourceLocations,
    filePaths: filePaths.map(filePath => resolve(process.cwd(), filePath)),
  }
}

export function lookupDefinitionSourceLocation(
  sourceLocations: ReadonlyMap<string, SourceLocationIndex>,
  sourcePath: string,
  sourcePointer: string,
): Pick<SourceLocation, 'line' | 'column'> | undefined {
  return sourceLocations.get(sourcePath)?.lookup(sourcePointer)
}

export function createDefinitionContentHash(value: unknown): string {
  return createOpenApiSourceContentHash(value)
}

export function adaptDefinitionBuilderFragmentFile(filePath: string): DefinitionBuilderFragmentAdapterResult {
  const parsed = readAdapterSourceFile<DefinitionFragmentLoadDiagnostic>(
    filePath,
    (sourcePath, message, sourcePointer) => fragmentDiagnostic(sourcePath, message, sourcePointer),
  )
  if (parsed.document === undefined) return parsed

  const diagnostics: DefinitionFragmentLoadDiagnostic[] = []
  const document = parsed.document
  if (!isRecord(document)) {
    diagnostics.push(fragmentDiagnostic(parsed.sourcePath, 'Fragment file must contain an object.'))
    return { ...parsed, diagnostics }
  }

  const id = document.id
  if (typeof id !== 'string') {
    diagnostics.push(fragmentDiagnostic(parsed.sourcePath, 'Definition fragment must declare a string id.', '#/id'))
    return { ...parsed, diagnostics }
  }

  if (!Object.prototype.hasOwnProperty.call(document, 'content')) {
    diagnostics.push(fragmentDiagnostic(parsed.sourcePath, 'Definition fragment must declare content.', '#/content'))
    return { ...parsed, diagnostics }
  }

  let definitionId: DefinitionId
  try {
    definitionId = parseDefinitionId(id)
  } catch (error) {
    diagnostics.push(fragmentDiagnostic(
      parsed.sourcePath,
      error instanceof Error ? error.message : String(error),
      '#/id',
    ))
    return { ...parsed, diagnostics }
  }

  const metadata = isRecord(document.metadata) ? document.metadata : undefined
  const fragment = createOpenApiSourceFragment({
    id: definitionId.id,
    kind: definitionId.kind,
    sourcePath: parsed.sourcePath,
    sourcePointer: '#/content',
    content: document.content,
    ...(metadata !== undefined ? { metadata } : {}),
  })
  const refs = readFragmentRefs(document.refs, parsed.sourcePath, diagnostics)
  if (refs === undefined) return { ...parsed, diagnostics }

  const input = {
    id: definitionId,
    sourcePath: parsed.sourcePath,
    sourcePointer: '#/content',
    contentHash: fragment.contentHash,
    content: fragment.content,
  }
  const node = createDefinitionNode(
    metadata !== undefined ? { ...input, metadata, refs } : { ...input, refs },
  )

  return {
    ...parsed,
    fragments: [fragment],
    diagnostics,
    fragment,
    node,
  }
}

export function adaptRawOpenApiFragmentFile(filePath: string): RawOpenApiFragmentAdapterResult {
  const parsed = readAdapterSourceFile<RawOpenApiFragmentLoadDiagnostic>(
    filePath,
    (sourcePath, message, sourcePointer) => rawOpenApiDiagnostic(sourcePath, message, sourcePointer),
  )
  if (parsed.document === undefined) return parsed

  const diagnostics: RawOpenApiFragmentLoadDiagnostic[] = []
  const document = parsed.document
  if (!isRecord(document)) {
    diagnostics.push(rawOpenApiDiagnostic(parsed.sourcePath, 'OpenAPI fragment file must contain an object.'))
    return { ...parsed, diagnostics }
  }

  const fragments = collectRawOpenApiFragments(parsed.sourcePath, document, diagnostics)
  return {
    ...parsed,
    document,
    fragments: fragments.length > 0
      ? fragments
      : [
          createOpenApiSourceFragment({
            kind: 'openapi-fragment',
            sourcePath: parsed.sourcePath,
            sourcePointer: '#',
            content: document,
          }),
        ],
    diagnostics,
  }
}

export function adaptJsonSchemaFile(
  filePath: string,
  options: JsonSchemaFragmentAdapterOptions = {},
): JsonSchemaFragmentAdapterResult {
  const parsed = readAdapterSourceFile<JsonSchemaFragmentLoadDiagnostic>(
    filePath,
    (sourcePath, message, sourcePointer) => jsonSchemaDiagnostic(sourcePath, message, sourcePointer),
  )
  if (parsed.document === undefined) return parsed

  const diagnostics: JsonSchemaFragmentLoadDiagnostic[] = []
  const document = parsed.document
  if (!isJsonSchemaRoot(document)) {
    diagnostics.push(jsonSchemaDiagnostic(
      parsed.sourcePath,
      'JSON Schema file must contain an object or boolean schema.',
    ))
    return { ...parsed, diagnostics }
  }

  const metadata = options.metadata
  const fragment = createOpenApiSourceFragment({
    kind: 'json-schema',
    sourcePath: parsed.sourcePath,
    sourcePointer: '#',
    content: document,
    ...(metadata !== undefined ? { metadata } : {}),
  })
  let node: DefinitionNode | undefined
  if (options.definitionId !== undefined) {
    let definitionId: DefinitionId
    try {
      definitionId = typeof options.definitionId === 'string'
        ? parseDefinitionId(options.definitionId)
        : options.definitionId
    } catch (error) {
      diagnostics.push(jsonSchemaDiagnostic(
        parsed.sourcePath,
        error instanceof Error ? error.message : String(error),
      ))
      return {
        ...parsed,
        fragments: [fragment],
        diagnostics,
        fragment,
      }
    }
    if (definitionId.kind !== 'schema') {
      diagnostics.push(jsonSchemaDiagnostic(
        parsed.sourcePath,
        `JSON Schema definition id must use kind "schema": ${definitionId.id}`,
      ))
    } else {
      node = createDefinitionNode({
        id: definitionId,
        sourcePath: parsed.sourcePath,
        sourcePointer: '#',
        contentHash: fragment.contentHash,
        content: fragment.content,
        ...(metadata !== undefined ? { metadata } : {}),
      })
    }
  }

  return {
    ...parsed,
    fragments: [fragment],
    diagnostics,
    fragment,
    ...(node !== undefined ? { node } : {}),
  }
}

function readFragmentRefs(
  refs: unknown,
  filePath: string,
  diagnostics: DefinitionFragmentLoadDiagnostic[],
): DefinitionRef[] | undefined {
  if (refs === undefined) return []
  if (!Array.isArray(refs)) {
    diagnostics.push(fragmentDiagnostic(filePath, 'Definition fragment refs must be an array.', '#/refs'))
    return undefined
  }

  const explicitRefs: DefinitionRef[] = []
  for (const [index, refEntry] of refs.entries()) {
    const pointer = `#/refs/${index}`
    if (!isRecord(refEntry)) {
      diagnostics.push(fragmentDiagnostic(filePath, 'Definition fragment ref entry must contain ref and sourcePointer strings.', pointer))
      return undefined
    }
    if (typeof refEntry.ref !== 'string') {
      diagnostics.push(fragmentDiagnostic(filePath, 'Definition fragment ref entry must contain a string ref.', `${pointer}/ref`))
      return undefined
    }
    if (typeof refEntry.sourcePointer !== 'string') {
      diagnostics.push(fragmentDiagnostic(filePath, 'Definition fragment ref entry must contain a string sourcePointer.', `${pointer}/sourcePointer`))
      return undefined
    }
    explicitRefs.push(createDefinitionRef({
      ref: refEntry.ref,
      sourcePath: filePath,
      sourcePointer: refEntry.sourcePointer,
      ...(isRecord(refEntry.metadata) ? { metadata: refEntry.metadata } : {}),
    }))
  }

  return explicitRefs
}

function listDefinitionFiles(rootDir: string): string[] {
  const files: string[] = []

  function visit(directory: string): void {
    const entries = readdirSync(directory, { withFileTypes: true })
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        visit(path)
        continue
      }
      if (!entry.isFile()) continue
      if (isDefinitionFile(path)) files.push(path)
    }
  }

  if (!statSync(rootDir).isDirectory()) {
    throw new Error(`Fragments path must be a directory: ${rootDir}`)
  }

  visit(rootDir)
  return files.sort((a, b) => a.localeCompare(b))
}

function parseDocument(raw: string, filePath: string): unknown {
  if (filePath.endsWith('.json')) return JSON.parse(raw)
  return parseYaml(raw)
}

function readAdapterSourceFile<TDiagnostic extends OpenApiSourceAdapterDiagnostic>(
  filePath: string,
  createDiagnostic: (sourcePath: string, message: string, sourcePointer?: string) => TDiagnostic,
): SourceFileAdapterResult<TDiagnostic> {
  const sourcePath = resolve(process.cwd(), filePath)
  let raw = ''
  let sourceLocation = createSourceLocationIndex('', { filePath: sourcePath })

  try {
    raw = readFileSync(sourcePath, 'utf8')
    sourceLocation = createSourceLocationIndex(raw, { filePath: sourcePath })
  } catch (error) {
    return {
      sourcePath,
      raw,
      sourceLocation,
      fragments: [],
      diagnostics: [
        createDiagnostic(sourcePath, error instanceof Error ? error.message : String(error)),
      ],
    }
  }

  try {
    return {
      sourcePath,
      raw,
      document: parseDocument(raw, sourcePath),
      sourceLocation,
      fragments: [],
      diagnostics: [],
    }
  } catch (error) {
    return {
      sourcePath,
      raw,
      sourceLocation,
      fragments: [],
      diagnostics: [
        createDiagnostic(sourcePath, error instanceof Error ? error.message : String(error)),
      ],
    }
  }
}

function collectRawOpenApiFragments(
  sourcePath: string,
  document: Record<string, unknown>,
  diagnostics: RawOpenApiFragmentLoadDiagnostic[],
): OpenApiSourceFragment[] {
  const fragments: OpenApiSourceFragment[] = []
  collectPathFragments(sourcePath, '#/paths', document.paths, diagnostics, fragments)
  collectPathFragments(sourcePath, '#/webhooks', document.webhooks, diagnostics, fragments)

  const components = document.components
  if (components !== undefined && !isRecord(components)) {
    diagnostics.push(rawOpenApiDiagnostic(sourcePath, 'OpenAPI components must be an object.', '#/components'))
  } else if (components !== undefined) {
    collectComponentFragments(sourcePath, components, diagnostics, fragments)
  }

  return fragments.sort((left, right) => (
    (left.sourcePointer ?? '').localeCompare(right.sourcePointer ?? '')
    || left.kind.localeCompare(right.kind)
  ))
}

function collectPathFragments(
  sourcePath: string,
  sectionPointer: string,
  value: unknown,
  diagnostics: RawOpenApiFragmentLoadDiagnostic[],
  fragments: OpenApiSourceFragment[],
): void {
  if (value === undefined) return
  if (!isRecord(value)) {
    diagnostics.push(rawOpenApiDiagnostic(sourcePath, 'OpenAPI paths/webhooks section must be an object.', sectionPointer))
    return
  }

  for (const [path, pathItem] of sortedEntries(value)) {
    const pathPointer = `${sectionPointer}/${encodePointerToken(path)}`
    if (!isRecord(pathItem)) {
      diagnostics.push(rawOpenApiDiagnostic(sourcePath, 'OpenAPI path item must be an object.', pathPointer))
      continue
    }
    fragments.push(createOpenApiSourceFragment({
      kind: sectionPointer === '#/webhooks' ? 'webhook' : 'path',
      sourcePath,
      sourcePointer: pathPointer,
      content: pathItem,
      metadata: sectionPointer === '#/webhooks'
        ? { webhook: path }
        : { path },
    }))

    for (const method of sortedOpenApiOperationMethods(pathItem)) {
      fragments.push(createOpenApiSourceFragment({
        kind: 'operation',
        sourcePath,
        sourcePointer: `${pathPointer}/${method}`,
        content: pathItem[method],
        metadata: sectionPointer === '#/webhooks'
          ? { webhook: path, method }
          : { path, method },
      }))
    }
  }
}

function collectComponentFragments(
  sourcePath: string,
  components: Record<string, unknown>,
  diagnostics: RawOpenApiFragmentLoadDiagnostic[],
  fragments: OpenApiSourceFragment[],
): void {
  for (const [section, values] of sortedEntries(components)) {
    const sectionPointer = `#/components/${encodePointerToken(section)}`
    if (!isRecord(values)) {
      diagnostics.push(rawOpenApiDiagnostic(sourcePath, 'OpenAPI component section must be an object.', sectionPointer))
      continue
    }
    for (const [name, content] of sortedEntries(values)) {
      const pointer = `${sectionPointer}/${encodePointerToken(name)}`
      if (!isRecord(content) && !Array.isArray(content) && !(section === 'schemas' && typeof content === 'boolean')) {
        diagnostics.push(rawOpenApiDiagnostic(sourcePath, 'OpenAPI component entry must be an object, array, or boolean schema.', pointer))
        continue
      }
      fragments.push(createOpenApiSourceFragment({
        kind: componentSectionKind(section),
        sourcePath,
        sourcePointer: pointer,
        content,
        metadata: {
          componentSection: section,
          name,
        },
      }))
    }
  }
}

const OPENAPI_OPERATION_METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
  'query',
] as const

const COMPONENT_SECTION_KINDS: Record<string, string> = {
  schemas: 'schema',
  responses: 'response',
  parameters: 'parameter',
  examples: 'example',
  requestBodies: 'requestBody',
  headers: 'header',
  securitySchemes: 'securityScheme',
  links: 'link',
  callbacks: 'callback',
  pathItems: 'pathItem',
  mediaTypes: 'mediaType',
}

function sortedOpenApiOperationMethods(pathItem: Record<string, unknown>): string[] {
  return OPENAPI_OPERATION_METHODS.filter(method => isRecord(pathItem[method]))
}

function componentSectionKind(section: string): string {
  return COMPONENT_SECTION_KINDS[section] ?? `component:${section}`
}

function isJsonSchemaRoot(value: unknown): boolean {
  return typeof value === 'boolean' || isRecord(value)
}

function sortedEntries(record: Record<string, unknown>): Array<[string, unknown]> {
  return Object.entries(record).sort(([left], [right]) => left.localeCompare(right))
}

function encodePointerToken(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1')
}

function isDefinitionFile(filePath: string): boolean {
  const extension = extname(filePath)
  return extension === '.yaml' || extension === '.yml' || extension === '.json'
}

function readRequiredString(record: Record<string, unknown>, key: string, filePath: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Target config ${filePath} must declare a non-empty string ${key}.`)
  }
  return value
}

function readStringArray(record: Record<string, unknown>, key: string, filePath: string): string[] {
  const value = record[key]
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`Target config ${filePath} must declare ${key} as a string array.`)
  }
  return value
}

function readOptionalStringArray(record: Record<string, unknown>, key: string, filePath: string): string[] | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`Target config ${filePath} must declare ${key} as a string array when present.`)
  }
  return value
}

function readOptionalDefinitionIdArray(
  record: Record<string, unknown>,
  key: string,
  filePath: string,
): CanonicalDefinitionId[] | undefined {
  const values = readOptionalStringArray(record, key, filePath)
  if (values === undefined) return undefined

  return values.map((value, index) => {
    try {
      return parseDefinitionId(value).id
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Target config ${filePath} has invalid ${key}[${index}]: ${message}`)
    }
  })
}

function readServerArray(record: Record<string, unknown>, key: string, filePath: string): OasServer[] {
  const value = record[key]
  if (
    !Array.isArray(value)
    || value.some(item => !isRecord(item) || typeof item.url !== 'string' || item.url.length === 0)
  ) {
    throw new Error(`Target config ${filePath} must declare ${key} as an object array with string url fields.`)
  }
  return value as OasServer[]
}

function readOptionalInfo(record: Record<string, unknown>, key: string, filePath: string): OasInfo | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (!isRecord(value) || typeof value.title !== 'string' || typeof value.version !== 'string') {
    throw new Error(`Target config ${filePath} must declare ${key} with string title and version fields when present.`)
  }
  return value as OasInfo
}

function readOptionalTags(record: Record<string, unknown>, key: string, filePath: string): OasTag[] | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some(item => !isRecord(item) || typeof item.name !== 'string')) {
    throw new Error(`Target config ${filePath} must declare ${key} as an object array with string name fields when present.`)
  }
  return value as OasTag[]
}

function readAliases(record: Record<string, unknown>): Record<string, string> | undefined {
  const namingPolicy = record.namingPolicy
  if (!isRecord(namingPolicy)) return undefined
  const aliases = namingPolicy.aliases
  if (!isRecord(aliases)) return undefined

  const output: Record<string, string> = {}
  for (const [id, outputName] of Object.entries(aliases)) {
    if (typeof outputName === 'string') output[id] = outputName
  }
  return output
}

function fragmentDiagnostic(
  sourcePath: string,
  message: string,
  sourcePointer?: string,
): DefinitionFragmentLoadDiagnostic {
  return createOpenApiSourceAdapterDiagnostic({
    code: 'definition-fragment/invalid-fragment',
    severity: 'error',
    message,
    sourcePath,
    sourcePointer: sourcePointer ?? '#',
  })
}

function rawOpenApiDiagnostic(
  sourcePath: string,
  message: string,
  sourcePointer?: string,
): RawOpenApiFragmentLoadDiagnostic {
  return createOpenApiSourceAdapterDiagnostic({
    code: 'openapi-fragment/invalid-fragment',
    severity: 'error',
    message,
    sourcePath,
    sourcePointer: sourcePointer ?? '#',
  })
}

function jsonSchemaDiagnostic(
  sourcePath: string,
  message: string,
  sourcePointer?: string,
): JsonSchemaFragmentLoadDiagnostic {
  return createOpenApiSourceAdapterDiagnostic({
    code: 'json-schema/invalid-schema',
    severity: 'error',
    message,
    sourcePath,
    sourcePointer: sourcePointer ?? '#',
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
