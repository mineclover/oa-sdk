import type { OasParameter, OasRequestBody, OasResponse, OasSchema } from '@oa-sdk/parser'

export type ErrorValidationEntry = {
  key: string
  schema: OasSchema
}

/** 생성 client가 공유하는 요청/오류 schema runtime helper를 추가합니다. */
export function appendRuntimeValidationHelpers(lines: string[]): void {
  lines.push(`type __OaRuntimeSchema = {`)
  lines.push(`  type?: string | string[]`)
  lines.push(`  const?: unknown`)
  lines.push(`  enum?: unknown[]`)
  lines.push(`  minimum?: number`)
  lines.push(`  maximum?: number`)
  lines.push(`  exclusiveMinimum?: number`)
  lines.push(`  exclusiveMaximum?: number`)
  lines.push(`  minLength?: number`)
  lines.push(`  maxLength?: number`)
  lines.push(`  pattern?: string`)
  lines.push(`  minItems?: number`)
  lines.push(`  maxItems?: number`)
  lines.push(`  uniqueItems?: boolean`)
  lines.push(`  minProperties?: number`)
  lines.push(`  maxProperties?: number`)
  lines.push(`  required?: string[]`)
  lines.push(`  properties?: Record<string, __OaRuntimeSchema>`)
  lines.push(`  items?: __OaRuntimeSchema`)
  lines.push(`  anyOf?: __OaRuntimeSchema[]`)
  lines.push(`  oneOf?: __OaRuntimeSchema[]`)
  lines.push(`  allOf?: __OaRuntimeSchema[]`)
  lines.push(`  not?: __OaRuntimeSchema`)
  lines.push(`  additionalProperties?: boolean | __OaRuntimeSchema`)
  lines.push(`  unevaluatedProperties?: boolean | __OaRuntimeSchema`)
  lines.push(`}`)
  lines.push('')
  lines.push(`function __oaEqual(a: unknown, b: unknown): boolean {`)
  lines.push(`  if (Object.is(a, b)) return true`)
  lines.push(`  try { return JSON.stringify(a) === JSON.stringify(b) } catch { return false }`)
  lines.push(`}`)
  lines.push('')
  lines.push(`function __oaTypeMatches(value: unknown, type: string): boolean {`)
  lines.push(`  switch (type) {`)
  lines.push(`    case 'null': return value === null`)
  lines.push(`    case 'object': return typeof value === 'object' && value !== null && !Array.isArray(value)`)
  lines.push(`    case 'array': return Array.isArray(value)`)
  lines.push(`    case 'integer': return typeof value === 'number' && Number.isInteger(value)`)
  lines.push(`    case 'number': return typeof value === 'number' && Number.isFinite(value)`)
  lines.push(`    case 'boolean': return typeof value === 'boolean'`)
  lines.push(`    case 'string': return typeof value === 'string'`)
  lines.push(`    default: return true`)
  lines.push(`  }`)
  lines.push(`}`)
  lines.push('')
  lines.push(`function __oaSchemaMatches(value: unknown, schema: __OaRuntimeSchema, coercePrimitive = false): boolean {`)
  lines.push(`  if (schema.anyOf && !schema.anyOf.some(item => __oaSchemaMatches(value, item, coercePrimitive))) return false`)
  lines.push(`  if (schema.oneOf && schema.oneOf.filter(item => __oaSchemaMatches(value, item, coercePrimitive)).length !== 1) return false`)
  lines.push(`  if (schema.allOf && !schema.allOf.every(item => __oaSchemaMatches(value, item, coercePrimitive))) return false`)
  lines.push(`  if (schema.not && __oaSchemaMatches(value, schema.not, coercePrimitive)) return false`)
  lines.push(`  let candidate = value`)
  lines.push(`  const types = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type]`)
  lines.push(`  if (coercePrimitive && typeof candidate === 'string' && candidate.trim() !== '' && types.some(type => type === 'integer' || type === 'number')) {`)
  lines.push(`    const numeric = Number(candidate)`)
  lines.push(`    if (Number.isFinite(numeric)) candidate = numeric`)
  lines.push(`  }`)
  lines.push(`  if (types.length > 0 && !types.some(type => __oaTypeMatches(candidate, type))) return false`)
  lines.push(`  if (schema.const !== undefined && !__oaEqual(candidate, schema.const)) return false`)
  lines.push(`  if (schema.enum && !schema.enum.some(item => __oaEqual(candidate, item))) return false`)
  lines.push(`  if (typeof candidate === 'number') {`)
  lines.push(`    if (schema.minimum !== undefined && candidate < schema.minimum) return false`)
  lines.push(`    if (schema.maximum !== undefined && candidate > schema.maximum) return false`)
  lines.push(`    if (schema.exclusiveMinimum !== undefined && candidate <= schema.exclusiveMinimum) return false`)
  lines.push(`    if (schema.exclusiveMaximum !== undefined && candidate >= schema.exclusiveMaximum) return false`)
  lines.push(`  }`)
  lines.push(`  if (typeof candidate === 'string') {`)
  lines.push(`    if (schema.minLength !== undefined && candidate.length < schema.minLength) return false`)
  lines.push(`    if (schema.maxLength !== undefined && candidate.length > schema.maxLength) return false`)
  lines.push(`    if (schema.pattern !== undefined) { try { if (!new RegExp(schema.pattern).test(candidate)) return false } catch { return false } }`)
  lines.push(`  }`)
  lines.push(`  if (Array.isArray(candidate)) {`)
  lines.push(`    if (schema.minItems !== undefined && candidate.length < schema.minItems) return false`)
  lines.push(`    if (schema.maxItems !== undefined && candidate.length > schema.maxItems) return false`)
  lines.push(`    if (schema.uniqueItems && candidate.some((item, index) => candidate.findIndex(other => __oaEqual(item, other)) !== index)) return false`)
  lines.push(`    if (schema.items && !candidate.every(item => __oaSchemaMatches(item, schema.items!))) return false`)
  lines.push(`  }`)
  lines.push(`  if (typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)) {`)
  lines.push(`    const record = candidate as Record<string, unknown>`)
  lines.push(`    if (schema.minProperties !== undefined && Object.keys(record).length < schema.minProperties) return false`)
  lines.push(`    if (schema.maxProperties !== undefined && Object.keys(record).length > schema.maxProperties) return false`)
  lines.push(`    for (const required of schema.required ?? []) if (!(required in record) || record[required] === undefined) return false`)
  lines.push(`    for (const [name, propertySchema] of Object.entries(schema.properties ?? {})) {`)
  lines.push(`      if (name in record && !__oaSchemaMatches(record[name], propertySchema)) return false`)
  lines.push(`    }`)
  lines.push(`    const additional = schema.unevaluatedProperties ?? schema.additionalProperties`)
  lines.push(`    if (additional === false) {`)
  lines.push(`      for (const name of Object.keys(record)) if (!(name in (schema.properties ?? {}))) return false`)
  lines.push(`    } else if (additional && typeof additional === 'object') {`)
  lines.push(`      for (const name of Object.keys(record)) if (!(name in (schema.properties ?? {})) && !__oaSchemaMatches(record[name], additional)) return false`)
  lines.push(`    }`)
  lines.push(`  }`)
  lines.push(`  return true`)
  lines.push(`}`)
  lines.push('')
  lines.push(`function __oaAssertValid(value: unknown, schema: __OaRuntimeSchema, path: string, coercePrimitive = false): void {`)
  lines.push(`  if (!__oaSchemaMatches(value, schema, coercePrimitive)) throw new TypeError(\`Invalid \${path}\`)`)
  lines.push(`}`)
  lines.push('')
}

