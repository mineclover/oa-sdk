import type { OasSchema } from '@oa-sdk/parser/browser'
import { schemaToTs, type SchemaToTsOptions } from './schema-to-ts.js'

/** TypeScript 정적 타입이 JSON Schema 의미를 보존하는 정도. */
export type TypegenFidelity =
  | 'exact'
  | 'runtime-only'
  | 'safe-widening'
  | 'unsafe-narrowing'
  | 'unsupported'

export type TypegenFidelityDiagnosticCode =
  | 'typegen/conditional-narrowed'
  | 'typegen/conditional-widened'
  | 'typegen/index-signature-widened'
  | 'typegen/one-of-exclusivity-widened'
  | 'typegen/prefix-items-narrowed'
  | 'typegen/ref-siblings-widened'
  | 'typegen/runtime-constraint'
  | 'typegen/unknown-type'
  | 'typegen/unsupported-keyword'

export type TypegenFidelityDiagnostic = {
  code: TypegenFidelityDiagnosticCode
  fidelity: Exclude<TypegenFidelity, 'exact'>
  severity: 'info' | 'warning' | 'error'
  /** 진단 대상 JSON Schema keyword. */
  keyword: string
  /** 입력 schema 루트를 기준으로 한 RFC 6901 JSON Pointer. */
  pointer: string
  message: string
}

export type TypegenFidelityAnalysis = {
  fidelity: TypegenFidelity
  diagnostics: readonly TypegenFidelityDiagnostic[]
}

export type SchemaToTsProjection = TypegenFidelityAnalysis & {
  type: string
}

const FIDELITY_RANK: Record<TypegenFidelity, number> = {
  exact: 0,
  'runtime-only': 1,
  'safe-widening': 2,
  'unsafe-narrowing': 3,
  unsupported: 4,
}

const RUNTIME_ONLY_KEYWORDS = new Set([
  'contains',
  'contentEncoding',
  'contentMediaType',
  'contentSchema',
  'dependentRequired',
  'dependentSchemas',
  'exclusiveMaximum',
  'exclusiveMinimum',
  'format',
  'maxContains',
  'maxItems',
  'maxLength',
  'maxProperties',
  'maximum',
  'minContains',
  'minItems',
  'minLength',
  'minProperties',
  'minimum',
  'multipleOf',
  'not',
  'pattern',
  'patternProperties',
  'propertyNames',
  'unevaluatedItems',
  'uniqueItems',
  'writeOnly',
])

const UNSUPPORTED_KEYWORDS = new Set([
  '$dynamicRef',
])

const SUPPORTED_TYPES = new Set([
  'array',
  'boolean',
  'integer',
  'null',
  'number',
  'object',
  'string',
])

const REF_ANNOTATION_KEYS = new Set([
  '$comment',
  '$id',
  '$schema',
  'deprecated',
  'description',
  'example',
  'examples',
  'externalDocs',
  'readOnly',
  'title',
  'writeOnly',
  'xml',
])

/**
 * TypeScript 투영 결과와 손실 진단을 함께 반환한다.
 *
 * `schemaToTs()`는 문자열 호환 API로 유지되며, 정책/CI 소비자는 이 API의
 * 구조화된 fidelity를 사용해 unsafe narrowing과 unsupported 의미를 차단한다.
 */
export function projectSchemaToTs(
  schema: OasSchema,
  options?: SchemaToTsOptions,
): SchemaToTsProjection {
  return {
    type: schemaToTs(schema, options),
    ...analyzeSchemaFidelity(schema),
  }
}

/** JSON Schema keyword를 TypeScript가 정적으로 보존하는 정도를 분석한다. */
export function analyzeSchemaFidelity(schema: OasSchema): TypegenFidelityAnalysis {
  const diagnostics: TypegenFidelityDiagnostic[] = []
  visitSchema(schema, '', diagnostics, new WeakSet<object>())
  diagnostics.sort(compareDiagnostics)

  let fidelity: TypegenFidelity = 'exact'
  for (const diagnostic of diagnostics) {
    if (FIDELITY_RANK[diagnostic.fidelity] > FIDELITY_RANK[fidelity]) {
      fidelity = diagnostic.fidelity
    }
  }

  return { fidelity, diagnostics }
}

