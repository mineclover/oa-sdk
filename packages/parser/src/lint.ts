/**
 * OAS 3.2 자체 린터
 *
 * Redocly/Spectral이 3.2를 지원하지 않으므로 자체 구조 검증.
 * parseDocument() 결과가 아닌 원본 문서를 검증합니다.
 *
 * 검증 카테고리:
 *   - structure: 필수 필드 존재 (openapi, info.title, info.version)
 *   - operations: operationId 고유성, responses 존재
 *   - parameters: in 값 유효성, required path params
 *   - refs: $ref 형식 유효성, 참조 대상 존재
 *   - security: securitySchemes 참조 유효성
 *   - style: description 존재, operationId 규칙
 */

import type { OasDocument, OasPathItem, OasOperation, OasParameter } from './oas32-types.js'
import { resolvePointer, resolveRefGraph, type RefGraphDiagnostic, type RefGraphOptions } from './ref-graph.js'

function isRef(node: unknown): node is { $ref: string } {
  return isRecord(node)
    && Object.prototype.hasOwnProperty.call(node, '$ref')
    && typeof node.$ref === 'string'
}

function isRecord(node: unknown): node is Record<string, unknown> {
  return typeof node === 'object' && node !== null && !Array.isArray(node)
}

export type LintSeverity = 'error' | 'warning' | 'info'

export type LintResult = {
  path: string
  severity: LintSeverity
  rule: string
  message: string
  source?: {
    sourceFilePath?: string
    sourcePointer?: string
    filePath?: string
    pointer?: string
    line?: number
    column?: number
  }
}

export type LintOptions = {
  /** 실행할 규칙 카테고리 (기본: 전체) */
  categories?: Array<'structure' | 'operations' | 'parameters' | 'refs' | 'security' | 'style' | 'components'>
  /** OAS 파일 경로. 상대 외부 $ref 해소 진단에 사용 */
  basePath?: string
  /** file + JSON Pointer를 YAML line/column으로 보강하는 lookup */
  lookupSourceLocation?: (filePath: string, pointer: string) => { line: number; column: number } | undefined
}

/**
 * OAS 3.2 문서를 린트합니다.
 */
export function lintDocument(doc: unknown, options: LintOptions = {}): LintResult[] {
  if (!doc || typeof doc !== 'object') {
    return [{ path: '/', severity: 'error', rule: 'structure/valid-document', message: '유효한 객체가 아닙니다' }]
  }

  const spec = doc as OasDocument
  const results: LintResult[] = []
  const categories = new Set(options.categories ?? ['structure', 'operations', 'parameters', 'refs', 'security', 'style', 'components'])

  if (categories.has('structure')) lintStructure(spec, results)
  if (categories.has('operations')) lintOperations(spec, results)
  if (categories.has('parameters')) lintParameters(spec, results)
  if (categories.has('refs')) {
    lintRefs(spec, results)
    lintDerefDiagnostics(spec, results, options)
  }
  if (categories.has('security')) lintSecurity(spec, results)
  if (categories.has('style')) lintStyle(spec, results)
  if (categories.has('components')) lintComponents(spec, results)

  return results.map(result => attachLintSource(result, options))
}

function lintDerefDiagnostics(spec: OasDocument, results: LintResult[], options: LintOptions) {
  const refGraphOptions: RefGraphOptions = {}
  if (options.basePath) refGraphOptions.basePath = options.basePath
  if (options.lookupSourceLocation) refGraphOptions.lookupSourceLocation = options.lookupSourceLocation
  const { diagnostics } = resolveRefGraph(spec, refGraphOptions)
  for (const diagnostic of diagnostics) {
    if (diagnostic.code === 'ref-not-found' && diagnostic.ref.startsWith('#/')) continue
    if (diagnostic.code === 'unsupported-ref' && !options.basePath) continue
    results.push(diagnosticToLintResult(diagnostic))
  }
}

function diagnosticToLintResult(diagnostic: RefGraphDiagnostic): LintResult {
  const result: LintResult = {
    path: diagnostic.pointer ?? diagnostic.ref,
    severity: 'error',
    rule: diagnostic.code === 'ref-cycle' ? 'refs/cycle' : 'refs/valid-ref',
    message: diagnostic.message,
  }
  if (diagnostic.sourceFilePath || diagnostic.sourcePointer || diagnostic.filePath || diagnostic.pointer) {
    result.source = {}
    if (diagnostic.sourceFilePath) result.source.sourceFilePath = diagnostic.sourceFilePath
    if (diagnostic.sourcePointer) result.source.sourcePointer = diagnostic.sourcePointer
    if (diagnostic.filePath) result.source.filePath = diagnostic.filePath
    if (diagnostic.pointer) result.source.pointer = diagnostic.pointer
    if (diagnostic.line !== undefined) result.source.line = diagnostic.line
    if (diagnostic.column !== undefined) result.source.column = diagnostic.column
  }
  return result
}

