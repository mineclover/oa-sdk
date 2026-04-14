/**
 * JSON Schema 기반 minimal mock 데이터 생성기.
 *
 * foldSchema + SchemaAlgebra 패턴으로 순회와 시맨틱을 분리.
 * mock-server의 generateAlgebra와 동일 아키텍처, typia 고유 동작만 다름:
 *   - enum 처리: leaf 슬롯에서 enum[0] 우선
 *   - allOf: 모든 branch를 object로 merge (mock-server는 branches[0])
 */

import { foldSchema } from '@oa-sdk/parser'
import type { SchemaAlgebra } from '@oa-sdk/parser'

// ─── Algebra ────────────────────────────────────────────────────────────────

/**
 * typia ILlmFunction.output 스키마에서 최솟값을 생성하는 algebra.
 *
 * generateAlgebra (mock-server)와의 차이:
 *   allOf — 모든 branch object merge (typia의 intersection 패턴 반영)
 *   leaf  — enum 존재 시 enum[0] 우선 반환
 */
export const typiaGenerateAlgebra: SchemaAlgebra<unknown> = {
  string: (s) => {
    if (s.enum?.length) return s.enum[0]
    return generateString(s)
  },
  integer: (s) => {
    if (s.enum?.length) return s.enum[0]
    return s.minimum ?? 0
  },
  number: (s) => {
    if (s.enum?.length) return s.enum[0]
    return s.minimum ?? 0
  },
  boolean: (s) => {
    if (s.enum?.length) return s.enum[0]
    return false
  },
  null: () => null,

  object: (schema, properties) => {
    const required = new Set(schema.required ?? [])
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(properties)) {
      if (required.has(k)) result[k] = v
    }
    return result
  },

  array: (schema, items) => {
    const min = schema.minItems ?? 0
    if (min === 0) return []
    return Array.from({ length: min }, () =>
      typeof items === 'object' && items !== null ? structuredClone(items) : items,
    )
  },

  // allOf — 모든 branch를 object로 merge (typia intersection 패턴)
  allOf: (_schema, branches) => {
    const merged: Record<string, unknown> = {}
    for (const b of branches) {
      if (b && typeof b === 'object' && !Array.isArray(b)) {
        Object.assign(merged, b)
      }
    }
    return Object.keys(merged).length > 0 ? merged : (branches[0] ?? null)
  },

  oneOf: (_schema, branches) => branches[0] ?? null,
  anyOf: (_schema, branches) => branches[0] ?? null,

  ref: () => null,
  example: (v) => v,
  default_: (v) => v,
  fallback: () => null,
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * JSON Schema에서 최솟값을 생성한다.
 * foldSchema가 순회를 담당하고, typiaGenerateAlgebra가 시맨틱을 담당.
 */
export function generateFromSchema(schema: Record<string, unknown> | undefined): unknown {
  if (!schema) return undefined
  return foldSchema(schema, typiaGenerateAlgebra)
}

// ─── String format helper ───────────────────────────────────────────────────

function generateString(schema: { format?: string; minLength?: number }): string {
  switch (schema.format) {
    case 'date-time': return new Date(0).toISOString()
    case 'date':      return '1970-01-01'
    case 'time':      return '00:00:00'
    case 'uuid':      return '00000000-0000-0000-0000-000000000000'
    case 'email':     return 'example@example.com'
    case 'uri':
    case 'url':       return 'https://example.com'
    case 'ipv4':      return '0.0.0.0'
    case 'ipv6':      return '::'
  }

  const minLength = schema.minLength ?? 0
  return ''.padStart(minLength, 'x')
}
