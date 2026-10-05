import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { stringify as stringifyYaml } from 'yaml'
import { escapeJsonPointerToken } from '@oa-sdk/parser'

export type OpenApiCollectProfile = 'generic' | 'nestjs-swagger' | 'fastapi'

const OPEN_API_COLLECT_PROFILES: readonly OpenApiCollectProfile[] = ['generic', 'nestjs-swagger', 'fastapi']

export function parseOpenApiCollectProfile(value: string | undefined): OpenApiCollectProfile {
  if (value === undefined) return 'generic'
  if ((OPEN_API_COLLECT_PROFILES as readonly string[]).includes(value)) {
    return value as OpenApiCollectProfile
  }
  throw new Error(`unsupported OpenAPI collect profile: ${value}. allowed: ${OPEN_API_COLLECT_PROFILES.join(', ')}`)
}

export type OpenApiTransformWarning = {
  code: string
  pointer: string
  message: string
}

export type OpenApiUpgradeReport = {
  schemaVersion: 'oa-gen.openapi-upgrade-report.v1'
  sourceOpenapi: string | null
  targetOpenapi: '3.2.0'
  warnings: OpenApiTransformWarning[]
  conversions: OpenApiTransformWarning[]
}

export type OpenApiCollectReport = {
  schemaVersion: 'oa-gen.openapi-collect-report.v1'
  profile: OpenApiCollectProfile
  raw: string
  normalized: string
  upgraded: string
  upgrade: OpenApiUpgradeReport
}

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'])
const ROOT_ORDER = [
  'openapi',
  'jsonSchemaDialect',
  'info',
  'servers',
  'tags',
  'paths',
  'webhooks',
  'components',
  'security',
  'externalDocs',
]

export function normalizeOpenApiDocument(
  document: Record<string, unknown>,
  options: { profile?: OpenApiCollectProfile } = {},
): Record<string, unknown> {
  const profile = options.profile ?? 'generic'
  const cloned = cloneJson(document)
  const cleaned = removeCollectionNoise(cloned, profile)
  return sortOpenApiObject(cleaned) as Record<string, unknown>
}

export function upgradeOpenApiDocumentTo32(
  document: Record<string, unknown>,
): { document: Record<string, unknown>; report: OpenApiUpgradeReport } {
  const sourceOpenapi = typeof document.openapi === 'string' ? document.openapi : null
  const walk = new UpgradeWalk()
  const upgraded = cloneJson(document)

  upgraded.openapi = '3.2.0'
  if (sourceOpenapi !== '3.2.0') {
    walk.conversions.push({
      code: 'openapi/version-upgraded',
      pointer: '#/openapi',
      message: `Changed OpenAPI version from ${sourceOpenapi ?? 'unknown'} to 3.2.0 for derived analysis.`,
    })
  }

  upgradeAllSchemaPositions(upgraded, walk)
  walk.applySchemaWrites()

  const normalized = normalizeOpenApiDocument(upgraded)
  return {
    document: normalized,
    report: {
      schemaVersion: 'oa-gen.openapi-upgrade-report.v1',
      sourceOpenapi,
      targetOpenapi: '3.2.0',
      warnings: walk.warnings,
      conversions: walk.conversions,
    },
  }
}

export function writeOpenApiYaml(outputPath: string, document: Record<string, unknown>): void {
  writeText(outputPath, stringifyOpenApiYaml(document))
}

export function stringifyOpenApiYaml(document: Record<string, unknown>): string {
  return stringifyYaml(document, {
    aliasDuplicateObjects: false,
    lineWidth: 120,
    sortMapEntries: false,
  })
}

export function writeJson(outputPath: string, value: unknown): void {
  writeText(outputPath, `${JSON.stringify(value, null, 2)}\n`)
}

export function createOpenApiCollectReport(options: {
  profile: OpenApiCollectProfile
  raw: string
  normalized: string
  upgraded: string
  upgrade: OpenApiUpgradeReport
}): OpenApiCollectReport {
  return {
    schemaVersion: 'oa-gen.openapi-collect-report.v1',
    profile: options.profile,
    raw: options.raw,
    normalized: options.normalized,
    upgraded: options.upgraded,
    upgrade: options.upgrade,
  }
}

/**
 * One upgrade walk: the per-location report and the schema-slot writes.
 *
 * The walk visits every location of the document, including each location of
 * a container shared through YAML aliases, and reports conversions per
 * location. Slots are written only after the walk: a write during it would let
 * the next location of a shared container read the already-upgraded schema
 * and report nothing there. The upgraded schema does not depend on its
 * location, so every write to a shared slot stores an equal value.
 */
