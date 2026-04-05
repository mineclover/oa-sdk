/**
 * Zod 4 스키마 → OpenAPI 3.2 Schema Object 변환
 *
 * OAS 3.2는 JSON Schema 2020-12 방언을 사용합니다:
 * - nullable: anyOf + { type: 'null' }
 * - exclusiveMinimum/Maximum: 숫자 (draft-07의 boolean과 다름)
 * - prefixItems: tuple 표현 (JSON Schema 2020-12)
 */

import { z } from 'zod'

export type { OasSchema } from '@oa-sdk/parser'
import type { OasSchema } from '@oa-sdk/parser'

// Zod v4 내부 타입을 피하기 위해 _def 접근 시 unknown 경유 헬퍼
type Def = Record<string, unknown>
function def(schema: z.ZodTypeAny): Def {
  return schema._def as unknown as Def
}

export function zodToSchema(schema: z.ZodTypeAny): OasSchema {
  const result = convertType(schema)
  if (schema.description) result.description = schema.description
  return result
}

// eslint-disable-next-line complexity
function convertType(schema: z.ZodTypeAny): OasSchema {
  const d = def(schema)

  // --- wrappers ---
  if (schema instanceof z.ZodOptional) {
    return zodToSchema(d['innerType'] as z.ZodTypeAny)
  }
  if (schema instanceof z.ZodNullable) {
    const inner = zodToSchema(d['innerType'] as z.ZodTypeAny)
    return { anyOf: [inner, { type: 'null' }] }
  }
  if (schema instanceof z.ZodDefault) {
    const inner = zodToSchema(d['innerType'] as z.ZodTypeAny)
    return { ...inner, default: d['defaultValue'] }
  }
  if (schema instanceof z.ZodCatch) {
    return zodToSchema(d['innerType'] as z.ZodTypeAny)
  }
  // ZodPipe covers both .transform() and .pipe() in Zod v4
  if (schema instanceof z.ZodPipe) {
    return zodToSchema(d['in'] as z.ZodTypeAny)
  }
  if (schema instanceof z.ZodReadonly) {
    return zodToSchema(d['innerType'] as z.ZodTypeAny)
  }
  if (schema instanceof z.ZodLazy) {
    return {} // 재귀 스키마는 $ref로 수동 처리 필요
  }

  // --- primitives ---
  if (schema instanceof z.ZodString) return convertString(schema)
  if (schema instanceof z.ZodNumber) return convertNumber(schema)
  if (schema instanceof z.ZodBigInt) return { type: 'integer', format: 'int64' }
  if (schema instanceof z.ZodBoolean) return { type: 'boolean' }
  if (schema instanceof z.ZodDate) return { type: 'string', format: 'date-time' }
  if (schema instanceof z.ZodNull) return { type: 'null' }
  if (schema instanceof z.ZodUndefined || schema instanceof z.ZodVoid) return {}
  if (schema instanceof z.ZodAny || schema instanceof z.ZodUnknown) return {}
  if (schema instanceof z.ZodNever) return { not: {} }
  if (schema instanceof z.ZodLiteral) return convertLiteral(schema)
  // Zod v4: z.nativeEnum() also produces ZodEnum (no separate ZodNativeEnum)
  if (schema instanceof z.ZodEnum) return convertEnum(schema as unknown as z.ZodTypeAny)

  // --- complex ---
  if (schema instanceof z.ZodArray) return convertArray(schema as unknown as z.ZodTypeAny)
  if (schema instanceof z.ZodTuple) return convertTuple(schema as unknown as z.ZodTypeAny)
  if (schema instanceof z.ZodObject) return convertObject(schema as unknown as z.ZodTypeAny)
  if (schema instanceof z.ZodRecord) {
    return { type: 'object', additionalProperties: zodToSchema(d['valueType'] as z.ZodTypeAny) }
  }
  if (schema instanceof z.ZodMap) {
    return { type: 'object', additionalProperties: zodToSchema(d['valueType'] as z.ZodTypeAny) }
  }
  if (schema instanceof z.ZodSet) {
    return { type: 'array', items: zodToSchema(d['valueType'] as z.ZodTypeAny), uniqueItems: true }
  }
  if (schema instanceof z.ZodDiscriminatedUnion) {
    const options = d['options'] as z.ZodTypeAny[]
    const discriminator = d['discriminator'] as string | undefined
    const result: OasSchema = { oneOf: options.map(zodToSchema) }
    if (discriminator) result.discriminator = { propertyName: discriminator }
    return result
  }
  if (schema instanceof z.ZodUnion) {
    const options = d['options'] as z.ZodTypeAny[]
    return { oneOf: options.map(zodToSchema) }
  }
  if (schema instanceof z.ZodIntersection) {
    return { allOf: [zodToSchema(d['left'] as z.ZodTypeAny), zodToSchema(d['right'] as z.ZodTypeAny)] }
  }

  return {}
}

