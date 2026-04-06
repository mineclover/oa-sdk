import type { RouteIndex, HttpMethod, OperationEntry } from '@oa-sdk/parser'

/**
 * 라우트 필터 — 핸들러 생성 시 포함할 라우트를 선택.
 *
 * 여러 조건이 동시에 지정되면 OR 의미론 (하나라도 매칭되면 포함).
 * 이유: 실제 사용에서 "이 경로들 OR 이 오퍼레이션들" 형태가 자연스러움.
 *
 * @example path prefix — /orgs 하위만
 *   { paths: ['/orgs'] }
 *
 * @example 특정 오퍼레이션만
 *   { operations: ['listUsers', 'getUser'] }
 *
 * @example 태그 기반
 *   { tags: ['projects'] }
 *
 * @example 커스텀 predicate
 *   { filter: (path, method, entry) => !entry.deprecated }
 */
export type RouteFilter = {
  /** Path prefix 매칭 (e.g. '/orgs' → /orgs, /orgs/{id}, /orgs/{id}/projects 전부 포함) */
  paths?: string[]
  /** operationId 목록 */
  operations?: string[]
  /** 태그 이름 목록 (operation.tags에 하나라도 포함되면 매칭) */
  tags?: string[]
  /** 커스텀 필터 — 위 조건과 OR로 합산됨 */
  filter?: (path: string, method: HttpMethod, entry: OperationEntry) => boolean
}

/**
 * RouteIndex에서 필터 조건에 맞는 라우트만 추출.
 * filter가 undefined이면 원본 그대로 반환.
 */
export function filterRouteIndex(
  index: RouteIndex,
  routeFilter: RouteFilter | undefined,
): RouteIndex {
  if (!routeFilter) return index

  const { paths, operations, tags, filter } = routeFilter
  const hasAnyCondition = paths?.length || operations?.length || tags?.length || filter

  if (!hasAnyCondition) return index

  const pathSet = paths ? new Set(paths) : null
  const opSet = operations ? new Set(operations) : null
  const tagSet = tags ? new Set(tags) : null

  const filtered: RouteIndex = new Map()

  for (const [openApiPath, methodMap] of index) {
    const filteredMethods = new Map<HttpMethod, OperationEntry>()

    for (const [method, entry] of methodMap) {
      if (matchesFilter(openApiPath, method, entry, pathSet, opSet, tagSet, filter)) {
        filteredMethods.set(method, entry)
      }
    }

    if (filteredMethods.size > 0) {
      filtered.set(openApiPath, filteredMethods)
    }
  }

  return filtered
}

function matchesFilter(
  path: string,
  method: HttpMethod,
  entry: OperationEntry,
  pathSet: Set<string> | null,
  opSet: Set<string> | null,
  tagSet: Set<string> | null,
  filter: RouteFilter['filter'],
): boolean {
  if (pathSet) {
    for (const prefix of pathSet) {
      if (path === prefix || path.startsWith(prefix + '/')) return true
    }
  }

  if (opSet && entry.operationId && opSet.has(entry.operationId)) return true

  if (tagSet && entry.tags.some(t => tagSet.has(t))) return true

  if (filter && filter(path, method, entry)) return true

  return false
}
