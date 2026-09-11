import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { stringify as stringifyYaml } from 'yaml'

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
  const cleaned = removeCollectionNoise(cloned, profile, '#')
  return sortOpenApiObject(cleaned, '#') as Record<string, unknown>
}

export function upgradeOpenApiDocumentTo32(
  document: Record<string, unknown>,
): { document: Record<string, unknown>; report: OpenApiUpgradeReport } {
  const sourceOpenapi = typeof document.openapi === 'string' ? document.openapi : null
  const warnings: OpenApiTransformWarning[] = []
  const conversions: OpenApiTransformWarning[] = []
  const upgraded = cloneJson(document)

  upgraded.openapi = '3.2.0'
  if (sourceOpenapi !== '3.2.0') {
    conversions.push({
      code: 'openapi/version-upgraded',
      pointer: '#/openapi',
      message: `Changed OpenAPI version from ${sourceOpenapi ?? 'unknown'} to 3.2.0 for derived analysis.`,
    })
  }

  upgradeAllSchemaPositions(upgraded, warnings, conversions)

  const normalized = normalizeOpenApiDocument(upgraded)
  return {
    document: normalized,
    report: {
      schemaVersion: 'oa-gen.openapi-upgrade-report.v1',
      sourceOpenapi,
      targetOpenapi: '3.2.0',
      warnings,
      conversions,
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

function upgradeAllSchemaPositions(
  document: Record<string, unknown>,
  warnings: OpenApiTransformWarning[],
  conversions: OpenApiTransformWarning[],
): void {
  const components = readRecord(document.components)
  upgradeRecordOfSchemas(components, 'schemas', '#/components/schemas', warnings, conversions)
  upgradeRecordOfHeaders(components, 'headers', '#/components/headers', warnings, conversions)
  upgradeRecordOfParameters(components, 'parameters', '#/components/parameters', warnings, conversions)
  upgradeRecordOfRequestBodies(components, 'requestBodies', '#/components/requestBodies', warnings, conversions)
  upgradeRecordOfResponses(components, 'responses', '#/components/responses', warnings, conversions)
  upgradeRecordOfCallbacks(components, 'callbacks', '#/components/callbacks', warnings, conversions)
  upgradeRecordOfPathItems(components, 'pathItems', '#/components/pathItems', warnings, conversions)

  upgradeRecordOfPathItems(document, 'paths', '#/paths', warnings, conversions)
  upgradeRecordOfPathItems(document, 'webhooks', '#/webhooks', warnings, conversions)
}

function upgradeRecordOfCallbacks(
  parent: Record<string, unknown>,
  key: string,
  pointer: string,
  warnings: OpenApiTransformWarning[],
  conversions: OpenApiTransformWarning[],
): void {
  const map = readRecord(parent[key])
  for (const [name, callback] of Object.entries(map)) {
    if (!isRecord(callback) || isReference(callback)) continue
    for (const [expression, pathItem] of Object.entries(callback)) {
      if (!isRecord(pathItem) || isReference(pathItem)) continue
      upgradePathItem(pathItem, `${pointer}/${escapeJsonPointer(name)}/${escapeJsonPointer(expression)}`, warnings, conversions)
    }
  }
}

function upgradeRecordOfSchemas(
  parent: Record<string, unknown>,
  key: string,
  pointer: string,
  warnings: OpenApiTransformWarning[],
  conversions: OpenApiTransformWarning[],
): void {
  const map = readRecord(parent[key])
  for (const [name, schema] of Object.entries(map)) {
    if (!isRecord(schema)) continue
    map[name] = upgradeSchemaObject(schema, `${pointer}/${escapeJsonPointer(name)}`, warnings, conversions)
  }
  if (Object.keys(map).length > 0) parent[key] = map
}

function upgradeRecordOfHeaders(
  parent: Record<string, unknown>,
  key: string,
  pointer: string,
  warnings: OpenApiTransformWarning[],
  conversions: OpenApiTransformWarning[],
): void {
  const map = readRecord(parent[key])
  for (const [name, header] of Object.entries(map)) {
    if (!isRecord(header) || isReference(header)) continue
    upgradeParameterLike(header, `${pointer}/${escapeJsonPointer(name)}`, warnings, conversions)
  }
}

function upgradeRecordOfParameters(
  parent: Record<string, unknown>,
  key: string,
  pointer: string,
  warnings: OpenApiTransformWarning[],
  conversions: OpenApiTransformWarning[],
): void {
  const map = readRecord(parent[key])
  for (const [name, parameter] of Object.entries(map)) {
    if (!isRecord(parameter) || isReference(parameter)) continue
    upgradeParameterLike(parameter, `${pointer}/${escapeJsonPointer(name)}`, warnings, conversions)
  }
}

function upgradeRecordOfRequestBodies(
  parent: Record<string, unknown>,
  key: string,
  pointer: string,
  warnings: OpenApiTransformWarning[],
  conversions: OpenApiTransformWarning[],
): void {
  const map = readRecord(parent[key])
  for (const [name, requestBody] of Object.entries(map)) {
    if (!isRecord(requestBody) || isReference(requestBody)) continue
    upgradeRequestBody(requestBody, `${pointer}/${escapeJsonPointer(name)}`, warnings, conversions)
  }
}

function upgradeRecordOfResponses(
  parent: Record<string, unknown>,
  key: string,
  pointer: string,
  warnings: OpenApiTransformWarning[],
  conversions: OpenApiTransformWarning[],
): void {
  const map = readRecord(parent[key])
  for (const [name, response] of Object.entries(map)) {
    if (!isRecord(response) || isReference(response)) continue
    upgradeResponse(response, `${pointer}/${escapeJsonPointer(name)}`, warnings, conversions)
  }
}

function upgradeRecordOfPathItems(
  parent: Record<string, unknown>,
  key: string,
  pointer: string,
  warnings: OpenApiTransformWarning[],
  conversions: OpenApiTransformWarning[],
): void {
  const map = readRecord(parent[key])
  for (const [name, item] of Object.entries(map)) {
    if (!isRecord(item) || isReference(item)) continue
    upgradePathItem(item, `${pointer}/${escapeJsonPointer(name)}`, warnings, conversions)
  }
}

function upgradePathItem(
  pathItem: Record<string, unknown>,
  pointer: string,
  warnings: OpenApiTransformWarning[],
  conversions: OpenApiTransformWarning[],
): void {
  upgradeArrayOfParameters(pathItem, 'parameters', pointer, warnings, conversions)
  for (const method of HTTP_METHODS) {
    const operation = pathItem[method]
    if (!isRecord(operation)) continue
    upgradeOperation(operation, `${pointer}/${method}`, warnings, conversions)
  }
}

function upgradeOperation(
  operation: Record<string, unknown>,
  pointer: string,
  warnings: OpenApiTransformWarning[],
  conversions: OpenApiTransformWarning[],
): void {
  upgradeArrayOfParameters(operation, 'parameters', pointer, warnings, conversions)
  const requestBody = operation.requestBody
  if (isRecord(requestBody) && !isReference(requestBody)) {
    upgradeRequestBody(requestBody, `${pointer}/requestBody`, warnings, conversions)
  }
  const responses = readRecord(operation.responses)
  for (const [code, response] of Object.entries(responses)) {
    if (!isRecord(response) || isReference(response)) continue
    upgradeResponse(response, `${pointer}/responses/${escapeJsonPointer(code)}`, warnings, conversions)
  }
  upgradeRecordOfCallbacks(operation, 'callbacks', `${pointer}/callbacks`, warnings, conversions)
}

function upgradeArrayOfParameters(
  parent: Record<string, unknown>,
  key: string,
  parentPointer: string,
  warnings: OpenApiTransformWarning[],
  conversions: OpenApiTransformWarning[],
): void {
  const list = parent[key]
  if (!Array.isArray(list)) return
  list.forEach((parameter, index) => {
    if (!isRecord(parameter) || isReference(parameter)) return
    upgradeParameterLike(parameter, `${parentPointer}/${key}/${index}`, warnings, conversions)
  })
}

function upgradeParameterLike(
  parameter: Record<string, unknown>,
  pointer: string,
  warnings: OpenApiTransformWarning[],
  conversions: OpenApiTransformWarning[],
): void {
  upgradeSchemaSlot(parameter, pointer, warnings, conversions)
  upgradeContentSlot(parameter, pointer, warnings, conversions)
}

function upgradeRequestBody(
  requestBody: Record<string, unknown>,
  pointer: string,
  warnings: OpenApiTransformWarning[],
  conversions: OpenApiTransformWarning[],
): void {
  upgradeContentSlot(requestBody, pointer, warnings, conversions)
}

function upgradeResponse(
  response: Record<string, unknown>,
  pointer: string,
  warnings: OpenApiTransformWarning[],
  conversions: OpenApiTransformWarning[],
): void {
  upgradeContentSlot(response, pointer, warnings, conversions)
  const headers = readRecord(response.headers)
  for (const [name, header] of Object.entries(headers)) {
    if (!isRecord(header) || isReference(header)) continue
    upgradeParameterLike(header, `${pointer}/headers/${escapeJsonPointer(name)}`, warnings, conversions)
  }
}

function upgradeSchemaSlot(
  parent: Record<string, unknown>,
  parentPointer: string,
  warnings: OpenApiTransformWarning[],
  conversions: OpenApiTransformWarning[],
): void {
  const schema = parent.schema
  if (!isRecord(schema)) return
  parent.schema = upgradeSchemaObject(schema, `${parentPointer}/schema`, warnings, conversions)
}

function upgradeContentSlot(
  parent: Record<string, unknown>,
  parentPointer: string,
  warnings: OpenApiTransformWarning[],
  conversions: OpenApiTransformWarning[],
): void {
  const content = readRecord(parent.content)
  for (const [mediaType, value] of Object.entries(content)) {
    if (!isRecord(value)) continue
    upgradeSchemaSlot(value, `${parentPointer}/content/${escapeJsonPointer(mediaType)}`, warnings, conversions)
  }
}

function isReference(value: Record<string, unknown>): boolean {
  return typeof value.$ref === 'string'
}

function upgradeSchemaObject(
  schema: Record<string, unknown>,
  pointer: string,
  warnings: OpenApiTransformWarning[],
  conversions: OpenApiTransformWarning[],
): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'nullable') continue
    output[key] = upgradeNestedSchemaValue(value, `${pointer}/${escapeJsonPointer(key)}`, warnings, conversions)
  }

  if (schema.nullable === true) {
    conversions.push({
      code: 'schema/nullable-upgraded',
      pointer,
      message: 'Converted OpenAPI 3.0 nullable schema to JSON Schema null union.',
    })
    return applyNullableUpgrade(output, pointer, warnings)
  }

  return output
}

