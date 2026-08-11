/**
 * OAS Schema → TypeScript 타입 문자열 변환
 *
 * SchemaAlgebra<string> 기반. foldSchema()로 스키마를 순회하며
 * TypeScript 타입 표현을 조립한다.
 *
 * 지원:
 *   - 기본 타입: string, number, boolean, null
 *   - 객체: properties + required → optional 구분
 *   - 배열: items, prefixItems(튜플)
 *   - 조합: allOf(&), oneOf(|), anyOf(|)
 *   - nullable: type 배열 ['string', 'null'] → string | null
 *   - enum/const
 *   - $ref → 이름 참조
 *   - format 주석 (/** @format uuid *​/)
 */

import { foldSchema, type SchemaAlgebra, type OasSchema } from '@oa-sdk/parser/browser'
import { escapeKey } from '@oa-sdk/core/browser'
import { compareTypegenKeys } from './stable-order.js'

/**
 * OAS Schema → TypeScript 타입 문자열
 *
 * example/default는 타입 생성에 무관하므로 제거 후 fold.
 * (foldSchema는 example/default를 type보다 우선 처리하기 때문)
 */
export type SchemaToTsOptions = {
  /** annotations 필드를 JSDoc에 포함 (기본: false) */
  includeAnnotations?: boolean
  /** $ref 문자열 → 생성된 타입 이름 override */
  refNameOverrides?: Record<string, string>
}

/**
 * 독립적인 OAS Schema → TypeScript algebra를 만든다.
 *
 * 옵션과 재귀 참조는 반환된 인스턴스의 closure에만 존재하므로 서로 다른
 * typegen 호출이나 직접 `foldSchema()` 소비자 사이에 상태가 공유되지 않는다.
 */
export function createTypescriptAlgebra(options: SchemaToTsOptions = {}): SchemaAlgebra<string> {
  const includeAnnotations = options.includeAnnotations === true
  const refNameOverrides = { ...options.refNameOverrides }
  const algebra: SchemaAlgebra<string> = {
    string:  (s) => withNullable(s, resolveStringType(s)),
    integer: (s) => withNullable(s, s.enum
      ? s.enum.map(v => String(v)).join(' | ')
      : 'number'),
    number:  (s) => withNullable(s, s.enum
      ? s.enum.map(v => String(v)).join(' | ')
      : 'number'),
    boolean: (s) => withNullable(s, s.enum
      ? s.enum.map(v => String(v)).join(' | ')
      : s.const !== undefined ? String(s.const) : 'boolean'),
    null:    () => 'null',

    object(s, props) {
      const required = new Set(s.required ?? [])
      const propSchemas = (s.properties ?? {}) as Record<string, OasSchema>
      const sortedProps = Object.entries(props)
        .sort(([left], [right]) => compareTypegenKeys(left, right))
      const fields = sortedProps.map(([key, type]) => {
        const opt = required.has(key) ? '' : '?'
        const ps = propSchemas[key] as OasSchema & Record<string, unknown> | undefined
        const ro = ps?.readOnly ? 'readonly ' : ''
        const jsdoc = buildPropJSDoc(ps, includeAnnotations)
        return `${jsdoc}  ${ro}${escapeKey(key)}${opt}: ${type}`
      })

      // additionalProperties is the OAS 3.0/3.1 spelling. TypeSpec's OAS 3.2
      // emitter uses unevaluatedProperties for Record<T>; preserve that value
      // shape instead of widening generated maps to Record<string, unknown>.
      const addProps = s.additionalProperties ?? s.unevaluatedProperties
      if (addProps === true) {
        if (fields.length === 0) return 'Record<string, unknown>'
        fields.push('  [key: string]: unknown')
      } else if (addProps && typeof addProps === 'object' && !isNeverSchema(addProps)) {
        const addType = foldSchema(addProps as OasSchema, algebra)
        if (fields.length === 0) return `Record<string, ${addType}>`
        const indexType = widenIndexSignatureType(addType, sortedProps, required)
        fields.push(`  [key: string]: ${indexType}`)
      }

      if (fields.length === 0) return 'Record<string, unknown>'
      return `{\n${fields.join('\n')}\n}`
    },

    array(s, items) {
      // tuple (prefixItems)
      if (s.prefixItems?.length) {
        const prefix = s.prefixItems.map(p => foldSchema(p, algebra))
        if (s.items) {
          return `[${prefix.join(', ')}, ...${toArrayType(items ?? 'unknown')}]`
        }
        return `[${prefix.join(', ')}]`
      }
      return toArrayType(items ?? 'unknown')
    },

    allOf(s, branches) {
      const base = foldCompositionSiblings(s, ['allOf'], algebra)
      return joinIntersection(base ? [base, ...branches] : branches, 'unknown')
    },

    oneOf(s, branches) {
      const union = joinUnion(branches, 'never')
      const base = foldCompositionSiblings(s, ['oneOf'], algebra)
      return base ? joinIntersection([base, union], 'never') : union
    },

    anyOf(s, branches) {
      const union = joinUnion(branches, 'unknown')
      const omittedKeys = s.then || s.else
        ? ['anyOf', 'if', 'then', 'else'] as const
        : ['anyOf'] as const
      const base = foldCompositionSiblings(s, omittedKeys, algebra)
      return base ? joinIntersection([base, union], 'unknown') : union
    },

    typeUnion(s, branches) {
      if (s.enum) {
        const allowedValues = s.enum.filter(value => schemaTypeArrayAccepts(s.type, value))
        return joinUnion(allowedValues.map(literalToTs), 'never')
      }
      if (s.const !== undefined) {
        return schemaTypeArrayAccepts(s.type, s.const) ? literalToTs(s.const) : 'never'
      }
      return joinUnion(branches, 'never')
    },

    ref(r) {
      const override = refNameOverrides[r]
      if (override) return override
      // #/components/schemas/User → User
      const name = r.split('/').pop()
      return name ?? 'unknown'
    },

    example() { return 'unknown' },
    default_() { return 'unknown' },
    fallback(node) {
      if (node && typeof node === 'object' && !Array.isArray(node)) {
        const schema = node as OasSchema
        if (schema.enum) return schema.enum.map(literalToTs).join(' | ')
        if (schema.const !== undefined) return literalToTs(schema.const)
        if (isNeverSchema(schema)) return 'never'
      }
      return 'unknown'
    },
  }

  return algebra
}

