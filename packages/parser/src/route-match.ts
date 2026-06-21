import type { HttpMethod, MatchResult, RouteIndex } from './types.js'

export const HTTP_METHODS: HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace', 'query']

const regexCache = new WeakMap<RouteIndex, Map<string, { regex: RegExp; paramNames: string[] }>>()

function getOrCompileRoute(index: RouteIndex, pattern: string): { regex: RegExp; paramNames: string[] } {
  let cache = regexCache.get(index)
  if (!cache) {
    cache = new Map()
    regexCache.set(index, cache)
  }
  let entry = cache.get(pattern)
  if (!entry) {
    const paramNames: string[] = []
    const regexStr = pattern.replace(/\{([^}]+)\}/g, (_, name) => {
      paramNames.push(name)
      return '([^/]+)'
    })
    entry = { regex: new RegExp(`^${regexStr}$`), paramNames }
    cache.set(pattern, entry)
  }
  return entry
}

export function matchRoute(
  index: RouteIndex,
  method: HttpMethod,
  urlPath: string,
): MatchResult {
  for (const [openApiPath, methodMap] of index) {
    const params = matchPath(index, openApiPath, urlPath)
    if (params === null) continue

    const entry = methodMap.get(method)
    if (entry) return { type: 'found', entry, pathParams: params }
    return { type: 'method_not_allowed', allowed: [...methodMap.keys()] }
  }
  return { type: 'not_found' }
}

function matchPath(index: RouteIndex, pattern: string, actual: string): Record<string, string> | null {
  const { regex, paramNames } = getOrCompileRoute(index, pattern)
  const match = actual.match(regex)
  if (!match) return null

  const params: Record<string, string> = {}
  for (let i = 0; i < paramNames.length; i++) {
    params[paramNames[i]!] = match[i + 1]!
  }
  return params
}
