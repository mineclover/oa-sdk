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

export const typescriptAlgebra: SchemaAlgebra<string> = {
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
    const fields = Object.entries(props).sort(([left], [right]) => compareTypegenKeys(left, right)).map(([key, type]) => {
      const opt = required.has(key) ? '' : '?'
      const ps = propSchemas[key] as OasSchema & Record<string, unknown> | undefined
      const ro = ps?.readOnly ? 'readonly ' : ''
      const jsdoc = buildPropJSDoc(ps)
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
      const addType = foldSchema(addProps as OasSchema, typescriptAlgebra)
      if (fields.length === 0) return `Record<string, ${addType}>`
      fields.push(`  [key: string]: ${addType}`)
    }

    if (fields.length === 0) return 'Record<string, unknown>'
    return `{\n${fields.join('\n')}\n}`
  },

  array(s, items) {
    // tuple (prefixItems)
    if (s.prefixItems?.length) {
      const prefix = s.prefixItems.map(p => foldSchema(p, typescriptAlgebra))
      if (s.items) {
        return `[${prefix.join(', ')}, ...${items ?? 'unknown'}[]]`
      }
      return `[${prefix.join(', ')}]`
    }
    const inner = items ?? 'unknown'
    // union이면 괄호
    return inner.includes('|') ? `(${inner})[]` : `${inner}[]`
  },

  allOf(_, branches) {
    if (branches.length === 0) return 'unknown'
    if (branches.length === 1) return branches[0]!
    return branches.join(' & ')
  },

  oneOf(_, branches) {
    if (branches.length === 0) return 'never'
    if (branches.length === 1) return branches[0]!
    return branches.join(' | ')
  },

  anyOf(_, branches) {
    if (branches.length === 0) return 'unknown'
    if (branches.length === 1) return branches[0]!
    return branches.join(' | ')
  },

  ref(r) {
    const override = _options.refNameOverrides?.[r]
    if (override) return override
    // #/components/schemas/User → User
    const name = r.split('/').pop()
    return name ?? 'unknown'
  },

  example() { return 'unknown' },
  default_() { return 'unknown' },
  fallback() { return 'unknown' },
}

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

/** 현재 변환 옵션 — createTypescriptAlgebra에서 설정 */
let _options: SchemaToTsOptions = {}

export function schemaToTs(schema: OasSchema, options?: SchemaToTsOptions): string {
  _options = options ?? {}
  // example/default 제거 — 타입 생성에서는 타입 정보만 사용
  const clean = stripExamples(schema)

  // type 배열 (nullable 등): ['string', 'null'] → string | null
  if (Array.isArray(clean.type)) {
    const types = clean.type.map(t => {
      if (t === 'null') return 'null'
      return foldSchema({ ...clean, type: t }, typescriptAlgebra)
    })
    return types.join(' | ')
  }

  // enum
  if (clean.enum) {
    return clean.enum.map(v => typeof v === 'string' ? `'${v}'` : String(v)).join(' | ')
  }
  // const
  if (clean.const !== undefined) {
    return typeof clean.const === 'string' ? `'${clean.const}'` : String(clean.const)
  }

  return foldSchema(clean, typescriptAlgebra)
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
function buildPropJSDoc(ps: (OasSchema & Record<string, unknown>) | undefined): string {
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
  if (_options.includeAnnotations && ps.annotations && typeof ps.annotations === 'object') {
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
