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

import type { OasDocument, OasPathItem, OasOperation, OasParameter, OasComponents, Referenceable } from './oas32-types.js'

function isRef(node: unknown): node is { $ref: string } {
  return typeof node === 'object' && node !== null && '$ref' in node
}

export type LintSeverity = 'error' | 'warning' | 'info'

export type LintResult = {
  path: string
  severity: LintSeverity
  rule: string
  message: string
}

export type LintOptions = {
  /** 실행할 규칙 카테고리 (기본: 전체) */
  categories?: Array<'structure' | 'operations' | 'parameters' | 'refs' | 'security' | 'style' | 'components'>
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
  if (categories.has('refs')) lintRefs(spec, results)
  if (categories.has('security')) lintSecurity(spec, results)
  if (categories.has('style')) lintStyle(spec, results)
  if (categories.has('components')) lintComponents(spec, results)

  return results
}

// ─── structure ──────────────────────────────────────────────────────────────

function lintStructure(spec: OasDocument, results: LintResult[]) {
  if (!spec.openapi) {
    results.push({ path: '/openapi', severity: 'error', rule: 'structure/openapi-version', message: 'openapi 필드가 필요합니다' })
  } else if (!spec.openapi.startsWith('3.')) {
    results.push({ path: '/openapi', severity: 'error', rule: 'structure/openapi-version', message: `지원하지 않는 버전: ${spec.openapi}` })
  }

  if (!spec.info) {
    results.push({ path: '/info', severity: 'error', rule: 'structure/info-required', message: 'info 객체가 필요합니다' })
  } else {
    if (!spec.info.title) results.push({ path: '/info/title', severity: 'error', rule: 'structure/info-title', message: 'info.title이 필요합니다' })
    if (!spec.info.version) results.push({ path: '/info/version', severity: 'error', rule: 'structure/info-version', message: 'info.version이 필요합니다' })
  }

  if (!spec.paths && !spec.webhooks) {
    results.push({ path: '/', severity: 'warning', rule: 'structure/paths-or-webhooks', message: 'paths 또는 webhooks가 하나 이상 필요합니다' })
  }
}

// ─── operations ─────────────────────────────────────────────────────────────

function lintOperations(spec: OasDocument, results: LintResult[]) {
  const operationIds = new Set<string>()

  for (const [path, rawItem] of Object.entries(spec.paths ?? {})) {
    if (isRef(rawItem)) continue
    const item = rawItem as OasPathItem

    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace', 'query'] as const) {
      const op = item[method] as OasOperation | undefined
      if (!op) continue

      const opPath = `/paths/${path}/${method}`

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

const VALID_IN = new Set(['path', 'query', 'header', 'cookie'])

function lintParameters(spec: OasDocument, results: LintResult[]) {
  for (const [path, rawItem] of Object.entries(spec.paths ?? {})) {
    if (isRef(rawItem)) continue
    const item = rawItem as OasPathItem

    // path에서 {param} 추출
    const pathParamNames = [...path.matchAll(/\{([^}]+)\}/g)].map(m => m[1]!)

    const allParams: OasParameter[] = []

    // path-level params
    for (const p of (item.parameters ?? []) as OasParameter[]) {
      if ('$ref' in p) continue
      allParams.push(p)
    }

    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace', 'query'] as const) {
      const op = item[method] as OasOperation | undefined
      if (!op) continue

      const opParams = [...allParams]
      for (const p of (op.parameters ?? []) as OasParameter[]) {
        if ('$ref' in p) continue
        opParams.push(p)
      }

      for (const p of opParams) {
        const paramPath = `/paths/${path}/${method}/parameters/${p.name}`

        if (!VALID_IN.has(p.in)) {
          results.push({ path: paramPath, severity: 'error', rule: 'parameters/valid-in', message: `유효하지 않은 in 값: "${p.in}"` })
        }

        if (p.in === 'path' && !p.required) {
          results.push({ path: paramPath, severity: 'error', rule: 'parameters/path-required', message: `path 파라미터 "${p.name}"는 required: true여야 합니다` })
        }
      }

      // path params 정의 확인
      const definedPathParams = new Set(opParams.filter(p => p.in === 'path').map(p => p.name))
      for (const name of pathParamNames) {
        if (!definedPathParams.has(name)) {
          results.push({ path: `/paths/${path}/${method}`, severity: 'warning', rule: 'parameters/path-defined', message: `경로의 {${name}} 파라미터가 정의되지 않았습니다` })
        }
      }
    }
  }
}

// ─── refs ───────────────────────────────────────────────────────────────────

function lintRefs(spec: OasDocument, results: LintResult[]) {
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
  if (typeof obj['$ref'] === 'string') {
    refs.push(obj['$ref'])
    return
  }
  for (const [k, v] of Object.entries(obj)) {
    collectRefs(v, `${path}/${k}`, refs)
  }
}

function resolveRef(root: unknown, ref: string): unknown {
  const parts = ref.slice(2).split('/').map(p => p.replace(/~1/g, '/').replace(/~0/g, '~'))
  let current: unknown = root
  for (const part of parts) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

// ─── security ───────────────────────────────────────────────────────────────

function lintSecurity(spec: OasDocument, results: LintResult[]) {
  const schemes = Object.keys(spec.components?.securitySchemes ?? {})
  const schemeSet = new Set(schemes)

  // global security
  for (const req of spec.security ?? []) {
    for (const name of Object.keys(req)) {
      if (!schemeSet.has(name)) {
        results.push({ path: '/security', severity: 'error', rule: 'security/scheme-defined', message: `securitySchemes에 "${name}"이 정의되지 않았습니다` })
      }
    }
  }

  // operation-level security
  for (const [path, rawItem] of Object.entries(spec.paths ?? {})) {
    if (isRef(rawItem)) continue
    const item = rawItem as OasPathItem
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace', 'query'] as const) {
      const op = item[method] as OasOperation | undefined
      if (!op?.security) continue
      for (const req of op.security) {
        for (const name of Object.keys(req)) {
          if (!schemeSet.has(name)) {
            results.push({ path: `/paths/${path}/${method}/security`, severity: 'error', rule: 'security/scheme-defined', message: `securitySchemes에 "${name}"이 정의되지 않았습니다` })
          }
        }
      }
    }
  }
}

// ─── style ──────────────────────────────────────────────────────────────────

function lintStyle(spec: OasDocument, results: LintResult[]) {
  for (const [path, rawItem] of Object.entries(spec.paths ?? {})) {
    if (isRef(rawItem)) continue
    const item = rawItem as OasPathItem
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace', 'query'] as const) {
      const op = item[method] as OasOperation | undefined
      if (!op) continue
      const opPath = `/paths/${path}/${method}`
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

  const componentTypes = ['schemas', 'responses', 'parameters', 'requestBodies', 'headers', 'links', 'callbacks'] as const
  for (const type of componentTypes) {
    const map = (spec.components as Record<string, Record<string, unknown>> | undefined)?.[type]
    if (!map) continue
    for (const name of Object.keys(map)) {
      const ref = `#/components/${type}/${name}`
      if (!refSet.has(ref)) {
        results.push({ path: `/components/${type}/${name}`, severity: 'warning', rule: `components/unused-${type.replace(/ies$/, 'y').replace(/s$/, '')}`, message: `미사용 컴포넌트: ${type}/${name}` })
      }
    }
  }
}
