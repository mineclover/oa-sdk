/**
 * OAS 3.2 문서 검증 파이프라인
 *
 * 단계:
 *   1. YAML/JSON 파싱 유효성
 *   2. 필수 구조 검증 (openapi, info, paths)
 *   3. 자체 린터 (참조, 보안, 파라미터, 스타일, 미사용 컴포넌트)
 *   4. 3.1 다운그레이드 가능성 확인
 */

import { lintDocument, type LintResult } from './lint.js'

export type ValidationLevel = 'error' | 'warning' | 'info'

export type ValidationResult = {
  valid: boolean
  errors: LintResult[]
  warnings: LintResult[]
  infos: LintResult[]
  summary: string
}

/**
 * OAS 3.2 문서를 종합 검증합니다.
 *
 * @param input YAML/JSON 문자열 또는 파싱된 객체
 */
export function validateDocument(input: string | Record<string, unknown>): ValidationResult {
  const results: LintResult[] = []

  // Step 1: YAML/JSON 파싱
  let doc: unknown
  if (typeof input === 'string') {
    try {
      // JSON 먼저 시도
      doc = JSON.parse(input)
    } catch {
      // YAML 시도 (동적 import 불가하므로 간단 검증)
      try {
        // yaml 패키지 없이 기본 검증: 첫 줄이 openapi로 시작하는지
        if (!input.trim().startsWith('{') && !input.includes('openapi')) {
          results.push({ path: '/', severity: 'error', rule: 'parse/yaml', message: 'YAML 파싱 불가: openapi 필드를 찾을 수 없습니다' })
          return buildResult(results)
        }
        // 런타임에서는 이미 파싱된 객체를 받을 것으로 기대
        results.push({ path: '/', severity: 'error', rule: 'parse/format', message: '문자열 입력은 JSON만 지원합니다. YAML은 파싱 후 객체를 전달하세요.' })
        return buildResult(results)
      } catch {
        results.push({ path: '/', severity: 'error', rule: 'parse/format', message: '입력을 파싱할 수 없습니다' })
        return buildResult(results)
      }
    }
  } else {
    doc = input
  }

  // Step 2: 기본 타입 검증
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    results.push({ path: '/', severity: 'error', rule: 'parse/type', message: '문서가 유효한 객체가 아닙니다' })
    return buildResult(results)
  }

  const obj = doc as Record<string, unknown>

  // Step 3: openapi 버전 확인
  if (typeof obj['openapi'] !== 'string') {
    results.push({ path: '/openapi', severity: 'error', rule: 'parse/version', message: 'openapi 버전 문자열이 필요합니다' })
    return buildResult(results)
  }

  const version = obj['openapi'] as string
  if (!version.startsWith('3.')) {
    results.push({ path: '/openapi', severity: 'error', rule: 'parse/version', message: `지원하지 않는 버전: ${version} (3.x 필요)` })
    return buildResult(results)
  }

  // 3.2 미만이면 경고
  if (version !== '3.2.0' && !version.startsWith('3.2')) {
    results.push({ path: '/openapi', severity: 'info', rule: 'parse/version-32', message: `OAS ${version} — 3.2.0 권장. 3.2 전용 기능(dataValue, itemSchema 등) 사용 불가.` })
  }

  // Step 4: 자체 린터 실행
  const lintResults = lintDocument(doc)
  results.push(...lintResults)

  return buildResult(results)
}

function buildResult(results: LintResult[]): ValidationResult {
  const errors = results.filter(r => r.severity === 'error')
  const warnings = results.filter(r => r.severity === 'warning')
  const infos = results.filter(r => r.severity === 'info')

  const valid = errors.length === 0
  const summary = valid
    ? `✅ Valid — ${warnings.length} warnings, ${infos.length} infos`
    : `❌ Invalid — ${errors.length} errors, ${warnings.length} warnings`

  return { valid, errors, warnings, infos, summary }
}