/** 기본 옵션을 사용하는 상태 없는 호환 algebra. */
export const typescriptAlgebra: SchemaAlgebra<string> = createTypescriptAlgebra()

export function schemaToTs(schema: OasSchema, options?: SchemaToTsOptions): string {
  // example/default 제거 — 타입 생성에서는 타입 정보만 사용
  const clean = stripExamples(schema)
  return foldSchema(clean, createTypescriptAlgebra(options))
}

/** example/default 제거 + const 정규화 — 타입 정보만 남김 */
function stripExamples(schema: OasSchema): OasSchema {
  const { example, default: def, ...rest } = schema as Record<string, unknown>
  const result = rest as OasSchema

  // const를 enum + type으로 정규화 — foldSchema의 type switch가 처리 가능하게
  if (result.const !== undefined && !result.type && !result.enum) {
    const v = result.const
    result.enum = [v]
    if (typeof v === 'string') result.type = 'string'
    else if (typeof v === 'number') result.type = Number.isInteger(v) ? 'integer' : 'number'
    else if (typeof v === 'boolean') result.type = 'boolean'
  }

  // properties 내부도 재귀 처리
  if (result.properties) {
    const cleaned: Record<string, OasSchema> = {}
    for (const [k, v] of Object.entries(result.properties)) {
      cleaned[k] = stripExamples(v)
    }
    result.properties = cleaned
  }
  if (result.items) result.items = stripExamples(result.items)
  if (result.prefixItems) result.prefixItems = result.prefixItems.map(stripExamples)
  if (result.allOf) result.allOf = result.allOf.map(stripExamples)
  if (result.oneOf) result.oneOf = result.oneOf.map(stripExamples)
  if (result.anyOf) result.anyOf = result.anyOf.map(stripExamples)
  if (result.additionalProperties && typeof result.additionalProperties === 'object') {
    result.additionalProperties = stripExamples(result.additionalProperties)
  }
  if (result.unevaluatedProperties && typeof result.unevaluatedProperties === 'object') {
    result.unevaluatedProperties = stripExamples(result.unevaluatedProperties)
  }
  if (result.then) result.then = stripExamples(result.then)
  if (result.else) result.else = stripExamples(result.else)
  if (result.if) result.if = stripExamples(result.if)

  return result
}

function isNeverSchema(schema: OasSchema | boolean): boolean {
  return typeof schema === 'object'
    && schema !== null
    && typeof schema.not === 'object'
    && schema.not !== null
    && Object.keys(schema.not).length === 0
}

// ─── 헬퍼 ──────────────────────────────────────────────────────────────────

const TYPE_PROJECTION_KEYS = new Set([
  '$ref',
  'type',
  'const',
  'enum',
  'properties',
  'required',
  'items',
  'prefixItems',
  'additionalProperties',
  'unevaluatedProperties',
  'allOf',
  'oneOf',
  'anyOf',
  'if',
  'then',
  'else',
])

function foldCompositionSiblings(
  schema: OasSchema,
  omittedKeys: readonly string[],
  algebra: SchemaAlgebra<string>,
): string | null {
  const omitted = new Set(omittedKeys)
  const siblingEntries = Object.entries(schema).filter(([key]) => !omitted.has(key))
  if (!siblingEntries.some(([key]) => TYPE_PROJECTION_KEYS.has(key))) return null
  const siblings = Object.fromEntries(siblingEntries) as OasSchema
  inferCompositionSiblingType(siblings)
  return foldSchema(siblings, algebra)
}

