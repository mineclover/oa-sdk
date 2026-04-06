/**
 * ParsedDocument query API
 *
 * ParsedDocument IR을 쉽게 조회하는 헬퍼.
 * AI/사용자에게 API 메타데이터를 제공하고 테스트에서 활용.
 */

import type { ParsedDocument, OperationEntry, OasSchema, OasTag, OasServer } from './types.js'

/**
 * operationId로 오퍼레이션 검색
 */
export function findOperation(doc: ParsedDocument, operationId: string): OperationEntry | undefined {
  return doc.operations.find(op => op.operationId === operationId)
}

/**
 * 태그로 오퍼레이션 필터링
 */
export function findByTag(doc: ParsedDocument, tag: string): OperationEntry[] {
  return doc.operations.filter(op => op.tags.includes(tag))
}

/**
 * 경로 패턴 + 메서드로 오퍼레이션 검색
 */
export function findByPath(doc: ParsedDocument, path: string, method?: string): OperationEntry[] {
  return doc.operations.filter(op => {
    if (op.openApiPath !== path) return false
    if (method && op.method !== method.toLowerCase()) return false
    return true
  })
}

/**
 * components/schemas에서 스키마 조회
 */
export function getSchema(doc: ParsedDocument, name: string): OasSchema | undefined {
  return doc.schemas[name]
}

/**
 * 태그 정보 조회 (계층 포함)
 */
export function getTag(doc: ParsedDocument, name: string): OasTag | undefined {
  return doc.tags.get(name)
}

/**
 * 모든 오퍼레이션을 태그별로 그룹핑
 */
export function groupByTag(doc: ParsedDocument): Map<string, OperationEntry[]> {
  const groups = new Map<string, OperationEntry[]>()
  for (const op of doc.operations) {
    if (op.tags.length === 0) {
      const list = groups.get('untagged') ?? []
      list.push(op)
      groups.set('untagged', list)
    } else {
      for (const tag of op.tags) {
        const list = groups.get(tag) ?? []
        list.push(op)
        groups.set(tag, list)
      }
    }
  }
  return groups
}

/**
 * API 전체 요약 — AI/사용자에게 API 구조 제공
 */
export function describeApi(doc: ParsedDocument): string {
  const lines: string[] = []
  lines.push(`${doc.info.title} v${doc.info.version}`)
  if (doc.info.description) lines.push(doc.info.description)
  lines.push('')
  lines.push(`서버: ${doc.servers.map(s => s.url).join(', ') || '(없음)'}`)
  lines.push(`스키마: ${Object.keys(doc.schemas).length}개`)
  lines.push(`오퍼레이션: ${doc.operations.length}개`)

  // 태그 계층 구축 (parent/kind)
  const rootTags: string[] = []
  const childTags = new Map<string, string[]>() // parent → children
  for (const [name, tag] of doc.tags) {
    if (tag.parent) {
      const siblings = childTags.get(tag.parent) ?? []
      siblings.push(name)
      childTags.set(tag.parent, siblings)
    } else {
      rootTags.push(name)
    }
  }
  // groupByTag에 있지만 tags 정의에 없는 것도 포함
  const tagged = groupByTag(doc)
  for (const tag of tagged.keys()) {
    if (!rootTags.includes(tag) && !Array.from(childTags.values()).flat().includes(tag)) {
      rootTags.push(tag)
    }
  }

  function renderTag(tag: string, indent: string) {
    const tagInfo = doc.tags.get(tag)
    const desc = tagInfo?.description ? ` — ${tagInfo.description}` : ''
    const kind = tagInfo?.kind ? ` [${tagInfo.kind}]` : ''
    lines.push(`${indent}[${tag}]${kind}${desc}`)
    const ops = tagged.get(tag) ?? []
    for (const op of ops) {
      const deprecated = op.deprecated ? ' (deprecated)' : ''
      lines.push(`${indent}  ${op.method.toUpperCase()} ${op.openApiPath} — ${op.summary ?? op.operationId ?? ''}${deprecated}`)
    }
    // 자식 태그 재귀
    for (const child of childTags.get(tag) ?? []) {
      renderTag(child, indent + '  ')
    }
  }

  for (const tag of rootTags) {
    lines.push('')
    renderTag(tag, '')
  }

  return lines.join('\n')
}

/**
 * Server URL의 variables를 치환합니다.
 *
 * @param server OAS Server 객체
 * @param overrides 변수 오버라이드 (없으면 default 사용)
 * @returns 치환된 URL
 *
 * @example
 * resolveServerUrl({ url: 'https://{env}.api.com/v{version}', variables: { env: { default: 'prod' }, version: { default: '2' } } })
 * // → 'https://prod.api.com/v2'
 */
export function resolveServerUrl(server: OasServer, overrides: Record<string, string> = {}): string {
  let url = server.url
  if (server.variables) {
    for (const [name, variable] of Object.entries(server.variables)) {
      const value = overrides[name] ?? variable.default
      url = url.replaceAll(`{${name}}`, value)
    }
  }
  return url
}