function visitSchema(
  schema: OasSchema,
  pointer: string,
  diagnostics: TypegenFidelityDiagnostic[],
  seen: WeakSet<object>,
): void {
  if (seen.has(schema)) return
  seen.add(schema)
  const hasRef = typeof schema.$ref === 'string'

  if (!hasRef && (schema.oneOf?.length ?? 0) > 1) {
    diagnostics.push(createDiagnostic({
      code: 'typegen/one-of-exclusivity-widened',
      fidelity: 'safe-widening',
      keyword: 'oneOf',
      pointer: childPointer(pointer, 'oneOf'),
      message: 'TypeScript union은 JSON Schema oneOf의 단일 브랜치 일치 조건을 표현하지 않습니다.',
    }))
  }

  if (!hasRef && (schema.then !== undefined || schema.else !== undefined)) {
    const hasBothBranches = schema.if !== undefined
      && schema.then !== undefined
      && schema.else !== undefined
    diagnostics.push(createDiagnostic({
      code: hasBothBranches ? 'typegen/conditional-widened' : 'typegen/conditional-narrowed',
      fidelity: hasBothBranches ? 'safe-widening' : 'unsafe-narrowing',
      keyword: 'if',
      pointer: childPointer(pointer, 'if'),
      message: hasBothBranches
        ? 'TypeScript union은 if 조건과 then/else 브랜치의 상관관계를 보존하지 않습니다.'
        : '단일 conditional 브랜치 투영은 조건을 만족하지 않는 유효한 값을 제외할 수 있습니다.',
    }))
  }

  const additionalKeyword = schema.additionalProperties !== undefined
    ? 'additionalProperties'
    : schema.unevaluatedProperties !== undefined
      ? 'unevaluatedProperties'
      : null
  const additionalSchema = additionalKeyword
    ? schema[additionalKeyword]
    : undefined
  if (
    additionalKeyword
    && !hasRef
    && additionalSchema !== true
    && additionalSchema !== false
    && additionalSchema !== undefined
    && !isNeverSchema(additionalSchema)
    && Object.keys(schema.properties ?? {}).length > 0
    && requiresIndexSignatureWidening(schema, additionalSchema)
  ) {
    diagnostics.push(createDiagnostic({
      code: 'typegen/index-signature-widened',
      fidelity: 'safe-widening',
      keyword: additionalKeyword,
      pointer: childPointer(pointer, additionalKeyword),
      message: 'TypeScript index signature 호환성을 위해 고정 속성 타입이 추가 속성 타입에 합쳐졌습니다.',
    }))
  }

  if (!hasRef && schema.prefixItems?.length && schema.items === undefined) {
    diagnostics.push(createDiagnostic({
      code: 'typegen/prefix-items-narrowed',
      fidelity: 'unsafe-narrowing',
      keyword: 'prefixItems',
      pointer: childPointer(pointer, 'prefixItems'),
      message: 'items가 생략된 prefixItems는 추가 원소를 허용하지만 현재 TypeScript 투영은 고정 tuple입니다.',
    }))
  }

  if (hasRef) {
    const semanticSiblings = Object.keys(schema).filter(key => key !== '$ref' && !REF_ANNOTATION_KEYS.has(key))
    if (semanticSiblings.length > 0) {
      diagnostics.push(createDiagnostic({
        code: 'typegen/ref-siblings-widened',
        fidelity: 'safe-widening',
        keyword: '$ref',
        pointer: childPointer(pointer, '$ref'),
        message: `\$ref와 함께 선언된 제약(${semanticSiblings.sort().join(', ')})은 TypeScript 참조 이름에 반영되지 않습니다.`,
      }))
    }
  }

  for (const [keyword, value] of Object.entries(schema).sort(([left], [right]) => compareText(left, right))) {
    if (value === undefined) continue
    if (RUNTIME_ONLY_KEYWORDS.has(keyword) && !(keyword === 'not' && isEmptyObject(value))) {
      diagnostics.push(createDiagnostic({
        code: 'typegen/runtime-constraint',
        fidelity: 'runtime-only',
        keyword,
        pointer: childPointer(pointer, keyword),
        message: `JSON Schema ${keyword} 제약은 생성된 TypeScript 타입이 아닌 런타임 검증에서 적용됩니다.`,
      }))
    } else if (UNSUPPORTED_KEYWORDS.has(keyword)) {
      diagnostics.push(createDiagnostic({
        code: 'typegen/unsupported-keyword',
        fidelity: 'unsupported',
        keyword,
        pointer: childPointer(pointer, keyword),
        message: `JSON Schema ${keyword} 키워드는 현재 TypeScript 투영에서 지원되지 않습니다.`,
      }))
    }
  }

  const schemaTypes = Array.isArray(schema.type)
    ? schema.type
    : schema.type === undefined
      ? []
      : [schema.type]
  for (const [index, schemaType] of schemaTypes.entries()) {
    if (SUPPORTED_TYPES.has(schemaType)) continue
    diagnostics.push(createDiagnostic({
      code: 'typegen/unknown-type',
      fidelity: 'unsupported',
      keyword: 'type',
      pointer: Array.isArray(schema.type)
        ? childPointer(childPointer(pointer, 'type'), index)
        : childPointer(pointer, 'type'),
      message: `JSON Schema type ${JSON.stringify(schemaType)}은 현재 TypeScript algebra에서 지원되지 않습니다.`,
    }))
  }

  visitSchemaMap(schema.properties, childPointer(pointer, 'properties'), diagnostics, seen)
  visitSchemaMap(schema.patternProperties, childPointer(pointer, 'patternProperties'), diagnostics, seen)
  visitSchemaMap(schema.dependentSchemas, childPointer(pointer, 'dependentSchemas'), diagnostics, seen)
  visitSchemaArray(schema.prefixItems, childPointer(pointer, 'prefixItems'), diagnostics, seen)
  visitSchemaArray(schema.allOf, childPointer(pointer, 'allOf'), diagnostics, seen)
  visitSchemaArray(schema.oneOf, childPointer(pointer, 'oneOf'), diagnostics, seen)
  visitSchemaArray(schema.anyOf, childPointer(pointer, 'anyOf'), diagnostics, seen)

  visitChildSchema(schema.items, childPointer(pointer, 'items'), diagnostics, seen)
  visitChildSchema(schema.contains, childPointer(pointer, 'contains'), diagnostics, seen)
  visitChildSchema(schema.contentSchema, childPointer(pointer, 'contentSchema'), diagnostics, seen)
  visitChildSchema(schema.propertyNames, childPointer(pointer, 'propertyNames'), diagnostics, seen)
  visitChildSchema(schema.not, childPointer(pointer, 'not'), diagnostics, seen)
  visitChildSchema(schema.if, childPointer(pointer, 'if'), diagnostics, seen)
  visitChildSchema(schema.then, childPointer(pointer, 'then'), diagnostics, seen)
  visitChildSchema(schema.else, childPointer(pointer, 'else'), diagnostics, seen)
  if (additionalSchema && typeof additionalSchema === 'object') {
    visitSchema(additionalSchema, childPointer(pointer, additionalKeyword!), diagnostics, seen)
  }
  if (schema.unevaluatedItems && typeof schema.unevaluatedItems === 'object') {
    visitSchema(schema.unevaluatedItems, childPointer(pointer, 'unevaluatedItems'), diagnostics, seen)
  }

  seen.delete(schema)
}

