/**
 * OAS 3.2 → 3.1 다운그레이드 변환
 *
 * 출력:
 *   .merged.3.1.yaml      — 순수 3.1 스펙 (x-* 오염 없음)
 *   .merged.3.1.meta.json — 3.2 전용 필드 사이드카 (업그레이드 복원용)
 *
 * 변환 규칙:
 *   - openapi: "3.2.0" → "3.1.0"
 *   - dataValue → value (Example Object)
 *   - Schema examples (named map) → example (singular)
 *   - 3.2 전용 필드 → 사이드카에 JSON Pointer로 저장 후 제거
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, stringify } from 'yaml'

export const PRESERVE_FIELDS = new Set([
  'serializedValue', 'itemSchema', 'prefixEncoding', 'itemEncoding',
  'deviceAuthorization', 'deviceAuthorizationUrl', 'oauth2MetadataUrl',
  'defaultMapping',
])

export const REMOVE_FIELDS = new Set([
  'additionalOperations', 'nodeType', '$self',
])

export type DowngradeResult = {
  transformed: Record<string, unknown>
  sidecar: Record<string, unknown>
}

/**
 * OAS 3.2 → 3.1 다운그레이드 핵심 로직 (순수 함수)
 */
export function downgrade(doc: Record<string, unknown>): DowngradeResult {
  const sidecar: Record<string, unknown> = {}
  const transformed = transform(doc, '', sidecar) as Record<string, unknown>
  return { transformed, sidecar }
}

export function transform(node: unknown, pointer: string, sidecar: Record<string, unknown>, parentKey?: string): unknown {
  if (node === null || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map((item, i) => transform(item, `${pointer}/${i}`, sidecar))

  const obj = node as Record<string, unknown>
  const result: Record<string, unknown> = {}

  // Schema examples (named map) → example (singular) + 사이드카 보존
  if (isSchemaContext(obj) && obj['examples'] && typeof obj['examples'] === 'object' && !Array.isArray(obj['examples'])) {
    const named = obj['examples'] as Record<string, Record<string, unknown>>
    const firstValue = Object.values(named).map(ex => ex['value'] ?? ex['dataValue']).find(v => v !== undefined)
    if (firstValue !== undefined) obj['example'] = firstValue
    sidecar[`${pointer}/examples`] = obj['examples']
    delete obj['examples']
  }

  for (const [key, value] of Object.entries(obj)) {
    const childPointer = `${pointer}/${escapePointer(key)}`

    // openapi 버전
    if (key === 'openapi' && value === '3.2.0') {
      result[key] = '3.1.0'
      continue
    }

    // dataValue → value
    if (key === 'dataValue') {
      if (!('value' in obj)) result['value'] = value
      continue
    }

    // 3.2 전용 → 사이드카 보존
    if (PRESERVE_FIELDS.has(key)) {
      sidecar[childPointer] = value
      continue
    }

    // 3.2 전용 → 제거 (복원 가치 낮음)
    if (REMOVE_FIELDS.has(key)) continue

    // Server.name 제거
    if (key === 'name' && parentKey === 'servers') continue
    // Tag.parent, Tag.kind 제거
    if ((key === 'parent' || key === 'kind') && parentKey === 'tags') continue
    // PathItem.query 제거
    if (key === 'query' && isPathItem(obj)) continue
    // Components.pathItems, Components.mediaTypes 제거
    if ((key === 'pathItems' || key === 'mediaTypes') && parentKey === 'components') continue
    // $ref 오버라이드 제거
    if ('$ref' in obj && (key === 'summary' || key === 'description') && key !== '$ref') continue

    result[key] = transform(value, childPointer, sidecar, key)
  }

  return result
}

export function isSchemaContext(obj: Record<string, unknown>): boolean {
  return 'type' in obj || 'properties' in obj || 'allOf' in obj || 'oneOf' in obj || 'anyOf' in obj
}

export function isPathItem(obj: Record<string, unknown>): boolean {
  return ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace'].some(m => m in obj)
    || 'parameters' in obj
}

export function escapePointer(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1')
}

/* ── CLI entry point ─────────────────────────────────────────── */

function main(): void {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const srcPath = resolve(__dirname, '../src/.merged.yaml')
  const outPath = resolve(__dirname, '../src/.merged.3.1.yaml')
  const metaPath = resolve(__dirname, '../src/.merged.3.1.meta.json')

  const raw = readFileSync(srcPath, 'utf8')
  const doc = parse(raw) as Record<string, unknown>

  const { transformed, sidecar } = downgrade(doc)

  // 3.1 스펙 출력
  writeFileSync(outPath, stringify(transformed, { lineWidth: 0 }), 'utf8')

  // 사이드카 메타 출력
  const meta = {
    _comment: 'OAS 3.2 전용 필드 사이드카. upgrade:3.2 시 자동 복원됩니다.',
    source: '.merged.yaml',
    downgradeVersion: '3.1.0',
    originalVersion: '3.2.0',
    preserved: sidecar,
  }
  writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8')

  const v = (transformed['openapi'] as string) ?? '?'
  console.log(`✅ OAS ${v} 다운그레이드 완료: ${outPath}`)
  console.log(`📦 사이드카 메타: ${metaPath} (${Object.keys(sidecar).length}개 필드 보존)`)
}

main()