// ---------------------------------------------------------------------------
// Checks — Zod v4 stores constraints in _def.checks[].
// Each check exposes ._zod.def (generic checks) or .def (format checks).
// ---------------------------------------------------------------------------

type CheckDef = Record<string, unknown>

function getCheckDef(check: unknown): CheckDef | undefined {
  const c = check as Record<string, unknown>
  // Format checks (ZodEmail, ZodUUID, etc.) expose .def directly
  const direct = c['def'] as Record<string, unknown> | undefined
  if (direct && typeof direct['check'] === 'string') return direct
  // Regular checks expose ._zod.def
  const zod = c['_zod'] as Record<string, unknown> | undefined
  const zodDef = zod?.['def'] as Record<string, unknown> | undefined
  if (zodDef && typeof zodDef['check'] === 'string') return zodDef
  return undefined
}

function convertString(schema: z.ZodString): OasSchema {
  const result: OasSchema = { type: 'string' }
  for (const check of (def(schema)['checks'] as unknown[]) ?? []) {
    const cd = getCheckDef(check)
    if (!cd) continue
    switch (cd['check']) {
      case 'min_length': result.minLength = cd['minimum'] as number; break
      case 'max_length': result.maxLength = cd['maximum'] as number; break
      case 'length_equals': {
        const n = cd['length'] as number
        result.minLength = n; result.maxLength = n
        break
      }
      case 'string_format':
        switch (cd['format']) {
          case 'email':    result.format = 'email'; break
          case 'uuid':     result.format = 'uuid'; break
          case 'url':      result.format = 'uri'; break
          case 'datetime': result.format = 'date-time'; break
          case 'date':     result.format = 'date'; break
          case 'time':     result.format = 'time'; break
          case 'duration': result.format = 'duration'; break
          case 'regex': {
            const pat = cd['pattern'] as RegExp | { source: string } | undefined
            if (pat) result.pattern = 'source' in pat ? pat.source : String(pat)
            break
          }
          case 'starts_with': result.pattern = `^${escapeRegex(cd['prefix'] as string ?? '')}`; break
          case 'ends_with':   result.pattern = `${escapeRegex(cd['suffix'] as string ?? '')}$`; break
        }
        break
    }
  }
  return result
}

function convertNumber(schema: z.ZodNumber): OasSchema {
  const result: OasSchema = {}
  const d = def(schema)

  // ZodNumberFormat은 스키마 자체에 check/format을 가짐 (drizzle-orm 패턴)
  let isInt = d['check'] === 'number_format' &&
    typeof d['format'] === 'string' &&
    (d['format'] as string).includes('int')

  for (const check of (d['checks'] as unknown[]) ?? []) {
    const cd = getCheckDef(check)
    if (!cd) continue
    switch (cd['check']) {
      case 'number_format': {
        const fmt = cd['format'] as string | undefined
        if (fmt && (fmt.includes('int') || fmt === 'safeint')) isInt = true
        break
      }
      case 'greater_than': {
        const v = cd['value'] as number
        if (cd['inclusive']) result.minimum = v; else result.exclusiveMinimum = v
        break
      }
      case 'less_than': {
        const v = cd['value'] as number
        if (cd['inclusive']) result.maximum = v; else result.exclusiveMaximum = v
        break
      }
      case 'multiple_of': result.multipleOf = cd['value'] as number; break
    }
  }
  result.type = isInt ? 'integer' : 'number'
  return result
}

