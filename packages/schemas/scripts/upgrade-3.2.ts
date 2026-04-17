/**
 * OAS 3.1 → 3.2 업그레이드 변환
 *
 * 사이드카 메타 파일이 있으면 3.2 전용 필드를 자동 복원합니다.
 * 없으면 가능한 범위만 변환 (value→dataValue, example→examples).
 *
 * 사용법:
 *   tsx scripts/upgrade-3.2.ts                              ← 기본 (.merged.3.1.yaml)
 *   tsx scripts/upgrade-3.2.ts input.yaml [output.yaml]     ← 임의 파일
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse, stringify } from 'yaml'

/**
 * OAS 3.1 → 3.2 업그레이드 핵심 로직 (순수 함수)
 */
export function upgrade(doc: Record<string, unknown>, sidecar: Record<string, unknown> = {}): Record<string, unknown> {
  return transformUpgrade(doc, '', sidecar, 'root') as Record<string, unknown>
}

export function transformUpgrade(
  node: unknown,
  pointer: string,
  sidecar: Record<string, unknown>,
  context: 'root' | 'example' | 'other' = 'other',
): unknown {
  if (node === null || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map((item, i) => transformUpgrade(item, `${pointer}/${i}`, sidecar, context))

  const obj = node as Record<string, unknown>
  const result: Record<string, unknown> = {}

  // openapi 버전 업그레이드
  if ('openapi' in obj && typeof obj['openapi'] === 'string' && obj['openapi'].startsWith('3.1')) {
    result['openapi'] = '3.2.0'
  }

  const isExampleContext = context === 'example' ||
    ('value' in obj && !('type' in obj) && !('properties' in obj))

  for (const [key, value] of Object.entries(obj)) {
    const childPointer = `${pointer}/${escapePointer(key)}`

    if (key === 'openapi' && result['openapi']) continue

    // value → dataValue (Example Object)
    if (key === 'value' && isExampleContext) {
      result['dataValue'] = value
      continue
    }

    // Schema example → examples (사이드카에 원본 있으면 그쪽 사용)
    if (key === 'example' && isSchemaContext(obj)) {
      const originalExamples = sidecar[`${pointer}/examples`]
      if (originalExamples) {
        result['examples'] = originalExamples
      } else {
        result['examples'] = { default: { dataValue: value } }
      }
      continue
    }

    // examples map → 재귀 (example context)
    if (key === 'examples' && typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const map: Record<string, unknown> = {}
      for (const [exName, exValue] of Object.entries(value as Record<string, unknown>)) {
        map[exName] = transformUpgrade(exValue, `${childPointer}/${escapePointer(exName)}`, sidecar, 'example')
      }
      result[key] = map
      continue
    }

    result[key] = transformUpgrade(value, childPointer, sidecar, isSchemaContext(obj) ? 'other' : context)
  }

  // 사이드카에서 이 포인터에 보존된 필드 복원
  for (const [ptr, val] of Object.entries(sidecar)) {
    // pointer가 현재 노드의 직접 자식인지 확인
    if (ptr.startsWith(pointer + '/') && !ptr.slice(pointer.length + 1).includes('/')) {
      const fieldName = unescapePointer(ptr.slice(pointer.length + 1))
      if (!(fieldName in result)) {
        result[fieldName] = val
      }
    }
  }

  return result
}

export function isSchemaContext(obj: Record<string, unknown>): boolean {
  return 'type' in obj || 'properties' in obj || 'allOf' in obj || 'oneOf' in obj || 'anyOf' in obj
}

export function escapePointer(s: string): string {
  return s.replace(/~/g, '~0').replace(/\//g, '~1')
}

export function unescapePointer(s: string): string {
  return s.replace(/~1/g, '/').replace(/~0/g, '~')
}

/* ── CLI entry point ─────────────────────────────────────────── */

function main(): void {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const inputArg = process.argv[2]
  const outputArg = process.argv[3]

  const srcPath = inputArg
    ? resolve(process.cwd(), inputArg)
    : resolve(__dirname, '../src/.merged.3.1.yaml')
  const metaPath = srcPath.replace('.yaml', '.meta.json')
  const outPath = outputArg
    ? resolve(process.cwd(), outputArg)
    : srcPath.replace('.3.1.yaml', '.upgraded.3.2.yaml')

  const raw = readFileSync(srcPath, 'utf8')
  const doc = parse(raw) as Record<string, unknown>

  // 사이드카 로드
  let sidecar: Record<string, unknown> = {}
  let hasMeta = false
  if (existsSync(metaPath)) {
    const metaRaw = JSON.parse(readFileSync(metaPath, 'utf8'))
    sidecar = metaRaw.preserved ?? {}
    hasMeta = true
  }

  const transformed = upgrade(doc, sidecar)
  writeFileSync(outPath, stringify(transformed, { lineWidth: 0 }), 'utf8')

  console.log(`✅ OAS 3.2.0 업그레이드 완료: ${outPath}`)
  if (hasMeta) {
    console.log(`📦 사이드카에서 ${Object.keys(sidecar).length}개 필드 복원`)
  } else {
    console.log(`⚠️  사이드카 없음 (${metaPath}). 기본 변환만 적용.`)
    console.log(`   수동 추가 필요: serializedValue, itemSchema, deviceAuthorization, oauth2MetadataUrl`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main()
}
