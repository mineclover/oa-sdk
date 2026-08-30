import type { OasSchema } from '@oa-sdk/parser/browser'

/** Generated client에 포함할 경량 schema runtime을 추가합니다. */
export function appendRuntimeValidationHelpers(lines: string[]): void {
  const templateQuote = String.fromCharCode(96)
  lines.push(
    'type __OaRuntimeSchema = {',
    '  type?: string | string[]',
    '  const?: unknown',
    '  enum?: unknown[]',
    '  minimum?: number',
    '  maximum?: number',
    '  exclusiveMinimum?: number',
    '  exclusiveMaximum?: number',
    '  minLength?: number',
    '  maxLength?: number',
    '  pattern?: string',
    '  format?: string',
    '  minItems?: number',
    '  maxItems?: number',
    '  uniqueItems?: boolean',
    '  minProperties?: number',
    '  maxProperties?: number',
    '  required?: string[]',
    '  properties?: Record<string, __OaRuntimeSchema>',
    '  items?: __OaRuntimeSchema',
    '  anyOf?: __OaRuntimeSchema[]',
    '  oneOf?: __OaRuntimeSchema[]',
    '  allOf?: __OaRuntimeSchema[]',
    '  not?: __OaRuntimeSchema',
    '  additionalProperties?: boolean | __OaRuntimeSchema',
    '  unevaluatedProperties?: boolean | __OaRuntimeSchema',
    '}',
    '',
    'function __oaEqual(a: unknown, b: unknown): boolean {',
    '  if (Object.is(a, b)) return true',
    '  try { return JSON.stringify(a) === JSON.stringify(b) } catch { return false }',
    '}',
    '',
    'function __oaTypeMatches(value: unknown, type: string): boolean {',
    '  switch (type) {',
    "    case 'null': return value === null",
    "    case 'object': return typeof value === 'object' && value !== null && !Array.isArray(value)",
    "    case 'array': return Array.isArray(value)",
    "    case 'integer': return typeof value === 'number' && Number.isInteger(value)",
    "    case 'number': return typeof value === 'number' && Number.isFinite(value)",
    "    case 'boolean': return typeof value === 'boolean'",
    "    case 'string': return typeof value === 'string'",
    '    default: return true',
    '  }',
    '}',
    '',
    'function __oaFormatMatches(value: string, format: string): boolean {',
    "  if (format === 'uuid') return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)",
    "  if (format === 'email') return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(value)",
    '  return true',
    '}',
    '',
    'function __oaSchemaMatches(value: unknown, schema: __OaRuntimeSchema, coercePrimitive = false): boolean {',
    '  if (schema.anyOf && !schema.anyOf.some(item => __oaSchemaMatches(value, item, coercePrimitive))) return false',
    '  if (schema.oneOf && schema.oneOf.filter(item => __oaSchemaMatches(value, item, coercePrimitive)).length !== 1) return false',
    '  if (schema.allOf && !schema.allOf.every(item => __oaSchemaMatches(value, item, coercePrimitive))) return false',
    '  if (schema.not && __oaSchemaMatches(value, schema.not, coercePrimitive)) return false',
    '  let candidate = value',
    '  const types = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type]',
    "  if (coercePrimitive && typeof candidate === 'string' && candidate.trim() !== '' && types.some(type => type === 'integer' || type === 'number')) {",
    '    const numeric = Number(candidate)',
    '    if (Number.isFinite(numeric)) candidate = numeric',
    '  }',
    '  if (types.length > 0 && !types.some(type => __oaTypeMatches(candidate, type))) return false',
    '  if (schema.const !== undefined && !__oaEqual(candidate, schema.const)) return false',
    '  if (schema.enum && !schema.enum.some(item => __oaEqual(candidate, item))) return false',
    "  if (typeof candidate === 'number') {",
    '    if (schema.minimum !== undefined && candidate < schema.minimum) return false',
    '    if (schema.maximum !== undefined && candidate > schema.maximum) return false',
    '    if (schema.exclusiveMinimum !== undefined && candidate <= schema.exclusiveMinimum) return false',
    '    if (schema.exclusiveMaximum !== undefined && candidate >= schema.exclusiveMaximum) return false',
    '  }',
    "  if (typeof candidate === 'string') {",
    '    if (schema.minLength !== undefined && candidate.length < schema.minLength) return false',
    '    if (schema.maxLength !== undefined && candidate.length > schema.maxLength) return false',
    '    if (schema.pattern !== undefined) { try { if (!new RegExp(schema.pattern).test(candidate)) return false } catch { return false } }',
    '    if (schema.format !== undefined && !__oaFormatMatches(candidate, schema.format)) return false',
    '  }',
    '  if (Array.isArray(candidate)) {',
    '    if (schema.minItems !== undefined && candidate.length < schema.minItems) return false',
    '    if (schema.maxItems !== undefined && candidate.length > schema.maxItems) return false',
    '    if (schema.uniqueItems && candidate.some((item, index) => candidate.findIndex(other => __oaEqual(item, other)) !== index)) return false',
    '    if (schema.items && !candidate.every(item => __oaSchemaMatches(item, schema.items!))) return false',
    '  }',
    "  if (typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)) {",
    '    const record = candidate as Record<string, unknown>',
    '    if (schema.minProperties !== undefined && Object.keys(record).length < schema.minProperties) return false',
    '    if (schema.maxProperties !== undefined && Object.keys(record).length > schema.maxProperties) return false',
    '    for (const required of schema.required ?? []) if (!(required in record) || record[required] === undefined) return false',
    '    for (const [name, propertySchema] of Object.entries(schema.properties ?? {})) {',
    '      if (name in record && !__oaSchemaMatches(record[name], propertySchema)) return false',
    '    }',
    '    const additional = schema.unevaluatedProperties ?? schema.additionalProperties',
    '    if (additional === false) {',
    '      for (const name of Object.keys(record)) if (!(name in (schema.properties ?? {}))) return false',
    "    } else if (additional && typeof additional === 'object') {",
    '      for (const name of Object.keys(record)) if (!(name in (schema.properties ?? {})) && !__oaSchemaMatches(record[name], additional)) return false',
    '    }',
    '  }',
    '  return true',
    '}',
    '',
    'function __oaAssertValid(value: unknown, schema: __OaRuntimeSchema, path: string, coercePrimitive = false): void {',
    '  if (!__oaSchemaMatches(value, schema, coercePrimitive)) throw new TypeError(' + templateQuote + 'Invalid ' + '$' + '{path}' + templateQuote + ')',
    '}',
    '',
  )
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
      'minLength', 'maxLength', 'pattern', 'format', 'minItems', 'maxItems', 'uniqueItems',
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
  return 'JSON.parse(' + JSON.stringify(serialized) + ') as __OaRuntimeSchema'
}
