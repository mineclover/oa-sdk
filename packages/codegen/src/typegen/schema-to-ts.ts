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

import { foldSchema, type SchemaAlgebra, type OasSchema } from '@oa-sdk/parser'
import { escapeKey } from '@oa-sdk/core'

export const typescriptAlgebra: SchemaAlgebra<string> = {
  string:  (s) => withNullable(s, resolveStringType(s)),
  integer: (s) => withNullable(s, s.enum
    ? s.enum.map(v => String(v)).join(' | ')
    : 'number'),
  number:  (s) => withNullable(s, s.enum
    ? s.enum.map(v => String(v)).join(' | ')
    : 'number'),
  boolean: (s) => withNullable(s, 'boolean'),
  null:    () => 'null',

  object(s, props) {
    const required = new Set(s.required ?? [])
    const propSchemas = (s.properties ?? {}) as Record<string, OasSchema>
    const fields = Object.entries(props).map(([key, type]) => {
      const opt = required.has(key) ? '' : '?'
      const desc = propSchemas[key]?.description
      const comment = desc ? `  /** ${desc} */\n` : ''
      return `${comment}  ${escapeKey(key)}${opt}: ${type}`
    })

    // additionalProperties handling
    const addProps = s.additionalProperties
    if (addProps === true) {
      if (fields.length === 0) return 'Record<string, unknown>'
      fields.push('  [key: string]: unknown')
    } else if (addProps && typeof addProps === 'object') {
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
export function schemaToTs(schema: OasSchema): string {
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

/** example/default 필드를 재귀적으로 제거 — 타입 정보만 남김 */
function stripExamples(schema: OasSchema): OasSchema {
  const { example, default: def, ...rest } = schema as Record<string, unknown>
  const result = rest as OasSchema

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
  if (result.then) result.then = stripExamples(result.then)
  if (result.else) result.else = stripExamples(result.else)
  if (result.if) result.if = stripExamples(result.if)

  return result
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