function visitSchemaMap(
  schemas: Record<string, OasSchema> | undefined,
  pointer: string,
  diagnostics: TypegenFidelityDiagnostic[],
  seen: WeakSet<object>,
): void {
  for (const [name, schema] of Object.entries(schemas ?? {}).sort(([left], [right]) => compareText(left, right))) {
    visitSchema(schema, childPointer(pointer, name), diagnostics, seen)
  }
}

function visitSchemaArray(
  schemas: OasSchema[] | undefined,
  pointer: string,
  diagnostics: TypegenFidelityDiagnostic[],
  seen: WeakSet<object>,
): void {
  schemas?.forEach((schema, index) => visitSchema(schema, childPointer(pointer, index), diagnostics, seen))
}

function visitChildSchema(
  schema: OasSchema | undefined,
  pointer: string,
  diagnostics: TypegenFidelityDiagnostic[],
  seen: WeakSet<object>,
): void {
  if (schema) visitSchema(schema, pointer, diagnostics, seen)
}

function createDiagnostic(
  diagnostic: Omit<TypegenFidelityDiagnostic, 'severity'>,
): TypegenFidelityDiagnostic {
  return {
    ...diagnostic,
    severity: diagnostic.fidelity === 'runtime-only'
      ? 'info'
      : diagnostic.fidelity === 'safe-widening'
        ? 'warning'
        : 'error',
  }
}

function compareDiagnostics(left: TypegenFidelityDiagnostic, right: TypegenFidelityDiagnostic): number {
  return compareText(left.pointer, right.pointer)
    || compareText(left.code, right.code)
    || compareText(left.keyword, right.keyword)
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function childPointer(pointer: string, segment: string | number): string {
  const escaped = String(segment).replace(/~/g, '~0').replace(/\//g, '~1')
  return `${pointer}/${escaped}`
}

function isNeverSchema(schema: OasSchema): boolean {
  return isEmptyObject(schema.not)
}

function requiresIndexSignatureWidening(schema: OasSchema, additionalSchema: OasSchema): boolean {
  const additionalType = schemaToTs(additionalSchema)
  if (additionalType === 'unknown') return false

  const required = new Set(schema.required ?? [])
  return Object.entries(schema.properties ?? {}).some(([name, propertySchema]) => {
    return !required.has(name) || schemaToTs(propertySchema) !== additionalType
  })
}

function isEmptyObject(value: unknown): boolean {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === 0
}