class UpgradeWalk {
  readonly warnings: OpenApiTransformWarning[] = []
  readonly conversions: OpenApiTransformWarning[] = []
  private readonly schemaWrites: Array<{ target: Record<string, unknown>; key: string; schema: Record<string, unknown> }> = []

  writeSchema(target: Record<string, unknown>, key: string, schema: Record<string, unknown>): void {
    this.schemaWrites.push({ target, key, schema })
  }

  applySchemaWrites(): void {
    for (const { target, key, schema } of this.schemaWrites) target[key] = schema
    this.schemaWrites.length = 0
  }
}

function upgradeAllSchemaPositions(
  document: Record<string, unknown>,
  walk: UpgradeWalk,
): void {
  const components = readRecord(document.components)
  upgradeRecordOfSchemas(components, 'schemas', '#/components/schemas', walk)
  upgradeRecordOfHeaders(components, 'headers', '#/components/headers', walk)
  upgradeRecordOfParameters(components, 'parameters', '#/components/parameters', walk)
  upgradeRecordOfRequestBodies(components, 'requestBodies', '#/components/requestBodies', walk)
  upgradeRecordOfResponses(components, 'responses', '#/components/responses', walk)
  upgradeRecordOfCallbacks(components, 'callbacks', '#/components/callbacks', walk)
  upgradeRecordOfPathItems(components, 'pathItems', '#/components/pathItems', walk)

  upgradeRecordOfPathItems(document, 'paths', '#/paths', walk)
  upgradeRecordOfPathItems(document, 'webhooks', '#/webhooks', walk)
}

function upgradeRecordOfCallbacks(
  parent: Record<string, unknown>,
  key: string,
  pointer: string,
  walk: UpgradeWalk,
): void {
  const map = readRecord(parent[key])
  for (const [name, callback] of Object.entries(map)) {
    if (!isRecord(callback) || isReference(callback)) continue
    for (const [expression, pathItem] of Object.entries(callback)) {
      if (!isRecord(pathItem) || isReference(pathItem)) continue
      upgradePathItem(pathItem, `${pointer}/${escapeJsonPointerToken(name)}/${escapeJsonPointerToken(expression)}`, walk)
    }
  }
}

function upgradeRecordOfSchemas(
  parent: Record<string, unknown>,
  key: string,
  pointer: string,
  walk: UpgradeWalk,
): void {
  const map = readRecord(parent[key])
  for (const [name, schema] of Object.entries(map)) {
    if (!isRecord(schema)) continue
    walk.writeSchema(map, name, upgradeSchemaObject(schema, `${pointer}/${escapeJsonPointerToken(name)}`, walk))
  }
  if (Object.keys(map).length > 0) parent[key] = map
}

function upgradeRecordOfHeaders(
  parent: Record<string, unknown>,
  key: string,
  pointer: string,
  walk: UpgradeWalk,
): void {
  const map = readRecord(parent[key])
  for (const [name, header] of Object.entries(map)) {
    if (!isRecord(header) || isReference(header)) continue
    upgradeParameterLike(header, `${pointer}/${escapeJsonPointerToken(name)}`, walk)
  }
}

function upgradeRecordOfParameters(
  parent: Record<string, unknown>,
  key: string,
  pointer: string,
  walk: UpgradeWalk,
): void {
  const map = readRecord(parent[key])
  for (const [name, parameter] of Object.entries(map)) {
    if (!isRecord(parameter) || isReference(parameter)) continue
    upgradeParameterLike(parameter, `${pointer}/${escapeJsonPointerToken(name)}`, walk)
  }
}

function upgradeRecordOfRequestBodies(
  parent: Record<string, unknown>,
  key: string,
  pointer: string,
  walk: UpgradeWalk,
): void {
  const map = readRecord(parent[key])
  for (const [name, requestBody] of Object.entries(map)) {
    if (!isRecord(requestBody) || isReference(requestBody)) continue
    upgradeRequestBody(requestBody, `${pointer}/${escapeJsonPointerToken(name)}`, walk)
  }
}

function upgradeRecordOfResponses(
  parent: Record<string, unknown>,
  key: string,
  pointer: string,
  walk: UpgradeWalk,
): void {
  const map = readRecord(parent[key])
  for (const [name, response] of Object.entries(map)) {
    if (!isRecord(response) || isReference(response)) continue
    upgradeResponse(response, `${pointer}/${escapeJsonPointerToken(name)}`, walk)
  }
}

