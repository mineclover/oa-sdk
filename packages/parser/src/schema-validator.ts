import Ajv2020 from 'ajv/dist/2020.js'
import { escapeJsonPointerToken } from './json-pointer.js'
import { attachLintSource, type LintOptions, type LintResult } from './lint.js'
import { getOwnString } from './safe-record.js'

type SchemaLocation = {
  path: string
  schema: Record<string, unknown>
}

const schemaAjv = new Ajv2020({ allErrors: true, strict: false })

/**
 * OpenAPI 문서에 포함된 Schema Object들을 JSON Schema 2020-12 메타스키마로 검증합니다.
 *
 * `lintDocument()`가 operation/ref/security 같은 OpenAPI 문서 규칙을 보완한다면,
 * 이 함수는 `type`, `minimum`, `items` 같은 Schema Object 키워드 자체의
 * 정합성을 검증합니다.
 */
export function validateSchemaObjects(
  doc: Record<string, unknown>,
  options: Pick<LintOptions, 'basePath' | 'lookupSourceLocation'> = {},
): LintResult[] {
  const locations = collectSchemaLocations(doc)
  const results: LintResult[] = []

  for (const { path, schema } of locations) {
    const valid = schemaAjv.validateSchema(schema)
    if (valid) continue

    for (const err of schemaAjv.errors ?? []) {
      results.push(attachLintSource({
        path: `${path}${err.instancePath}`,
        severity: 'error',
        rule: 'schema/meta-valid',
        message: `유효하지 않은 Schema Object: ${err.message ?? err.keyword}`,
      }, options))
    }
  }

  return results
}

function collectSchemaLocations(doc: Record<string, unknown>): SchemaLocation[] {
  const locations: SchemaLocation[] = []

  const components = asRecord(doc['components'])
  if (components) collectComponents(components, '/components', locations)

  const paths = asRecord(doc['paths'])
  if (paths) {
    for (const [path, rawItem] of Object.entries(paths)) {
      collectPathItem(rawItem, `/paths/${escapeJsonPointerToken(path)}`, locations)
    }
  }

  const webhooks = asRecord(doc['webhooks'])
  if (webhooks) {
    for (const [name, rawItem] of Object.entries(webhooks)) {
      collectPathItem(rawItem, `/webhooks/${escapeJsonPointerToken(name)}`, locations)
    }
  }

  return locations
}

function collectComponents(
  components: Record<string, unknown>,
  path: string,
  locations: SchemaLocation[],
): void {
  const schemas = asRecord(components['schemas'])
  if (schemas) {
    for (const [name, schema] of Object.entries(schemas)) {
      pushSchema(schema, `${path}/schemas/${escapeJsonPointerToken(name)}`, locations)
    }
  }

  collectReferenceableMap(components['parameters'], `${path}/parameters`, collectParameter, locations)
  collectReferenceableMap(components['requestBodies'], `${path}/requestBodies`, collectRequestBody, locations)
  collectReferenceableMap(components['responses'], `${path}/responses`, collectResponse, locations)
  collectReferenceableMap(components['headers'], `${path}/headers`, collectHeader, locations)
  collectReferenceableMap(components['pathItems'], `${path}/pathItems`, collectPathItem, locations)
  collectReferenceableMap(components['mediaTypes'], `${path}/mediaTypes`, collectMediaType, locations)
}

function collectPathItem(node: unknown, path: string, locations: SchemaLocation[]): void {
  const item = asRecord(node)
  if (!item || isRef(item)) return

  collectParameterArray(item['parameters'], `${path}/parameters`, locations)

  for (const method of ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace', 'query'] as const) {
    collectOperation(item[method], `${path}/${method}`, locations)
  }

  const additionalOperations = asRecord(item['additionalOperations'])
  if (additionalOperations) {
    for (const [method, op] of Object.entries(additionalOperations)) {
      collectOperation(op, `${path}/additionalOperations/${escapeJsonPointerToken(method)}`, locations)
    }
  }
}

