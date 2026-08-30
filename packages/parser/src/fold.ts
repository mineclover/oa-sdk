import type { OasSchema as SchemaObject } from './oas32-types.js'
import { createSafeRecord, getOwnString } from './safe-record.js'

/**
 * SchemaAlgebra<T> — 스키마 시맨틱 해석기 인터페이스.
 *
 * foldSchema()가 순회를 담당하고,
 * SchemaAlgebra가 각 노드에서 T를 만드는 방법을 정의.
 *
 * 용도에 따라 T를 교체:
 *   SchemaAlgebra<unknown>      → 값 생성 (GenerateFolder)
 *   SchemaAlgebra<SchemaObject> → 스키마 변환
 *   SchemaAlgebra<string>       → 문서화, 직렬화 등
 */
export type SchemaAlgebra<T> = {
  // ─── 리프 타입 ────────────────────────────────────────────────────────────
  string(schema: SchemaObject): T
  integer(schema: SchemaObject): T
  number(schema: SchemaObject): T
  boolean(schema: SchemaObject): T
  null(schema: SchemaObject): T

  // ─── 복합 타입 (자식이 미리 fold됨) ──────────────────────────────────────
  object(schema: SchemaObject, properties: Record<string, T>): T
  array(schema: SchemaObject, items: T | null): T

  // ─── 조합 스키마 (모든 브랜치를 fold하여 배열로 전달) ────────────────────
  allOf(schema: SchemaObject, branches: T[]): T
  oneOf(schema: SchemaObject, branches: T[]): T
  anyOf(schema: SchemaObject, branches: T[]): T

  /**
   * JSON Schema `type` 배열을 모든 멤버의 fold 결과로 해석한다.
   *
   * 기존 algebra의 첫 타입 선택 동작을 유지하기 위해 optional이다.
   * 구현한 algebra만 중첩 위치를 포함한 일반 type union을 받는다.
   */
  typeUnion?(schema: SchemaObject, branches: T[]): T

  // ─── 특수 노드 ────────────────────────────────────────────────────────────
  /** JSON Schema const 값 — 구현한 algebra에서는 다른 생성 힌트보다 우선 */
  const_?(value: unknown): T
  /** $ref 노드 — algebra가 자체적으로 해석하거나 무시 */
  ref(ref: string): T
  /** schema.example 값이 존재할 때 — 타입 해석보다 우선 */
  example(value: unknown): T
  /** schema.default 값이 존재할 때 — example 없을 때 사용 */
  default_(value: unknown): T
  /** 알 수 없는 노드 (null, 배열, 비객체 입력 등) */
  fallback(node: unknown): T
}

/**
 * foldSchema — 스키마 노드를 순회하여 T를 생성.
 *
 * 순회(traversal)와 의미(semantics) 분리:
 *   - foldSchema: 타입 분기·자식 재귀 전담
 *   - algebra:    각 노드에서 T를 만드는 방법 전담
 *
 * 동일한 algebra 객체를 재사용할 수 있어,
 * 파일 시스템 트리·AST 등 다른 구조에도 동일 패턴 적용 가능.
 */
export function foldSchema<T>(node: unknown, algebra: SchemaAlgebra<T>): T {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    return algebra.fallback(node)
  }

  const schema = node as SchemaObject & Record<string, unknown>

  if (Object.hasOwn(schema, 'const') && algebra.const_) {
    return algebra.const_(schema.const)
  }

  // $ref 노드 — algebra가 해석 책임
  const ref = getOwnString(schema, '$ref')
  if (ref !== undefined) {
    return algebra.ref(ref)
  }

  // example / default 우선
  if (schema.example !== undefined) return algebra.example(schema.example)
  if (schema.default !== undefined) return algebra.default_(schema.default)

  // 조합 스키마 — 첫 번째 브랜치 fold 후 전달
  if (schema.allOf?.length) {
    return algebra.allOf(schema, schema.allOf.map(s => foldSchema(s, algebra)))
  }
  if (schema.oneOf?.length) {
    return algebra.oneOf(schema, schema.oneOf.map(s => foldSchema(s, algebra)))
  }
  if (schema.anyOf?.length) {
    return algebra.anyOf(schema, schema.anyOf.map(s => foldSchema(s, algebra)))
  }

  // if/then/else — 조건 스키마를 anyOf로 매핑
  if (schema.then || schema.else) {
    const branches: T[] = []
    if (schema.then) branches.push(foldSchema(schema.then, algebra))
    if (schema.else) branches.push(foldSchema(schema.else, algebra))
    if (branches.length > 0) return algebra.anyOf(schema, branches)
  }

  if (Array.isArray(schema.type) && algebra.typeUnion) {
    const branches = schema.type.map(type => foldSchema({ ...schema, type }, algebra))
    return algebra.typeUnion(schema, branches)
  }

  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type

  switch (type) {
    case 'object': {
      const props = (schema.properties ?? {}) as Record<string, SchemaObject>
      const foldedProps = createSafeRecord<T>()
      for (const [k, v] of Object.entries(props)) {
        foldedProps[k] = foldSchema(v, algebra)
      }
      return algebra.object(schema, foldedProps)
    }
    case 'array': {
      const items = schema.items ? foldSchema(schema.items as SchemaObject, algebra) : null
      return algebra.array(schema, items)
    }
    case 'string':  return algebra.string(schema)
    case 'integer': return algebra.integer(schema)
    case 'number':  return algebra.number(schema)
    case 'boolean': return algebra.boolean(schema)
    case 'null':    return algebra.null(schema)
    default: {
      // type 미지정이지만 properties 존재 → object로 취급
      if (schema.properties && typeof schema.properties === 'object') {
        const props = schema.properties as Record<string, SchemaObject>
        const foldedProps = createSafeRecord<T>()
        for (const [k, v] of Object.entries(props)) {
          foldedProps[k] = foldSchema(v, algebra)
        }
        return algebra.object(schema, foldedProps)
      }
      return algebra.fallback(node)
    }
  }
}