function upgradeRecordOfPathItems(
  parent: Record<string, unknown>,
  key: string,
  pointer: string,
  walk: UpgradeWalk,
): void {
  const map = readRecord(parent[key])
  for (const [name, item] of Object.entries(map)) {
    if (!isRecord(item) || isReference(item)) continue
    upgradePathItem(item, `${pointer}/${escapeJsonPointerToken(name)}`, walk)
  }
}

function upgradePathItem(
  pathItem: Record<string, unknown>,
  pointer: string,
  walk: UpgradeWalk,
): void {
  upgradeArrayOfParameters(pathItem, 'parameters', pointer, walk)
  for (const method of HTTP_METHODS) {
    const operation = pathItem[method]
    if (!isRecord(operation)) continue
    upgradeOperation(operation, `${pointer}/${method}`, walk)
  }
}

function upgradeOperation(
  operation: Record<string, unknown>,
  pointer: string,
  walk: UpgradeWalk,
): void {
  upgradeArrayOfParameters(operation, 'parameters', pointer, walk)
  const requestBody = operation.requestBody
  if (isRecord(requestBody) && !isReference(requestBody)) {
    upgradeRequestBody(requestBody, `${pointer}/requestBody`, walk)
  }
  const responses = readRecord(operation.responses)
  for (const [code, response] of Object.entries(responses)) {
    if (!isRecord(response) || isReference(response)) continue
    upgradeResponse(response, `${pointer}/responses/${escapeJsonPointerToken(code)}`, walk)
  }
  upgradeRecordOfCallbacks(operation, 'callbacks', `${pointer}/callbacks`, walk)
}

function upgradeArrayOfParameters(
  parent: Record<string, unknown>,
  key: string,
  parentPointer: string,
  walk: UpgradeWalk,
): void {
  const list = parent[key]
  if (!Array.isArray(list)) return
  list.forEach((parameter, index) => {
    if (!isRecord(parameter) || isReference(parameter)) return
    upgradeParameterLike(parameter, `${parentPointer}/${key}/${index}`, walk)
  })
}

function upgradeParameterLike(
  parameter: Record<string, unknown>,
  pointer: string,
  walk: UpgradeWalk,
): void {
  upgradeSchemaSlot(parameter, pointer, walk)
  upgradeContentSlot(parameter, pointer, walk)
}

function upgradeRequestBody(
  requestBody: Record<string, unknown>,
  pointer: string,
  walk: UpgradeWalk,
): void {
  upgradeContentSlot(requestBody, pointer, walk)
}

function upgradeResponse(
  response: Record<string, unknown>,
  pointer: string,
  walk: UpgradeWalk,
): void {
  upgradeContentSlot(response, pointer, walk)
  const headers = readRecord(response.headers)
  for (const [name, header] of Object.entries(headers)) {
    if (!isRecord(header) || isReference(header)) continue
    upgradeParameterLike(header, `${pointer}/headers/${escapeJsonPointerToken(name)}`, walk)
  }
}

function upgradeSchemaSlot(
  parent: Record<string, unknown>,
  parentPointer: string,
  walk: UpgradeWalk,
): void {
  const schema = parent.schema
  if (!isRecord(schema)) return
  walk.writeSchema(parent, 'schema', upgradeSchemaObject(schema, `${parentPointer}/schema`, walk))
}

function upgradeContentSlot(
  parent: Record<string, unknown>,
  parentPointer: string,
  walk: UpgradeWalk,
): void {
  const content = readRecord(parent.content)
  for (const [mediaType, value] of Object.entries(content)) {
    if (!isRecord(value)) continue
    upgradeSchemaSlot(value, `${parentPointer}/content/${escapeJsonPointerToken(mediaType)}`, walk)
  }
}

function isReference(value: Record<string, unknown>): boolean {
  return typeof value.$ref === 'string'
}

function upgradeSchemaObject(
  schema: Record<string, unknown>,
  pointer: string,
  walk: UpgradeWalk,
): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'nullable') continue
    output[key] = upgradeNestedSchemaValue(value, `${pointer}/${escapeJsonPointerToken(key)}`, walk)
  }

  if (schema.nullable === true) {
    walk.conversions.push({
      code: 'schema/nullable-upgraded',
      pointer,
      message: 'Converted OpenAPI 3.0 nullable schema to JSON Schema null union.',
    })
    return applyNullableUpgrade(output, pointer, walk.warnings)
  }

  return output
}

function upgradeNestedSchemaValue(
  value: unknown,
  pointer: string,
  walk: UpgradeWalk,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) => upgradeNestedSchemaValue(item, `${pointer}/${index}`, walk))
  }
  if (!isRecord(value)) return value
  return upgradeSchemaObject(value, pointer, walk)
}