/** ClientError가 다른 generated bundle/realm에서 만들어져도 식별할 수 있게 합니다. */
export function appendClientErrorGuard(lines: string[]): void {
  lines.push(`export function isClientError(error: unknown): error is ClientError {`)
  lines.push(`  if (error instanceof ClientError) return true`)
  lines.push(`  if (typeof error !== 'object' || error === null) return false`)
  lines.push(`  const candidate = error as { name?: unknown; status?: unknown; body?: unknown; response?: unknown }`)
  lines.push(`  return candidate.name === 'ClientError' && typeof candidate.status === 'number' && 'body' in candidate && 'response' in candidate`)
  lines.push(`}`)
  lines.push('')
}

export function isOperationRetryable(operation: { method: string }): boolean {
  const explicit = (operation as unknown as Record<string, unknown>)['x-oa-sdk-retryable']
  if (typeof explicit === 'boolean') return explicit
  return ['GET', 'HEAD', 'OPTIONS', 'DELETE'].includes(operation.method.toUpperCase())
}

export function getRequestBodySchema(requestBody: OasRequestBody | undefined): OasSchema | undefined {
  const media = requestBody?.content?.['application/json']
  if (!media || '$ref' in media) return undefined
  return media.schema
}

export function requestValidationLines(
  operation: {
    parameters: OasParameter[]
    requestBody?: OasRequestBody
  },
  indent = '      ',
): string[] {
  const pathParams = operation.parameters.filter(parameter => parameter.in === 'path')
  const queryParams = operation.parameters.filter(parameter => parameter.in === 'query')
  const bodySchema = getRequestBodySchema(operation.requestBody)
  const bodyRequired = operation.requestBody?.required === true
  const queryNeedsValidation = queryParams.some(parameter => parameter.required || parameter.schema)
  const needsValidation = pathParams.length > 0 || queryNeedsValidation || bodySchema !== undefined || bodyRequired
  if (!needsValidation) return []

  const lines = [`${indent}if (config.validate) {`]
  for (const parameter of pathParams) {
    const name = JSON.stringify(parameter.name)
    lines.push(`${indent}  if (params[${name}] === undefined) throw new Error('Missing required path parameter: ${parameter.name}')`)
    const schema = serializeValidationSchema(parameter.schema)
    if (schema) lines.push(`${indent}  __oaAssertValid(params[${name}], ${schema}, 'params.${parameter.name}', true)`)
  }
  if (queryParams.length > 0) {
    for (const parameter of queryParams) {
      const name = JSON.stringify(parameter.name)
      if (parameter.required) lines.push(`${indent}  if (query?.[${name}] === undefined) throw new Error('Missing required query parameter: ${parameter.name}')`)
      const schema = serializeValidationSchema(parameter.schema)
      if (schema) lines.push(`${indent}  if (query?.[${name}] !== undefined) __oaAssertValid(query[${name}], ${schema}, 'query.${parameter.name}', true)`)
    }
  }
  if (bodyRequired) lines.push(`${indent}  if (body === undefined) throw new Error('Missing required request body')`)
  if (bodySchema) {
    const schema = serializeValidationSchema(bodySchema)
    if (schema) lines.push(`${indent}  if (body !== undefined) __oaAssertValid(body, ${schema}, 'body')`)
  }
  lines.push(`${indent}}`)
  return lines
}

