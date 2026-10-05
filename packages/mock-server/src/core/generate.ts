import type { OasSchema } from '@oa-sdk/parser/browser'
import type { SchemaAlgebra } from '@oa-sdk/parser/browser'
import { foldSchema } from '@oa-sdk/parser/browser'

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

  allOf: (_, branches) => {
    const merged: Record<string, unknown> = {}
    for (const b of branches) {
      if (b && typeof b === 'object' && !Array.isArray(b)) Object.assign(merged, b)
    }
    return Object.keys(merged).length > 0 ? merged : (branches[0] ?? null)
  },
  oneOf:    (_, branches) => branches[0] ?? null,
  anyOf:    (_, branches) => branches[0] ?? null,
  const_:   (value) => value,
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
  /**
   * 스키마를 fold하여 값을 생성.
   *
   * 내장 object 핸들러(`generateAlgebra.object`)는 required 속성만 남기므로,
   * 그 핸들러를 쓰는 동안에는 선택 속성을 fold하지 않는다 — 생성 결과는
   * `foldSchema(node, algebra)`와 같고 버려질 하위 트리 순회만 생략된다.
   * object 핸들러를 교체한 algebra는 기존처럼 모든 속성의 fold 결과를 받는다.
   */
  fold(node: unknown): unknown {
    const algebra = this.algebra()
    return algebra.object === generateAlgebra.object
      ? foldRequiredProperties(node, algebra)
      : foldSchema(node, algebra)
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

// ─── required 속성만 순회하는 fold ───────────────────────────────────────────

/**
 * `foldSchema`(@oa-sdk/parser)와 같은 순서·같은 분기로 노드를 해석하되,
 * object 노드에서는 `required`에 포함된 속성만 fold하여 algebra.object에 넘긴다.
 *
 * 속성 순서와 나머지 분기(const → $ref → example → default → allOf/oneOf/anyOf
 * → then/else → type 배열 → type)는 foldSchema를 그대로 따른다. 두 함수의 결과가
 * 같다는 것은 generate.test.ts가 fixture 스키마 전체로 검증한다.
 */
function foldRequiredProperties(node: unknown, algebra: SchemaAlgebra<unknown>): unknown {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    return algebra.fallback(node)
  }

  const schema = node as OasSchema & Record<string, unknown>

  if (Object.hasOwn(schema, 'const') && algebra.const_) {
    return algebra.const_(schema.const)
  }

  const ref = Object.hasOwn(schema, '$ref') ? schema.$ref : undefined
  if (typeof ref === 'string') return algebra.ref(ref)

  if (schema.example !== undefined) return algebra.example(schema.example)
  if (schema.default !== undefined) return algebra.default_(schema.default)

  if (schema.allOf?.length) {
    return algebra.allOf(schema, schema.allOf.map(s => foldRequiredProperties(s, algebra)))
  }
  if (schema.oneOf?.length) {
    return algebra.oneOf(schema, schema.oneOf.map(s => foldRequiredProperties(s, algebra)))
  }
  if (schema.anyOf?.length) {
    return algebra.anyOf(schema, schema.anyOf.map(s => foldRequiredProperties(s, algebra)))
  }

  if (schema.then || schema.else) {
    const branches: unknown[] = []
    if (schema.then) branches.push(foldRequiredProperties(schema.then, algebra))
    if (schema.else) branches.push(foldRequiredProperties(schema.else, algebra))
    if (branches.length > 0) return algebra.anyOf(schema, branches)
  }

  if (Array.isArray(schema.type) && algebra.typeUnion) {
    const branches = schema.type.map(type => foldRequiredProperties({ ...schema, type }, algebra))
    return algebra.typeUnion(schema, branches)
  }

  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type

  switch (type) {
    case 'object':
      return algebra.object(schema, foldRequiredPropertyValues(schema, algebra))
    case 'array': {
      const items = schema.items ? foldRequiredProperties(schema.items, algebra) : null
      return algebra.array(schema, items)
    }
    case 'string':  return algebra.string(schema)
    case 'integer': return algebra.integer(schema)
    case 'number':  return algebra.number(schema)
    case 'boolean': return algebra.boolean(schema)
    case 'null':    return algebra.null(schema)
    default:
      // type 미지정이지만 properties 존재 → object로 취급
      if (schema.properties && typeof schema.properties === 'object') {
        return algebra.object(schema, foldRequiredPropertyValues(schema, algebra))
      }
      return algebra.fallback(node)
  }
}

/** 선언 순서를 유지하며 required 속성의 fold 결과만 담은 레코드. */
function foldRequiredPropertyValues(
  schema: OasSchema,
  algebra: SchemaAlgebra<unknown>,
): Record<string, unknown> {
  const required = new Set(schema.required ?? [])
  const folded = Object.create(null) as Record<string, unknown>
  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    if (required.has(name)) folded[name] = foldRequiredProperties(property, algebra)
  }
  return folded
}
