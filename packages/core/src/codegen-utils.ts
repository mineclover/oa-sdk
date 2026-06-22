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
    if (hasGeneratedRequestBodyType(op.requestBody)) names.push(`${base}Body`)
    if (hasGeneratedResponseType(op.responses)) {
      names.push(`${base}Response`)
    }
    if (hasGeneratedResponseHeaders(op.responses)) names.push(`${base}ResponseHeaders`)
  }
  return names
}

function hasGeneratedRequestBodyType(requestBody: unknown): boolean {
  if (!isRecord(requestBody)) return false
  const content = readRecord(requestBody.content)
  return hasJsonSchemaMedia(content['application/json'])
}

function hasGeneratedResponseType(responses: Record<string, unknown>): boolean {
  const codes = Object.keys(responses)
    .filter(k => /^2\d{2}$/.test(k))
    .sort()
  const key = codes[0] ?? 'default'
  const response = responses[key]
  if (!isRecord(response)) return false
  const content = readRecord(response.content)
  return hasJsonSchemaMedia(content['application/json'])
}

function hasGeneratedResponseHeaders(responses: Record<string, unknown>): boolean {
  const codes = Object.keys(responses)
    .filter(k => /^2\d{2}$/.test(k))
    .sort()
  const key = codes[0] ?? 'default'
  const response = responses[key]
  if (!isRecord(response)) return false
  const headers = readRecord(response.headers)
  return Object.values(headers).some(header => isRecord(header) && !('$ref' in header))
}

function hasJsonSchemaMedia(media: unknown): boolean {
  return isRecord(media) && !('$ref' in media) && media.schema !== undefined
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