function convertLiteral(schema: z.ZodTypeAny): OasSchema {
  // Zod v4: _def.values is an array
  const values = def(schema)['values'] as unknown[]
  if (values.length === 1) {
    const value = values[0]
    const result: OasSchema = { const: value }
    if (typeof value === 'string') result.type = 'string'
    else if (typeof value === 'number') result.type = 'number'
    else if (typeof value === 'boolean') result.type = 'boolean'
    return result
  }
  return { enum: values }
}

function convertEnum(schema: z.ZodTypeAny): OasSchema {
  // Zod v4: both z.enum() and z.nativeEnum() produce ZodEnum with _def.entries
  // TypeScript numeric enums have reverse mappings (number keys), filter those out
  const entries = def(schema)['entries'] as Record<string, unknown>
  const allValues = Object.values(entries)
  const hasNumeric = allValues.some(v => typeof v === 'number')
  const values = hasNumeric ? allValues.filter(v => typeof v === 'number') : allValues
  return { type: hasNumeric ? 'integer' : 'string', enum: values }
}

function convertArray(schema: z.ZodTypeAny): OasSchema {
  // Zod v4: element type in _def.element, length constraints in _def.checks
  const d = def(schema)
  const result: OasSchema = { type: 'array', items: zodToSchema(d['element'] as z.ZodTypeAny) }
  for (const check of (d['checks'] as unknown[]) ?? []) {
    const cd = getCheckDef(check)
    if (!cd) continue
    switch (cd['check']) {
      case 'min_length':    result.minItems = cd['minimum'] as number; break
      case 'max_length':    result.maxItems = cd['maximum'] as number; break
      case 'length_equals': {
        const n = cd['length'] as number
        result.minItems = n; result.maxItems = n
        break
      }
    }
  }
  return result
}

function convertTuple(schema: z.ZodTypeAny): OasSchema {
  const d = def(schema)
  const items = (d['items'] as z.ZodTypeAny[]).map(zodToSchema)
  const rest = d['rest'] as z.ZodTypeAny | null | undefined

  if (items.length === 0 && rest == null) return { type: 'array', maxItems: 0 }
  if (items.length === 0 && rest != null) return { type: 'array', items: zodToSchema(rest) }

  const result: OasSchema = { type: 'array', prefixItems: items }
  if (rest != null) result.items = zodToSchema(rest)
  else result.maxItems = items.length
  return result
}

function convertObject(schema: z.ZodTypeAny): OasSchema {
  // Zod v4: shape is a plain object (not a getter function)
  const shape = def(schema)['shape'] as Record<string, z.ZodTypeAny>
  const result: OasSchema = { type: 'object' }
  const properties: Record<string, OasSchema> = {}
  const required: string[] = []

  for (const [key, value] of Object.entries(shape)) {
    properties[key] = zodToSchema(value)
    if (!isOptionalType(value)) required.push(key)
  }

  if (Object.keys(properties).length > 0) result.properties = properties
  if (required.length > 0) result.required = required

  // Zod v4: catchall=ZodNever → additionalProperties: false
  //         catchall=ZodUnknown/ZodAny → open (default, no additionalProperties)
  //         other catchall → additionalProperties: zodToSchema(catchall)
  const catchall = def(schema)['catchall'] as z.ZodTypeAny | undefined
  if (catchall instanceof z.ZodNever) {
    result.additionalProperties = false
  } else if (
    catchall != null &&
    !(catchall instanceof z.ZodUnknown) &&
    !(catchall instanceof z.ZodAny)
  ) {
    result.additionalProperties = zodToSchema(catchall)
  }

  return result
}

function isOptionalType(schema: z.ZodTypeAny): boolean {
  return (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodDefault ||
    schema instanceof z.ZodCatch
  )
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
