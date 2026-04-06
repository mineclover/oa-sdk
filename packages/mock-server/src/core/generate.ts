import type { OasSchema } from '@oa-sdk/parser'
import type { SchemaAlgebra } from '@oa-sdk/parser'
import { foldSchema } from '@oa-sdk/parser'

// ─── 문자열 포맷 생성 (내부 헬퍼) ────────────────────────────────────────────

function generateString(schema: OasSchema): string {
  if (schema.enum?.length) return String(schema.enum[0])

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

  const min = schema.minLength ?? 0
  return ''.padStart(min, 'x')
}

// ─── generateAlgebra ─────────────────────────────────────────────────────────

/**
 * 스키마를 만족하는 최솟값을 생성하는 algebra.
 *
 * GenerateFolder 없이 직접 사용 가능:
 *   foldSchema(schema, generateAlgebra)
 *
 * 커스텀 algebra도 spread로 조합 가능:
 *   const myAlgebra = { ...generateAlgebra, string: (s) => 'custom' }
 */
export const generateAlgebra: SchemaAlgebra<unknown> = {
  string:  (s) => generateString(s),
  integer: (s) => s.minimum ?? 0,
  number:  (s) => s.minimum ?? 0,
  boolean: () => false,
  null:    () => null,

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
      typeof items === 'object' && items !== null ? structuredClone(items) : items
    )
  },

  allOf:    (_, branches) => branches[0] ?? null,
  oneOf:    (_, branches) => branches[0] ?? null,
  anyOf:    (_, branches) => branches[0] ?? null,
  ref:      () => null,
  example:  (v) => v,
  default_: (v) => v,
  fallback: () => null,
}

// ─── GenerateFolder ───────────────────────────────────────────────────────────

/**
 * GenerateFolder — 클래스 기반 확장 래퍼.
 *
 * foldSchema + generateAlgebra를 직접 사용해도 되지만,
 * 메서드 오버라이드로 커스터마이징이 필요한 경우 이 클래스를 확장.
 *
 * @example 문자열 포맷 커스터마이징
 * class PrefixFolder extends GenerateFolder {
 *   protected override generateString(schema: OasSchema): string {
 *     return 'PREFIX_' + super.generateString(schema)
 *   }
 * }
 *
 * @example 고급 커스터마이징 — algebra 전체 교체
 * class CustomFolder extends GenerateFolder {
 *   protected override algebra(): SchemaAlgebra<unknown> {
 *     return { ...super.algebra(), integer: (s) => s.maximum ?? 100 }
 *   }
 * }
 */
export class GenerateFolder {
  fold(node: unknown): unknown {
    return foldSchema(node, this.algebra())
  }

  /** 사용할 algebra 반환. 서브클래스에서 오버라이드 가능. */
  protected algebra(): SchemaAlgebra<unknown> {
    return {
      ...generateAlgebra,
      string: (s) => this.generateString(s),
    }
  }

  /** 문자열 타입 처리. 서브클래스에서 오버라이드 가능. */
  protected generateString(schema: OasSchema): string {
    return generateString(schema)
  }
}

/** GenerateFolder 싱글턴 — 상태가 없으므로 공유 사용 가능 */
export const generator = new GenerateFolder()