export function attachLintSource(result: LintResult, options: Pick<LintOptions, 'basePath' | 'lookupSourceLocation'>): LintResult {
  const source = result.source ?? sourceFromResultPath(result.path, options.basePath)
  if (!source) return result

  const enriched = enrichLintSourceLocation(source, options.lookupSourceLocation)
  if (enriched === result.source) return result
  return { ...result, source: enriched }
}

function sourceFromResultPath(path: string, basePath: string | undefined): NonNullable<LintResult['source']> | undefined {
  if (!basePath) return undefined
  const pointer = normalizePointer(path)
  return {
    sourceFilePath: basePath,
    sourcePointer: pointer,
    filePath: basePath,
    pointer,
  }
}

function enrichLintSourceLocation(
  source: NonNullable<LintResult['source']>,
  lookupSourceLocation: LintOptions['lookupSourceLocation'],
): NonNullable<LintResult['source']> {
  if (!lookupSourceLocation || (source.line !== undefined && source.column !== undefined)) return source

  const filePath = source.sourceFilePath ?? source.filePath
  const pointer = source.sourcePointer ?? source.pointer
  if (!filePath || !pointer) return source

  const location = lookupSourceLocation(filePath, pointer)
  if (!location) return source
  return {
    ...source,
    line: location.line,
    column: location.column,
  }
}

function normalizePointer(path: string): string {
  if (path === '' || path === '/' || path === '#') return '#'
  if (path.startsWith('#/')) return path
  if (path.startsWith('/')) return `#${path}`
  return path
}

// ─── structure ──────────────────────────────────────────────────────────────

const OPERATION_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace', 'query'] as const

function lintStructure(spec: OasDocument, results: LintResult[]) {
  if (typeof spec.openapi !== 'string' || spec.openapi.length === 0) {
    results.push({ path: '/openapi', severity: 'error', rule: 'structure/openapi-version', message: 'openapi 필드가 필요합니다' })
  } else if (!/^3\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(spec.openapi)) {
    results.push({ path: '/openapi', severity: 'error', rule: 'structure/openapi-version', message: `지원하지 않는 버전: ${spec.openapi}` })
  }

  if (!isRecord(spec.info)) {
    results.push({ path: '/info', severity: 'error', rule: 'structure/info-required', message: 'info 객체가 필요합니다' })
  } else {
    if (typeof spec.info.title !== 'string' || spec.info.title.length === 0) results.push({ path: '/info/title', severity: 'error', rule: 'structure/info-title', message: 'info.title이 필요합니다' })
    if (typeof spec.info.version !== 'string' || spec.info.version.length === 0) results.push({ path: '/info/version', severity: 'error', rule: 'structure/info-version', message: 'info.version이 필요합니다' })
  }

  if (!spec.paths && !spec.webhooks) {
    results.push({ path: '/', severity: 'warning', rule: 'structure/paths-or-webhooks', message: 'paths 또는 webhooks가 하나 이상 필요합니다' })
  }

  lintPathMapShape(spec.paths, 'paths', results)
  lintPathMapShape(spec.webhooks, 'webhooks', results)
}

function lintPathMapShape(
  value: unknown,
  section: 'paths' | 'webhooks',
  results: LintResult[],
): void {
  if (value === undefined) return
  if (!isRecord(value)) {
    results.push({ path: `/${section}`, severity: 'error', rule: `structure/${section}-object`, message: `${section}는 객체여야 합니다` })
    return
  }

  for (const [name, item] of Object.entries(value)) {
    lintPathItemShape(item, pointerPath(section, name), results)
  }
}

function lintPathItemShape(value: unknown, path: string, results: LintResult[]): void {
  if (!isRecord(value)) {
    results.push({ path, severity: 'error', rule: 'structure/path-item-object', message: 'Path Item은 객체여야 합니다' })
    return
  }
  if (isRef(value)) return

  for (const method of OPERATION_METHODS) {
    if (value[method] === undefined) continue
    lintOperationShape(value[method], `${path}/${method}`, results)
  }

  if (value.additionalOperations === undefined) return
  if (!isRecord(value.additionalOperations)) {
    results.push({ path: `${path}/additionalOperations`, severity: 'error', rule: 'structure/additional-operations-object', message: 'additionalOperations는 객체여야 합니다' })
    return
  }
  for (const [method, operation] of Object.entries(value.additionalOperations)) {
    lintOperationShape(operation, `${path}/additionalOperations/${escapePointerSegment(method)}`, results)
  }
}

