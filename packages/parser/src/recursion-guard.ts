/**
 * Recursion guard — 순환 $ref가 유효한 재귀 스키마인지 판정한다.
 *
 * JSON Schema 재귀는 순환 경로가 instance 하위 값으로 내려가는 키워드
 * (`properties`, `items`, `additionalProperties` 등)를 한 번 이상 지날 때 유한하다.
 * 그런 순환(트리, 연결 리스트, JSON 값 타입)은 유효한 계약이므로 허용한다.
 *
 * 반대로 별칭만으로 된 순환(`A: {$ref: B}`, `B: {$ref: A}`)이나 같은 instance를
 * 다시 평가하는 키워드(`allOf`/`anyOf`/`oneOf`/`not`/`if`/`then`/`else`/
 * `dependentSchemas`)만 지나는 순환은 진전이 없으므로 진단 대상이다.
 *
 * 순회 중 키의 의미는 문맥에 따라 다르다. `properties` 아래의 키는 속성 이름이고,
 * `examples` 아래는 스키마가 아닌 데이터다. `SchemaPathContext`가 이 문맥을 추적한다.
 */

/** instance의 하위 값(속성 값, 배열 요소, 속성 이름, 디코딩된 내용)에 적용되는 키워드. */
const INSTANCE_DESCENDING_KEYWORDS: ReadonlySet<string> = new Set([
  'properties',
  'patternProperties',
  'additionalProperties',
  'unevaluatedProperties',
  'propertyNames',
  'items',
  'prefixItems',
  'additionalItems',
  'unevaluatedItems',
  'contains',
  'contentSchema',
])

/** 값이 `이름 → 스키마` 맵인 키워드. 다음 단계의 키는 키워드가 아니라 이름이다. */
const NAME_MAP_KEYWORDS: ReadonlySet<string> = new Set([
  'properties',
  'patternProperties',
  'dependentSchemas',
  '$defs',
  'definitions',
])

/** 값이 스키마가 아닌 데이터인 키워드. 그 아래의 키는 의미를 갖지 않는다. */
const OPAQUE_VALUE_KEYWORDS: ReadonlySet<string> = new Set([
  'const',
  'default',
  'enum',
  'example',
  'examples',
])

export type SchemaPathContext = 'keyword' | 'name' | 'opaque'

export type SchemaPathStep = {
  /** 이 키를 지나면 instance 하위 값으로 내려가는지 여부 */
  descends: boolean
  /** 이 키의 값 안에서 키를 해석할 문맥 */
  context: SchemaPathContext
}

/** `context` 문맥에서 `key`를 한 단계 지날 때의 결과. 배열 인덱스는 문맥을 바꾸지 않는다. */
export function stepSchemaPath(context: SchemaPathContext, key: string): SchemaPathStep {
  if (context === 'opaque') return { descends: false, context: 'opaque' }
  if (context === 'name') return { descends: false, context: 'keyword' }
  return {
    descends: INSTANCE_DESCENDING_KEYWORDS.has(key),
    context: NAME_MAP_KEYWORDS.has(key)
      ? 'name'
      : OPAQUE_VALUE_KEYWORDS.has(key) ? 'opaque' : 'keyword',
  }
}

/**
 * 스키마 루트에서 시작하는 JSON Pointer 경로 세그먼트가 instance 하위로 내려가는 횟수.
 * 키워드 문맥의 숫자 세그먼트는 배열 인덱스이므로 문맥을 바꾸지 않는다
 * (이름 문맥의 `"0"`은 속성 이름이다).
 */
export function countInstanceDescents(segments: readonly string[]): number {
  let context: SchemaPathContext = 'keyword'
  let descents = 0
  for (const segment of segments) {
    if (context === 'keyword' && isArrayIndex(segment)) continue
    const step = stepSchemaPath(context, segment)
    if (step.descends) descents += 1
    context = step.context
  }
  return descents
}

function isArrayIndex(segment: string): boolean {
  return /^(0|[1-9]\d*)$/.test(segment)
}
