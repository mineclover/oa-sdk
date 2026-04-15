import type { OasResponse, OasSchema, OasHeader, OasLink, Referenceable } from '@oa-sdk/parser'
import { generator } from './generate.js'
import { isStreamingContentType } from './stream.js'
import { pickFirstMediaType, resolveExampleOnly, resolveMediaTypeBody } from './media-body.js'

export type PickedResponse = {
  status: number
  contentType: string
  body: unknown
  /** 선택된 Media Type schema. XML serialization처럼 wire-format이 schema를 필요로 할 때 사용. */
  schema?: OasSchema
  /** OAS Response.headers에서 추출된 헤더 (이름 → 값) */
  headers: Record<string, string>
  /** OAS Response.links에서 추출된 관계 메타데이터 (이름 → Link Object) */
  links: Record<string, OasLink>
  /**
   * 스트리밍 content-type에서 example 없을 때만 존재.
   * 어댑터가 StreamFolder로 이벤트를 생성하는 데 사용.
   */
  stream?: OasSchema
}

/**
 * operation responses에서 반환할 응답을 선택.
 *
 * 상태 코드 우선순위 (OAS 3.2.0 §4.8.16):
 *   1. 정확한 3자리 숫자 코드 — 2xx 중 가장 낮은 것 우선
 *   2. 범위 ���드 (2XX, 4XX …) — 2XX 우선
 *   3. default
 *
 * 본문 선택 우선순위 (OAS 3.2.0 §4.8.19):
 *   1. examples[0].dataValue → 2. value → 3. example → 4. schema.example → 5. schema.default → 6. generateMinimal
 */
export function pickResponse(responses: Record<string, OasResponse>): PickedResponse | null {
  const entry = pickStatusEntry(responses)
  if (!entry) return null

  const response = responses[entry.key]
  if (!response) return null

  const { contentType, mediaType } = pickFirstMediaType(response.content)

  // 응답 헤더 추출
  const headers = extractHeaders(response.headers)
  const links = extractLinks(response.links)

  if (isStreamingContentType(contentType)) {
    const exampleBody = resolveExampleOnly(mediaType)
    if (exampleBody !== null) {
      return { status: entry.status, contentType, body: exampleBody, headers, links }
    }
    const schema = mediaType?.schema as OasSchema | undefined
    const result: PickedResponse = { status: entry.status, contentType, body: null, headers, links }
    if (schema !== undefined) result.stream = schema
    return result
  }

  const schema = mediaType?.schema as OasSchema | undefined
  const result: PickedResponse = { status: entry.status, contentType, body: resolveMediaTypeBody(mediaType), headers, links }
  if (schema !== undefined) result.schema = schema
  return result
}

// ─── 상태 코드 선택 ──────────────────────────────────────────────────────────

function pickStatusEntry(
  responses: Record<string, OasResponse>,
): { status: number; key: string } | null {
  const keys = Object.keys(responses)

  const exact = keys
    .filter(k => /^\d{3}$/.test(k))
    .map(Number)
    .sort((a, b) => a - b)

  const ok2xx = exact.find(c => c >= 200 && c < 300)
  if (ok2xx !== undefined) return { status: ok2xx, key: String(ok2xx) }
  if (exact.length > 0) return { status: exact[0]!, key: String(exact[0]!) }

  const ranges = keys.filter(k => /^\dXX$/i.test(k)).sort()
  const range2xx = ranges.find(k => k[0] === '2')
  if (range2xx) return { status: 200, key: range2xx }
  if (ranges.length > 0) {
    const base = parseInt(ranges[0]![0]! + '00', 10)
    return { status: base, key: ranges[0]! }
  }

  if (keys.includes('default')) return { status: 200, key: 'default' }

  return null
}

// ─── 응답 헤더 추출 ──────────────────────────────────────────────────────────

function extractHeaders(
  rawHeaders: Record<string, Referenceable<OasHeader>> | undefined,
): Record<string, string> {
  if (!rawHeaders) return {}
  const result: Record<string, string> = {}
  for (const [name, raw] of Object.entries(rawHeaders)) {
    if ('$ref' in raw) continue // 미해결 외부 ref 건너뜀
    const header = raw as OasHeader
    // example → schema.example → schema.default → schema 기반 생성
    const value = resolveHeaderValue(header)
    if (value !== undefined) result[name] = String(value)
  }
  return result
}

function resolveHeaderValue(header: OasHeader): unknown {
  if (header.example !== undefined) return header.example
  if (header.examples && typeof header.examples === 'object') {
    const first = Object.values(header.examples)[0]
    if (first && typeof first === 'object' && !('$ref' in first)) {
      const ex = first as { dataValue?: unknown; value?: unknown }
      if (ex.dataValue !== undefined) return ex.dataValue
      if (ex.value !== undefined) return ex.value
    }
  }
  if (header.schema) {
    const s = header.schema as OasSchema
    if (s.example !== undefined) return s.example
    if (s.default !== undefined) return s.default
    return generator.fold(s)
  }
  return undefined
}

// ─── 응답 링크 메타데이터 추출 ───────────────────────────────────────────────

function extractLinks(
  rawLinks: Record<string, Referenceable<OasLink>> | undefined,
): Record<string, OasLink> {
  if (!rawLinks) return {}
  const result: Record<string, OasLink> = {}
  for (const [name, raw] of Object.entries(rawLinks)) {
    if ('$ref' in raw) continue
    result[name] = raw as OasLink
  }
  return result
}