function applyNullableUpgrade(
  schema: Record<string, unknown>,
  pointer: string,
  warnings: OpenApiTransformWarning[],
): Record<string, unknown> {
  if (typeof schema.$ref === 'string') {
    const { $ref, ...rest } = schema
    if (Object.keys(rest).length > 0) {
      warnings.push({
        code: 'schema/ref-nullable-siblings',
        pointer,
        message: 'Nullable $ref schema has siblings; siblings are preserved outside the anyOf wrapper.',
      })
    }
    return {
      ...rest,
      anyOf: [{ $ref }, { type: 'null' }],
    }
  }

  const type = schema.type
  if (typeof type === 'string') {
    return { ...schema, type: type === 'null' ? 'null' : [type, 'null'] }
  }
  if (Array.isArray(type)) {
    const values = type.filter(item => typeof item === 'string')
    return { ...schema, type: [...new Set([...values, 'null'])] }
  }

  return { anyOf: [schema, { type: 'null' }] }
}

/**
 * Rebuild memo for a transform over a JSON-like graph.
 *
 * Normalization input is not always a tree: YAML aliases parse to shared
 * objects (a recursive alias to a cycle) and `structuredClone` keeps that
 * sharing. A global "seen" set would hand the second location of a shared node
 * back untransformed, so each transform here instead memoizes its result per
 * (source node, location context). A context is the part of a location that the
 * transform's rules read; the rules take the context, never the full location,
 * so the result is the same at every location with that context. Each pair is
 * built once: the output keeps the input's sharing and the work stays linear in
 * the number of distinct pairs, not in the number of paths through the graph.
 *
 * The output container is registered before its children are built. A cycle
 * back-edge therefore resolves to the container still under construction, the
 * cycle is reproduced in the output, and the walk terminates. Containers under
 * construction are exactly the ancestors of the current location.
 */
class RebuildMemo<Context> {
  /** Keyed by context first: contexts are few, so this is one map per context, not one per node. */
  private readonly built = new Map<Context, Map<object, object>>()
  private readonly building = new Set<object>()

  get(source: object, context: Context): object | undefined {
    return this.built.get(context)?.get(source)
  }

  build<T extends object>(source: object, context: Context, output: T, fill: (output: T) => void): T {
    let bySource = this.built.get(context)
    if (bySource === undefined) {
      bySource = new Map()
      this.built.set(context, bySource)
    }
    bySource.set(source, output)
    this.building.add(output)
    fill(output)
    this.building.delete(output)
    return output
  }

  /** True for an output container on the current ancestor path, whose contents are not final yet. */
  isBuilding(value: unknown): boolean {
    return typeof value === 'object' && value !== null && this.building.has(value)
  }
}

/** Location context of the noise rules: only root-level fields have a root-only rule. */
type NoiseLocation = 'document' | 'nested'

function removeCollectionNoise(document: unknown, profile: OpenApiCollectProfile): unknown {
  const memo = new RebuildMemo<NoiseLocation>()

  const visit = (value: unknown, location: NoiseLocation): unknown => {
    if (!Array.isArray(value) && !isRecord(value)) return value
    const cached = memo.get(value, location)
    if (cached !== undefined) return cached

    if (Array.isArray(value)) {
      return memo.build(value, location, [] as unknown[], (items) => {
        for (const item of value) items.push(visit(item, 'nested'))
      })
    }
    return memo.build(value, location, {} as Record<string, unknown>, (output) => {
      for (const [key, child] of Object.entries(value)) {
        const next = visit(child, 'nested')
        // A back-edge to an ancestor is never empty once built: it contains
        // the path down to this field. Its emptiness is not final yet, so
        // only finished values are judged as noise.
        if (!memo.isBuilding(next) && shouldDropNoise(key, next, profile, location)) continue
        output[key] = next
      }
    })
  }

  return visit(document, 'document')
}

function shouldDropNoise(
  key: string,
  value: unknown,
  profile: OpenApiCollectProfile,
  parent: NoiseLocation,
): boolean {
  // Only drop empty fields when we know the source generator emitted them as
  // unavoidable defaults. For `generic` we preserve everything — an empty
  // `servers: []` or `tags: []` from an unknown source may be intentional.
  // nestjs-swagger and fastapi both materialize empty info.contact /
  // root-level servers / root-level tags whenever the user didn't configure
  // them explicitly, so the rule is shared.
  if (profile === 'generic') return false
  if (key === 'contact' && isRecord(value) && Object.keys(value).length === 0) return true
  if ((key === 'servers' || key === 'tags') && Array.isArray(value) && value.length === 0 && parent === 'document') {
    return true
  }
  return false
}