function inferCompositionSiblingType(schema: OasSchema): void {
  if (schema.type !== undefined) return

  if (schema.items !== undefined || schema.prefixItems !== undefined) {
    schema.type = 'array'
    return
  }

  const hasObjectShape = schema.properties !== undefined
    || schema.required !== undefined
    || schema.additionalProperties !== undefined
    || schema.unevaluatedProperties !== undefined
  if (!hasObjectShape) return

  schema.type = 'object'
  if (!schema.required?.length) return
  const properties = { ...schema.properties }
  for (const propertyName of schema.required) {
    properties[propertyName] ??= {}
  }
  schema.properties = properties
}

function joinIntersection(types: readonly string[], emptyType: string): string {
  const unique = uniqueTypes(types)
  if (unique.length === 0) return emptyType
  if (unique.length === 1) return unique[0]!
  return unique.map(type => `(${type})`).join(' & ')
}

function joinUnion(types: readonly string[], emptyType: string): string {
  const unique = uniqueTypes(types)
  if (unique.length === 0) return emptyType
  if (unique.length === 1) return unique[0]!
  return unique.map(type => type.includes(' & ') ? `(${type})` : type).join(' | ')
}

function uniqueTypes(types: readonly string[]): string[] {
  return [...new Set(types)]
}

function widenIndexSignatureType(
  additionalType: string,
  properties: ReadonlyArray<readonly [string, string]>,
  required: ReadonlySet<string>,
): string {
  if (additionalType === 'unknown') return additionalType

  const compatibleTypes = [additionalType]
  let hasOptionalProperty = false
  for (const [key, type] of properties) {
    compatibleTypes.push(type)
    if (!required.has(key)) hasOptionalProperty = true
  }
  if (hasOptionalProperty) compatibleTypes.push('undefined')
  return joinUnion(compatibleTypes, additionalType)
}

function toArrayType(elementType: string): string {
  return elementType.includes(' | ') || elementType.includes(' & ')
    ? `(${elementType})[]`
    : `${elementType}[]`
}

function literalToTs(value: unknown): string {
  if (typeof value === 'string') {
    return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  }
  if (value === null) return 'null'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  const serialized = JSON.stringify(value)
  return serialized ?? 'unknown'
}

function schemaTypeArrayAccepts(types: string | string[] | undefined, value: unknown): boolean {
  if (!Array.isArray(types)) return true
  return types.some(type => {
    switch (type) {
      case 'array': return Array.isArray(value)
      case 'boolean': return typeof value === 'boolean'
      case 'integer': return typeof value === 'number' && Number.isInteger(value)
      case 'null': return value === null
      case 'number': return typeof value === 'number'
      case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value)
      case 'string': return typeof value === 'string'
      default: return false
    }
  })
}

/** type 배열에 'null'이 포함되면 nullable union 추가 */
function withNullable(s: OasSchema, base: string): string {
  if (Array.isArray(s.type) && s.type.includes('null')) {
    return `${base} | null`
  }
  return base
}

function resolveStringType(s: OasSchema): string {
  if (s.enum) return s.enum.map(v => `'${v}'`).join(' | ')
  if (s.const !== undefined) return `'${s.const}'`
  return 'string'
}

/** 프로퍼티 스키마에서 JSDoc 주석 생성 (description + constraints + deprecated + annotations) */
function buildPropJSDoc(
  ps: (OasSchema & Record<string, unknown>) | undefined,
  includeAnnotations: boolean,
): string {
  if (!ps) return ''
  const tags: string[] = []

  if (ps.description) tags.push(ps.description as string)
  if (ps.deprecated) tags.push('@deprecated')
  if (ps.format) tags.push(`@format ${ps.format}`)
  if (ps.minimum !== undefined) tags.push(`@minimum ${ps.minimum}`)
  if (ps.maximum !== undefined) tags.push(`@maximum ${ps.maximum}`)
  if (ps.exclusiveMinimum !== undefined) tags.push(`@exclusiveMinimum ${ps.exclusiveMinimum}`)
  if (ps.exclusiveMaximum !== undefined) tags.push(`@exclusiveMaximum ${ps.exclusiveMaximum}`)
  if (ps.minLength !== undefined) tags.push(`@minLength ${ps.minLength}`)
  if (ps.maxLength !== undefined) tags.push(`@maxLength ${ps.maxLength}`)
  if (ps.pattern !== undefined) tags.push(`@pattern ${ps.pattern}`)
  if (ps.minItems !== undefined) tags.push(`@minItems ${ps.minItems}`)
  if (ps.maxItems !== undefined) tags.push(`@maxItems ${ps.maxItems}`)

  // annotations (옵션: includeAnnotations)
  if (includeAnnotations && ps.annotations && typeof ps.annotations === 'object') {
    const ann = ps.annotations as Record<string, unknown>
    if (ann.note) tags.push(`@note ${ann.note}`)
    if (ann.see) {
      const sees = Array.isArray(ann.see) ? ann.see : [ann.see]
      for (const s of sees) tags.push(`@see ${s}`)
    }
  }

  if (tags.length === 0) return ''
  if (tags.length === 1) return `  /** ${tags[0]} */\n`
  return `  /**\n${tags.map(t => `   * ${t}`).join('\n')}\n   */\n`
}