function lintOperationShape(value: unknown, path: string, results: LintResult[]): void {
  if (!isRecord(value)) {
    results.push({ path, severity: 'error', rule: 'structure/operation-object', message: 'Operation은 객체여야 합니다' })
    return
  }

  if (value.responses === undefined) return
  if (!isRecord(value.responses)) {
    results.push({ path: `${path}/responses`, severity: 'error', rule: 'structure/responses-object', message: 'responses는 객체여야 합니다' })
    return
  }
  for (const [status, response] of Object.entries(value.responses)) {
    if (isRecord(response)) continue
    results.push({ path: `${path}/responses/${escapePointerSegment(status)}`, severity: 'error', rule: 'structure/response-object', message: 'Response는 객체 또는 Reference Object여야 합니다' })
  }
}

// ─── operations ─────────────────────────────────────────────────────────────

function lintOperations(spec: OasDocument, results: LintResult[]) {
  const operationIds = new Set<string>()

  for (const [path, rawItem] of Object.entries(spec.paths ?? {})) {
    if (isRef(rawItem) || !isRecord(rawItem)) continue
    const item = rawItem as OasPathItem

    for (const method of OPERATION_METHODS) {
      const op = item[method] as OasOperation | undefined
      if (!isRecord(op)) continue

      const opPath = pointerPath('paths', path, method)

      if (!op.responses || Object.keys(op.responses).length === 0) {
        results.push({ path: opPath, severity: 'warning', rule: 'operations/responses-required', message: 'responses가 비어있습니다' })
      }

      if (op.operationId) {
        if (operationIds.has(op.operationId)) {
          results.push({ path: `${opPath}/operationId`, severity: 'error', rule: 'operations/unique-operationId', message: `중복 operationId: "${op.operationId}"` })
        }
        operationIds.add(op.operationId)
      }
    }
  }
}

// ─── parameters ─────────────────────────────────────────────────────────────

const VALID_IN = new Set(['path', 'query', 'querystring', 'header', 'cookie'])

function lintParameters(spec: OasDocument, results: LintResult[]) {
  lintParameterMap(spec, spec.paths, 'paths', true, results)
  lintParameterMap(spec, spec.webhooks, 'webhooks', false, results)
}

function lintParameterMap(
  spec: OasDocument,
  map: Record<string, unknown> | undefined,
  section: 'paths' | 'webhooks',
  hasPathTemplates: boolean,
  results: LintResult[],
): void {
  for (const [name, rawItem] of Object.entries(map ?? {})) {
    const itemValue = isRef(rawItem) ? resolvePointer(rawItem.$ref, spec) : rawItem
    if (!isRecord(itemValue)) continue
    const item = itemValue as OasPathItem
    const pathParameters = resolveParameters(spec, item.parameters)
    const pathParamNames = hasPathTemplates
      ? [...name.matchAll(/\{([^}]+)\}/g)].map(match => match[1]!)
      : []

    for (const operation of collectPathItemOperations(item, section, name)) {
      const effectiveParams = mergeLintParameters(
        pathParameters,
        resolveParameters(spec, operation.value.parameters),
      )
      lintEffectiveParameters(effectiveParams, operation.path, pathParamNames, results)
    }
  }
}

function collectPathItemOperations(
  item: OasPathItem,
  section: 'paths' | 'webhooks',
  name: string,
): Array<{ value: OasOperation; path: string }> {
  const operations: Array<{ value: OasOperation; path: string }> = []
  for (const method of OPERATION_METHODS) {
    const value = item[method] as OasOperation | undefined
    if (isRecord(value)) operations.push({ value, path: pointerPath(section, name, method) })
  }
  for (const [method, value] of Object.entries(item.additionalOperations ?? {})) {
    if (isRecord(value)) operations.push({ value: value as OasOperation, path: pointerPath(section, name, 'additionalOperations', method) })
  }
  return operations
}

function resolveParameters(
  spec: OasDocument,
  rawParameters: unknown,
): OasParameter[] {
  if (!Array.isArray(rawParameters)) return []
  const parameters: OasParameter[] = []
  for (const raw of rawParameters) {
    if (!isRecord(raw)) continue
    if (!isRef(raw)) {
      parameters.push(raw as OasParameter)
      continue
    }
    const resolved = resolvePointer(raw.$ref, spec)
    if (isRecord(resolved)) parameters.push(resolved as OasParameter)
  }
  return parameters
}