/**
 * Location context of the ordering rules.
 *
 * - `keyOrder`: how a record's keys are ordered there. `document` is the root,
 *   `paths` and `components` are the root fields of those names, `under-paths`
 *   is anything deeper inside `paths`, and `plain` is everywhere else.
 * - `sortItems`: whether an array there is sorted (fields named `tags` or `security`).
 */
type SortLocation = {
  readonly keyOrder: SortKeyOrder
  readonly sortItems: boolean
}

type SortKeyOrder = 'document' | 'paths' | 'under-paths' | 'components' | 'plain'

/** One value per context, so a location doubles as the memo key of its context. */
const SORT_LOCATIONS: Record<SortKeyOrder, { readonly unsorted: SortLocation; readonly sorted: SortLocation }> = {
  document: sortLocationPair('document'),
  paths: sortLocationPair('paths'),
  'under-paths': sortLocationPair('under-paths'),
  components: sortLocationPair('components'),
  plain: sortLocationPair('plain'),
}
const SORTED_ARRAY_FIELDS = new Set(['tags', 'security'])
const COMPONENTS_ORDER = [
  'schemas',
  'responses',
  'parameters',
  'examples',
  'requestBodies',
  'headers',
  'securitySchemes',
  'links',
  'callbacks',
  'pathItems',
]

function sortLocationPair(keyOrder: SortKeyOrder): { unsorted: SortLocation; sorted: SortLocation } {
  return { unsorted: { keyOrder, sortItems: false }, sorted: { keyOrder, sortItems: true } }
}

function sortLocation(keyOrder: SortKeyOrder, sortItems: boolean): SortLocation {
  return sortItems ? SORT_LOCATIONS[keyOrder].sorted : SORT_LOCATIONS[keyOrder].unsorted
}

function childSortLocation(parent: SortLocation, key: string): SortLocation {
  return sortLocation(childKeyOrder(parent.keyOrder, key), SORTED_ARRAY_FIELDS.has(key))
}

function childKeyOrder(parent: SortKeyOrder, key: string): SortKeyOrder {
  switch (parent) {
    case 'document':
      return key === 'paths' ? 'paths' : key === 'components' ? 'components' : 'plain'
    case 'paths':
    case 'under-paths':
      return 'under-paths'
    default:
      return 'plain'
  }
}

function sortOpenApiObject(document: unknown): unknown {
  const memo = new RebuildMemo<SortLocation>()

  const visit = (value: unknown, location: SortLocation): unknown => {
    if (!Array.isArray(value) && !isRecord(value)) return value
    const cached = memo.get(value, location)
    if (cached !== undefined) return cached

    if (Array.isArray(value)) {
      return memo.build(value, location, [] as unknown[], (items) => {
        value.forEach((item, index) => items.push(visit(item, childSortLocation(location, String(index)))))
        if (location.sortItems) items.sort(compareStable)
      })
    }
    return memo.build(value, location, {} as Record<string, unknown>, (output) => {
      const keys = Object.keys(value).sort((left, right) => compareOpenApiKeys(location.keyOrder, left, right))
      for (const key of keys) output[key] = visit(value[key], childSortLocation(location, key))
    })
  }

  return visit(document, sortLocation('document', false))
}

function compareOpenApiKeys(keyOrder: SortKeyOrder, left: string, right: string): number {
  switch (keyOrder) {
    case 'document':
      return compareByOrder(ROOT_ORDER, left, right)
    case 'components':
      return compareByOrder(COMPONENTS_ORDER, left, right)
    case 'under-paths':
      if (HTTP_METHODS.has(left) && HTTP_METHODS.has(right)) return compareByOrder([...HTTP_METHODS], left, right)
      return left.localeCompare(right)
    default:
      return left.localeCompare(right)
  }
}

function compareByOrder(order: readonly string[], left: string, right: string): number {
  const leftIndex = order.indexOf(left)
  const rightIndex = order.indexOf(right)
  if (leftIndex >= 0 && rightIndex >= 0) return leftIndex - rightIndex
  if (leftIndex >= 0) return -1
  if (rightIndex >= 0) return 1
  return left.localeCompare(right)
}

function compareStable(left: unknown, right: unknown): number {
  try {
    return JSON.stringify(left).localeCompare(JSON.stringify(right))
  } catch {
    return 0
  }
}

function cloneJson<T>(value: T): T {
  return structuredClone(value)
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function writeText(outputPath: string, content: string): void {
  const resolved = resolve(process.cwd(), outputPath)
  mkdirSync(dirname(resolved), { recursive: true })
  writeFileSync(resolved, content, 'utf8')
}