function upgradeNestedSchemaValue(
  value: unknown,
  pointer: string,
  warnings: OpenApiTransformWarning[],
  conversions: OpenApiTransformWarning[],
): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) => upgradeNestedSchemaValue(item, `${pointer}/${index}`, warnings, conversions))
  }
  if (!isRecord(value)) return value
  return upgradeSchemaObject(value, pointer, warnings, conversions)
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

function removeCollectionNoise(
  value: unknown,
  profile: OpenApiCollectProfile,
  pointer: string,
  seen = new Set<unknown>(),
): unknown {
  if (Array.isArray(value)) {
    if (seen.has(value)) return value
    seen.add(value)
    return value.map((item, index) => removeCollectionNoise(item, profile, `${pointer}/${index}`, seen))
  }
  if (!isRecord(value)) return value
  if (seen.has(value)) return value
  seen.add(value)

  const output: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    const childPointer = `${pointer}/${escapeJsonPointer(key)}`
    const next = removeCollectionNoise(child, profile, childPointer, seen)
    if (shouldDropNoise(key, next, profile, childPointer)) continue
    output[key] = next
  }
  return output
}

function shouldDropNoise(
  key: string,
  value: unknown,
  profile: OpenApiCollectProfile,
  pointer: string,
): boolean {
  // Only drop empty fields when we know the source generator emitted them as
  // unavoidable defaults. For `generic` we preserve everything — an empty
  // `servers: []` or `tags: []` from an unknown source may be intentional.
  // nestjs-swagger and fastapi both materialize empty info.contact /
  // root-level servers / root-level tags whenever the user didn't configure
  // them explicitly, so the rule is shared.
  if (profile === 'generic') return false
  if (key === 'contact' && isRecord(value) && Object.keys(value).length === 0) return true
  if ((key === 'servers' || key === 'tags') && Array.isArray(value) && value.length === 0 && pointer.split('/').length === 2) {
    return true
  }
  return false
}