function mergeLintParameters(pathParameters: readonly OasParameter[], operationParameters: readonly OasParameter[]): OasParameter[] {
  const parameters = new Map<string, OasParameter>()
  for (const parameter of pathParameters) parameters.set(`${parameter.in}:${parameter.name}`, parameter)
  for (const parameter of operationParameters) parameters.set(`${parameter.in}:${parameter.name}`, parameter)
  return [...parameters.values()]
}

function lintEffectiveParameters(
  parameters: readonly OasParameter[],
  operationPath: string,
  pathParamNames: readonly string[],
  results: LintResult[],
): void {
  for (const parameter of parameters) {
    const paramPath = `${operationPath}/parameters/${escapePointerSegment(parameter.name)}`

    if (!VALID_IN.has(parameter.in)) {
      results.push({ path: paramPath, severity: 'error', rule: 'parameters/valid-in', message: `유효하지 않은 in 값: "${parameter.in}"` })
    }
    if (parameter.in === 'path' && !parameter.required) {
      results.push({ path: paramPath, severity: 'error', rule: 'parameters/path-required', message: `path 파라미터 "${parameter.name}"는 required: true여야 합니다` })
    }
    if (parameter.in === 'querystring') lintQuerystringParameter(parameter, paramPath, results)
  }

  const querystringParams = parameters.filter(parameter => parameter.in === 'querystring')
  if (querystringParams.length > 1) {
    results.push({ path: operationPath, severity: 'error', rule: 'parameters/querystring-unique', message: 'operation 또는 Path Item에는 querystring 파라미터를 하나만 정의할 수 있습니다' })
  }
  if (querystringParams.length > 0 && parameters.some(parameter => parameter.in === 'query')) {
    results.push({ path: operationPath, severity: 'error', rule: 'parameters/querystring-exclusive', message: 'querystring 파라미터는 query 파라미터와 함께 사용할 수 없습니다' })
  }

  const definedPathParams = new Set(parameters.filter(parameter => parameter.in === 'path').map(parameter => parameter.name))
  for (const name of pathParamNames) {
    if (!definedPathParams.has(name)) {
      results.push({ path: operationPath, severity: 'warning', rule: 'parameters/path-defined', message: `경로의 {${name}} 파라미터가 정의되지 않았습니다` })
    }
  }
}

function lintQuerystringParameter(parameter: OasParameter, path: string, results: LintResult[]): void {
  if (!isRecord(parameter.content) || Object.keys(parameter.content).length === 0) {
    results.push({ path, severity: 'error', rule: 'parameters/querystring-content-required', message: 'querystring 파라미터는 비어 있지 않은 content 필드가 필요합니다' })
  }
  if (isRecord(parameter.content) && Object.keys(parameter.content).length > 1) {
    results.push({ path, severity: 'error', rule: 'parameters/querystring-single-content', message: 'querystring 파라미터의 content에는 media type을 하나만 선언할 수 있습니다' })
  }
  if (parameter.schema !== undefined || parameter.style !== undefined || parameter.explode !== undefined || parameter.allowReserved !== undefined) {
    results.push({ path, severity: 'error', rule: 'parameters/querystring-content-only', message: 'querystring 파라미터에는 schema/style/explode/allowReserved를 사용할 수 없습니다' })
  }
}

// ─── refs ───────────────────────────────────────────────────────────────────

function lintRefs(spec: OasDocument, results: LintResult[]) {
  lintReferenceValueTypes(spec, '', results)

  const refs: string[] = []
  collectRefs(spec, '/', refs)

  for (const ref of refs) {
    if (!ref.startsWith('#/')) continue // 외부 ref는 스킵
    if (!resolveRef(spec, ref)) {
      results.push({ path: ref, severity: 'error', rule: 'refs/valid-ref', message: `참조 대상을 찾을 수 없습니다: ${ref}` })
    }
  }
}

function collectRefs(node: unknown, path: string, refs: string[]) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    node.forEach((item, i) => collectRefs(item, `${path}[${i}]`, refs))
    return
  }
  const obj = node as Record<string, unknown>
  if (Object.prototype.hasOwnProperty.call(obj, '$ref') && typeof obj['$ref'] === 'string') {
    refs.push(obj['$ref'])
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k === '$ref') continue
    collectRefs(v, `${path}/${k}`, refs)
  }
}

function resolveRef(root: unknown, ref: string): unknown {
  return resolvePointer(ref, root)
}