function collectOperation(node: unknown, path: string, locations: SchemaLocation[]): void {
  const op = asRecord(node)
  if (!op || isRef(op)) return

  collectParameterArray(op['parameters'], `${path}/parameters`, locations)
  collectRequestBody(op['requestBody'], `${path}/requestBody`, locations)
  collectResponses(op['responses'], `${path}/responses`, locations)

  const callbacks = asRecord(op['callbacks'])
  if (callbacks) {
    for (const [name, rawCallback] of Object.entries(callbacks)) {
      const callback = asRecord(rawCallback)
      if (!callback || isRef(callback)) continue
      for (const [expression, rawItem] of Object.entries(callback)) {
        collectPathItem(rawItem, `${path}/callbacks/${escapeJsonPointerToken(name)}/${escapeJsonPointerToken(expression)}`, locations)
      }
    }
  }
}

function collectResponses(node: unknown, path: string, locations: SchemaLocation[]): void {
  const responses = asRecord(node)
  if (!responses) return
  for (const [status, response] of Object.entries(responses)) {
    collectResponse(response, `${path}/${escapeJsonPointerToken(status)}`, locations)
  }
}

function collectParameterArray(node: unknown, path: string, locations: SchemaLocation[]): void {
  if (!Array.isArray(node)) return
  node.forEach((param, index) => collectParameter(param, `${path}/${index}`, locations))
}

function collectParameter(node: unknown, path: string, locations: SchemaLocation[]): void {
  const param = asRecord(node)
  if (!param || isRef(param)) return
  pushSchema(param['schema'], `${path}/schema`, locations)
}

function collectRequestBody(node: unknown, path: string, locations: SchemaLocation[]): void {
  const body = asRecord(node)
  if (!body || isRef(body)) return
  collectContent(body['content'], `${path}/content`, locations)
}

function collectResponse(node: unknown, path: string, locations: SchemaLocation[]): void {
  const response = asRecord(node)
  if (!response || isRef(response)) return
  collectContent(response['content'], `${path}/content`, locations)
  collectReferenceableMap(response['headers'], `${path}/headers`, collectHeader, locations)
}

function collectHeader(node: unknown, path: string, locations: SchemaLocation[]): void {
  const header = asRecord(node)
  if (!header || isRef(header)) return
  pushSchema(header['schema'], `${path}/schema`, locations)
}

function collectContent(node: unknown, path: string, locations: SchemaLocation[]): void {
  const content = asRecord(node)
  if (!content) return
  for (const [mediaType, rawMediaType] of Object.entries(content)) {
    collectMediaType(rawMediaType, `${path}/${escapeJsonPointerToken(mediaType)}`, locations)
  }
}

function collectMediaType(node: unknown, path: string, locations: SchemaLocation[]): void {
  const mediaType = asRecord(node)
  if (!mediaType || isRef(mediaType)) return
  pushSchema(mediaType['schema'], `${path}/schema`, locations)
  pushSchema(mediaType['itemSchema'], `${path}/itemSchema`, locations)
}

function collectReferenceableMap(
  node: unknown,
  path: string,
  collector: (node: unknown, path: string, locations: SchemaLocation[]) => void,
  locations: SchemaLocation[],
): void {
  const map = asRecord(node)
  if (!map) return
  for (const [name, value] of Object.entries(map)) {
    collector(value, `${path}/${escapeJsonPointerToken(name)}`, locations)
  }
}

function pushSchema(node: unknown, path: string, locations: SchemaLocation[]): void {
  const schema = asRecord(node)
  if (!schema) return
  locations.push({ path, schema })
}

function asRecord(node: unknown): Record<string, unknown> | undefined {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return undefined
  return node as Record<string, unknown>
}

function isRef(node: Record<string, unknown>): boolean {
  return getOwnString(node, '$ref') !== undefined
}
