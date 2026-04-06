/**
 * 코드 생성 공용 유틸리티
 *
 * typegen, router, client에서 공통으로 사용하는 타입 이름 수집 등.
 */

import { pascalCase } from './strings.js'

/**
 * operations에서 typegen이 생성할 타입 이름을 수집합니다.
 * router, client에서 import 문 생성에 사용.
 */
export function collectTypeNames(operations: ReadonlyArray<{
  operationId?: string
  parameters: ReadonlyArray<{ in: string }>
  requestBody?: unknown
  responses: Record<string, unknown>
}>): string[] {
  const names: string[] = []
  for (const op of operations) {
    if (!op.operationId) continue
    const base = pascalCase(op.operationId)
    if (op.parameters.some(p => p.in === 'path')) names.push(`${base}PathParams`)
    if (op.parameters.some(p => p.in === 'query')) names.push(`${base}QueryParams`)
    if (op.requestBody) names.push(`${base}Body`)
    const has2xx = Object.keys(op.responses).some(k => /^2\d{2}$/.test(k))
    if (has2xx) {
      names.push(`${base}Response`)
      // Response headers 존재 여부 확인 (모든 2xx 응답 검사)
      const hasResponseHeaders = Object.entries(op.responses).some(([k, v]) =>
        /^2\d{2}$/.test(k) && v !== null && typeof v === 'object' && 'headers' in v
      )
      if (hasResponseHeaders) names.push(`${base}ResponseHeaders`)
    }
  }
  return names
}
