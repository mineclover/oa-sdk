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

export type ZodToSchemaContext = {
  /** Map from Zod schema instance → registered component name (for $ref resolution) */
  refs?: Map<z.ZodTypeAny, string>
  /** Schemas currently being converted (to detect recursion and emit $ref instead) */
  _converting?: Set<z.ZodTypeAny>
}

export function zodToSchema(schema: z.ZodTypeAny, context?: ZodToSchemaContext): OasSchema {
  const result = convertType(schema, context)
  if (schema.description) result.description = schema.description
  return result
}

function getZodKind(schema: z.ZodTypeAny): string {
  const cName = schema?.constructor?.name ?? ''
  if (cName.startsWith('Zod')) return cName
  const d = (schema as any)?._def
  if (typeof d?.typeName === 'string') return d.typeName
  if (typeof d?.type === 'string') {
    const t = d.type
    return 'Zod' + t.charAt(0).toUpperCase() + t.slice(1)
  }
  if (d?.shape) return 'ZodObject'
  if (d?.element) return 'ZodArray'
  if (d?.values && Array.isArray(d.values)) return 'ZodLiteral'
  if (d?.entries) return 'ZodEnum'
  if (d?.discriminator) return 'ZodDiscriminatedUnion'
  if (d?.options || d?.optionsMap) return 'ZodUnion'
  return cName
}