export function getErrorValidationEntries(responses: Record<string, OasResponse>): ErrorValidationEntry[] {
  const keys = [
    ...Object.keys(responses).filter(key => /^[45]\d{2}$/.test(key)).sort(),
    'default',
  ]
  const entries: ErrorValidationEntry[] = []
  for (const key of keys) {
    const media = responses[key]?.content?.['application/json']
    if (!media || '$ref' in media || !media.schema) continue
    entries.push({ key, schema: media.schema })
  }
  return entries
}

/** JSON Schema의 runtime 검증에 필요한 부분만 안전하게 직렬화합니다. */
export function serializeValidationSchema(schema: OasSchema | undefined): string | undefined {
  if (!schema) return undefined
  const seen = new WeakSet<object>()
  const visit = (value: OasSchema | boolean | undefined): unknown => {
    if (value === undefined || typeof value === 'boolean') return value
    if (typeof value !== 'object') return undefined
    if (seen.has(value)) return {}
    seen.add(value)

    const output: Record<string, unknown> = {}
    for (const key of [
      'type', 'const', 'enum', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
      'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems', 'uniqueItems',
      'minProperties', 'maxProperties', 'required',
    ] as const) {
      if (value[key] !== undefined) output[key] = value[key]
    }
    if (value.properties) {
      output.properties = Object.fromEntries(Object.entries(value.properties).map(([name, child]) => [name, visit(child)]))
    }
    if (value.items) output.items = visit(value.items)
    if (value.anyOf) output.anyOf = value.anyOf.map(visit)
    if (value.oneOf) output.oneOf = value.oneOf.map(visit)
    if (value.allOf) output.allOf = value.allOf.map(visit)
    if (value.not) output.not = visit(value.not)
    if (value.additionalProperties !== undefined) output.additionalProperties = visit(value.additionalProperties)
    if (value.unevaluatedProperties !== undefined) output.unevaluatedProperties = visit(value.unevaluatedProperties)
    return output
  }
  const serialized = JSON.stringify(visit(schema))
  return `JSON.parse(${JSON.stringify(serialized)}) as __OaRuntimeSchema`
}