function lintReferenceValueTypes(node: unknown, path: string, results: LintResult[]): void {
  if (Array.isArray(node)) {
    node.forEach((item, index) => lintReferenceValueTypes(item, `${path}/${index}`, results))
    return
  }
  if (!isRecord(node)) return

  if (Object.prototype.hasOwnProperty.call(node, '$ref') && typeof node.$ref !== 'string') {
    results.push({
      path: path === '' ? '/$ref' : `${path}/$ref`,
      severity: 'error',
      rule: 'refs/ref-string',
      message: '$ref는 문자열 URI reference여야 합니다',
    })
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === '$ref') continue
    lintReferenceValueTypes(value, `${path}/${escapePointerSegment(key)}`, results)
  }
}

// ─── security ───────────────────────────────────────────────────────────────

function lintSecurity(spec: OasDocument, results: LintResult[]) {
  const schemes = Object.keys(spec.components?.securitySchemes ?? {})
  const schemeSet = new Set(schemes)

  // global security
  for (const req of Array.isArray(spec.security) ? spec.security : []) {
    for (const name of Object.keys(req)) {
      if (!schemeSet.has(name)) {
        results.push({ path: '/security', severity: 'error', rule: 'security/scheme-defined', message: `securitySchemes에 "${name}"이 정의되지 않았습니다` })
      }
    }
  }

  // operation-level security
  for (const [path, rawItem] of Object.entries(spec.paths ?? {})) {
    if (isRef(rawItem) || !isRecord(rawItem)) continue
    const item = rawItem as OasPathItem
    for (const method of OPERATION_METHODS) {
      const op = item[method] as OasOperation | undefined
      if (!isRecord(op) || !Array.isArray(op.security)) continue
      for (const req of op.security) {
        for (const name of Object.keys(req)) {
          if (!schemeSet.has(name)) {
                results.push({ path: pointerPath('paths', path, method, 'security'), severity: 'error', rule: 'security/scheme-defined', message: `securitySchemes에 "${name}"이 정의되지 않았습니다` })
          }
        }
      }
    }
  }
}

// ─── style ──────────────────────────────────────────────────────────────────

function lintStyle(spec: OasDocument, results: LintResult[]) {
  for (const [path, rawItem] of Object.entries(spec.paths ?? {})) {
    if (isRef(rawItem) || !isRecord(rawItem)) continue
    const item = rawItem as OasPathItem
    for (const method of OPERATION_METHODS) {
      const op = item[method] as OasOperation | undefined
      if (!isRecord(op)) continue
      const opPath = pointerPath('paths', path, method)
      if (!op.operationId) {
        results.push({ path: opPath, severity: 'info', rule: 'style/operationId', message: 'operationId 권장' })
      }
      if (!op.description && !op.summary) {
        results.push({ path: opPath, severity: 'info', rule: 'style/description', message: 'summary 또는 description 권장' })
      }
    }
  }
}

// ─── components ─────────────────────────────────────────────────────────────

function lintComponents(spec: OasDocument, results: LintResult[]) {
  const allRefs: string[] = []
  collectRefs(spec, '/', allRefs)
  const refSet = new Set(allRefs)
  const refCounts = new Map<string, number>()
  for (const ref of allRefs) {
    refCounts.set(ref, (refCounts.get(ref) ?? 0) + 1)
  }

  const componentTypes = ['schemas', 'responses', 'parameters', 'requestBodies', 'headers', 'links', 'callbacks'] as const
  for (const type of componentTypes) {
    const map = (spec.components as Record<string, Record<string, unknown>> | undefined)?.[type]
    if (!map) continue
    for (const name of Object.keys(map)) {
      const ref = `#/components/${type}/${name}`
      if (!refSet.has(ref)) {
        const component = map[name]
        // The native TypeSpec SSE emitter can leave a generated schema alias
        // (for example, HealthEvents -> HealthEvent) unreferenced while its
        // target is used from a media type itemSchema. Only suppress that exact
        // pure-local-alias shape; an alias whose target appears only in its own
        // $ref remains an unused component warning.
        if (type === 'schemas' && isPureLocalSchemaRefAlias(component) && (refCounts.get(component.$ref) ?? 0) > 1) {
          continue
        }
        results.push({ path: pointerPath('components', type, name), severity: 'warning', rule: `components/unused-${type.replace(/ies$/, 'y').replace(/s$/, '')}`, message: `미사용 컴포넌트: ${type}/${name}` })
      }
    }
  }
}

function isPureLocalSchemaRefAlias(component: unknown): component is { $ref: string } {
  return isRef(component)
    && typeof component.$ref === 'string'
    && component.$ref.startsWith('#/components/schemas/')
    && Object.keys(component).length === 1
}

function pointerPath(...segments: string[]): string {
  return `/${segments.map(escapePointerSegment).join('/')}`
}

function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1')
}