// eslint-disable-next-line complexity
function convertType(schema: z.ZodTypeAny, context?: ZodToSchemaContext): OasSchema {
  const d = def(schema)
  const kind = getZodKind(schema)

  // --- $ref resolution for recursive schemas ---
  // If the schema is registered in refs AND is already being converted (recursive visit),
  // emit a $ref instead of expanding it again (which would cause infinite recursion).
  if (context?.refs) {
    const refName = context.refs.get(schema)
    if (refName) {
      const converting = context._converting ?? (context._converting = new Set())
      if (converting.has(schema)) {
        return { $ref: `#/components/schemas/${refName}` }
      }
      converting.add(schema)
    }
  }

  // --- wrappers ---
  if (schema instanceof z.ZodOptional || kind === 'ZodOptional') {
    return zodToSchema(d['innerType'] as z.ZodTypeAny, context)
  }
  if (schema instanceof z.ZodNullable || kind === 'ZodNullable') {
    const inner = zodToSchema(d['innerType'] as z.ZodTypeAny, context)
    return { anyOf: [inner, { type: 'null' }] }
  }
  if (schema instanceof z.ZodDefault || kind === 'ZodDefault') {
    const inner = zodToSchema(d['innerType'] as z.ZodTypeAny, context)
    return { ...inner, default: d['defaultValue'] }
  }
  if (schema instanceof z.ZodCatch || kind === 'ZodCatch') {
    return zodToSchema(d['innerType'] as z.ZodTypeAny, context)
  }
  // ZodPipe covers both .transform() and .pipe() in Zod v4
  if (schema instanceof z.ZodPipe || kind === 'ZodPipe') {
    return zodToSchema(d['in'] as z.ZodTypeAny, context)
  }
  if (schema instanceof z.ZodReadonly || kind === 'ZodReadonly') {
    return zodToSchema(d['innerType'] as z.ZodTypeAny, context)
  }
  if (schema instanceof z.ZodLazy || kind === 'ZodLazy') {
    // 재귀 스키마: getter를 실행하여 내부 스키마를 얻고 context와 함께 재귀 변환
    if (context?.refs) {
      const getter = d['getter'] as (() => z.ZodTypeAny) | undefined
      if (getter) {
        const innerSchema = getter()
        return zodToSchema(innerSchema, context)
      }
    }
    return {} // refs 없으면 빈 스키마 폴백
  }

  // --- primitives ---
  if (schema instanceof z.ZodString || kind === 'ZodString') return convertString(schema as any)
  if (schema instanceof z.ZodNumber || kind === 'ZodNumber') return convertNumber(schema as any)
  if (schema instanceof z.ZodBigInt || kind === 'ZodBigInt') return { type: 'integer', format: 'int64' }
  if (schema instanceof z.ZodBoolean || kind === 'ZodBoolean') return { type: 'boolean' }
  if (schema instanceof z.ZodDate || kind === 'ZodDate') return { type: 'string', format: 'date-time' }
  if (schema instanceof z.ZodNull || kind === 'ZodNull') return { type: 'null' }
  if (schema instanceof z.ZodUndefined || schema instanceof z.ZodVoid || kind === 'ZodUndefined' || kind === 'ZodVoid') return {}
  if (schema instanceof z.ZodAny || schema instanceof z.ZodUnknown || kind === 'ZodAny' || kind === 'ZodUnknown') return {}
  if (schema instanceof z.ZodNever || kind === 'ZodNever') return { not: {} }
  if (schema instanceof z.ZodLiteral || kind === 'ZodLiteral') return convertLiteral(schema)
  // Zod v4: z.nativeEnum() also produces ZodEnum (no separate ZodNativeEnum)
  if (schema instanceof z.ZodEnum || kind === 'ZodEnum') return convertEnum(schema as unknown as z.ZodTypeAny)

  // --- complex ---
  if (schema instanceof z.ZodArray || kind === 'ZodArray') return convertArray(schema as unknown as z.ZodTypeAny, context)
  if (schema instanceof z.ZodTuple || kind === 'ZodTuple') return convertTuple(schema as unknown as z.ZodTypeAny, context)
  if (schema instanceof z.ZodObject || kind === 'ZodObject') return convertObject(schema as unknown as z.ZodTypeAny, context)
  if (schema instanceof z.ZodRecord || kind === 'ZodRecord') {
    return { type: 'object', additionalProperties: zodToSchema(d['valueType'] as z.ZodTypeAny, context) }
  }
  if (schema instanceof z.ZodMap || kind === 'ZodMap') {
    return { type: 'object', additionalProperties: zodToSchema(d['valueType'] as z.ZodTypeAny, context) }
  }
  if (schema instanceof z.ZodSet || kind === 'ZodSet') {
    return { type: 'array', items: zodToSchema(d['valueType'] as z.ZodTypeAny, context), uniqueItems: true }
  }
  if (schema instanceof z.ZodDiscriminatedUnion || kind === 'ZodDiscriminatedUnion') {
    const rawOptions = d['options'] ?? d['optionsMap']
    let options: z.ZodTypeAny[] = []
    if (Array.isArray(rawOptions)) {
      options = rawOptions
    } else if (rawOptions instanceof Map) {
      options = Array.from(rawOptions.values())
    } else if (rawOptions && typeof (rawOptions as unknown as Iterable<z.ZodTypeAny>)[Symbol.iterator] === 'function') {
      options = Array.from(rawOptions as unknown as Iterable<z.ZodTypeAny>)
    }

    const discriminator = (d['discriminator'] as string | undefined) ?? (schema as unknown as { discriminator?: string }).discriminator
    const result: OasSchema = {
      oneOf: options.map(o => {
        const refName = context?.refs?.get(o)
        if (refName) {
          return { $ref: `#/components/schemas/${refName}` }
        }
        return zodToSchema(o, context)
      }),
    }

    if (discriminator) {
      const mapping: Record<string, string> = {}
      if (context?.refs) {
        for (const opt of options) {
          const refName = context.refs.get(opt)
          if (refName) {
            const optDef = def(opt)
            const rawShape = optDef['shape'] ?? (opt as unknown as { shape?: unknown }).shape
            const shape = (typeof rawShape === 'function' ? rawShape() : rawShape) as Record<string, z.ZodTypeAny> | undefined
            if (shape && shape[discriminator]) {
              const discProp = shape[discriminator]
              const discPropDef = def(discProp)
              const discKind = getZodKind(discProp)
              if (discProp instanceof z.ZodLiteral || discKind === 'ZodLiteral') {
                const values = discPropDef['values'] as unknown[] | undefined
                const val = values?.[0] ?? (discProp as unknown as { value?: unknown }).value ?? discPropDef['value']
                if (val !== undefined) {
                  mapping[String(val)] = `#/components/schemas/${refName}`
                }
              } else if (discProp instanceof z.ZodEnum || discKind === 'ZodEnum') {
                const entries = discPropDef['entries'] as Record<string, unknown> | undefined
                const enumVals = (discPropDef['values'] as unknown[]) ?? (entries ? Object.values(entries) : [])
                for (const v of enumVals) {
                  mapping[String(v)] = `#/components/schemas/${refName}`
                }
              } else if (discPropDef['const'] !== undefined) {
                mapping[String(discPropDef['const'])] = `#/components/schemas/${refName}`
              }
            }
          }
        }
      }

      if (Object.keys(mapping).length > 0) {
        result.discriminator = { propertyName: discriminator, mapping }
      } else {
        result.discriminator = { propertyName: discriminator }
      }
    }
    return result
  }
  if (schema instanceof z.ZodUnion || kind === 'ZodUnion') {
    const options = (d['options'] ?? d['optionsMap']) as z.ZodTypeAny[]
    return { oneOf: Array.isArray(options) ? options.map(o => zodToSchema(o, context)) : [] }
  }
  if (schema instanceof z.ZodIntersection || kind === 'ZodIntersection') {
    return { allOf: [zodToSchema(d['left'] as z.ZodTypeAny, context), zodToSchema(d['right'] as z.ZodTypeAny, context)] }
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
  // TypeScript numeric enums have reverse mappings: e.g. { Foo: 0, 0: 'Foo' }
  // Filter out reverse-mapping entries (string values that are keys pointing to a number)
  const entries = def(schema)['entries'] as Record<string, unknown>
  const allValues = Object.values(entries)
  const hasNumeric = allValues.some(v => typeof v === 'number')

  let values: unknown[]
  if (hasNumeric) {
    // Filter out reverse-mapping values: a string value V is a reverse mapping
    // if entries[V] is a number (i.e., V is a key name whose value is numeric)
    values = allValues.filter(v => {
      if (typeof v === 'string' && typeof entries[v] === 'number') return false
      return true
    })
  } else {
    values = allValues
  }

  const hasString = values.some(v => typeof v === 'string')
  const type = hasString && hasNumeric ? 'string' : hasNumeric ? 'integer' : 'string'
  return { type, enum: values }
}

function convertArray(schema: z.ZodTypeAny, context?: ZodToSchemaContext): OasSchema {
  // Zod v4: element type in _def.element, length constraints in _def.checks
  const d = def(schema)
  const result: OasSchema = { type: 'array', items: zodToSchema(d['element'] as z.ZodTypeAny, context) }
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

function convertTuple(schema: z.ZodTypeAny, context?: ZodToSchemaContext): OasSchema {
  const d = def(schema)
  const items = (d['items'] as z.ZodTypeAny[]).map(i => zodToSchema(i, context))
  const rest = d['rest'] as z.ZodTypeAny | null | undefined

  if (items.length === 0 && rest == null) return { type: 'array', maxItems: 0 }
  if (items.length === 0 && rest != null) return { type: 'array', items: zodToSchema(rest, context) }

  const result: OasSchema = { type: 'array', prefixItems: items }
  if (rest != null) result.items = zodToSchema(rest, context)
  else result.maxItems = items.length
  return result
}

function convertObject(schema: z.ZodTypeAny, context?: ZodToSchemaContext): OasSchema {
  // Zod v4: shape is a plain object (not a getter function)
  const shape = def(schema)['shape'] as Record<string, z.ZodTypeAny>
  const result: OasSchema = { type: 'object' }
  const properties: Record<string, OasSchema> = {}
  const required: string[] = []

  for (const [key, value] of Object.entries(shape)) {
    properties[key] = zodToSchema(value, context)
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
    result.additionalProperties = zodToSchema(catchall, context)
  }

  return result
}

function isOptionalType(schema: z.ZodTypeAny): boolean {
  const kind = getZodKind(schema)
  return (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodDefault ||
    schema instanceof z.ZodCatch ||
    kind === 'ZodOptional' ||
    kind === 'ZodDefault' ||
    kind === 'ZodCatch'
  )
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