function sortOpenApiObject(
  value: unknown,
  pointer: string,
  seen = new Set<unknown>(),
): unknown {
  if (Array.isArray(value)) {
    if (seen.has(value)) return value
    seen.add(value)
    const items = value.map((item, index) => sortOpenApiObject(item, `${pointer}/${index}`, seen))
    return shouldSortArray(pointer) ? items.sort(compareStable) : items
  }
  if (!isRecord(value)) return value
  if (seen.has(value)) return value
  seen.add(value)

  const keys = Object.keys(value)
  keys.sort((left, right) => compareOpenApiKeys(pointer, left, right))
  const output: Record<string, unknown> = {}
  for (const key of keys) {
    output[key] = sortOpenApiObject(value[key], `${pointer}/${escapeJsonPointer(key)}`, seen)
  }
  return output
}

function compareOpenApiKeys(pointer: string, left: string, right: string): number {
  if (pointer === '#') return compareByOrder(ROOT_ORDER, left, right)
  if (pointer === '#/paths') return left.localeCompare(right)
  if (pointer.startsWith('#/paths/') && HTTP_METHODS.has(left) && HTTP_METHODS.has(right)) {
    return compareByOrder([...HTTP_METHODS], left, right)
  }
  if (pointer === '#/components') {
    return compareByOrder([
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
    ], left, right)
  }
  return left.localeCompare(right)
}

function compareByOrder(order: readonly string[], left: string, right: string): number {
  const leftIndex = order.indexOf(left)
  const rightIndex = order.indexOf(right)
  if (leftIndex >= 0 && rightIndex >= 0) return leftIndex - rightIndex
  if (leftIndex >= 0) return -1
  if (rightIndex >= 0) return 1
  return left.localeCompare(right)
}

function shouldSortArray(pointer: string): boolean {
  return pointer.endsWith('/tags')
    || pointer.endsWith('/security')
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

function escapeJsonPointer(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1')
}
