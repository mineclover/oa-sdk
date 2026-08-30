import type { HttpMethod, MatchResult, OperationEntry, RouteIndex } from './types.js'
import { createSafeRecord } from './safe-record.js'

export const HTTP_METHODS: HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace', 'query']

type CompiledRoute = {
  regex: RegExp
  paramNames: string[]
  /** Literal segments beat template segments at the same URL position. */
  segmentKinds: number[]
  templateCount: number
  literalCharacterCount: number
}

type MatchedRoute = {
  methodMap: Map<HttpMethod, OperationEntry>
  params: Record<string, string>
  compiled: CompiledRoute
}

const regexCache = new WeakMap<RouteIndex, Map<string, CompiledRoute>>()

function getOrCompileRoute(index: RouteIndex, pattern: string): CompiledRoute {
  let cache = regexCache.get(index)
  if (!cache) {
    cache = new Map()
    regexCache.set(index, cache)
  }
  let entry = cache.get(pattern)
  if (!entry) {
    const paramNames: string[] = []
    let literalCharacterCount = 0
    let cursor = 0
    let regexStr = ''
    const templatePattern = /\{([^{}]+)\}/g
    let match: RegExpExecArray | null
    while ((match = templatePattern.exec(pattern)) !== null) {
      const literal = pattern.slice(cursor, match.index)
      literalCharacterCount += literal.length
      regexStr += escapeRegExp(literal)
      const name = match[1]!
      paramNames.push(name)
      regexStr += '([^/]+)'
      cursor = match.index + match[0].length
    }
    const trailingLiteral = pattern.slice(cursor)
    literalCharacterCount += trailingLiteral.length
    regexStr += escapeRegExp(trailingLiteral)
    const segments = pattern.split('/').filter(Boolean)
    entry = {
      regex: new RegExp(`^${regexStr}$`),
      paramNames,
      segmentKinds: segments.map(segment => /\{[^{}]+\}/.test(segment) ? 0 : 1),
      templateCount: paramNames.length,
      literalCharacterCount,
    }
    cache.set(pattern, entry)
  }
  return entry
}

export function matchRoute(
  index: RouteIndex,
  method: HttpMethod,
  urlPath: string,
): MatchResult {
  let best: MatchedRoute | undefined
  for (const [openApiPath, methodMap] of index) {
    const params = matchPath(index, openApiPath, urlPath)
    if (params === null) continue

    const candidate: MatchedRoute = {
      methodMap,
      params,
      compiled: getOrCompileRoute(index, openApiPath),
    }
    if (!best || compareRouteSpecificity(candidate.compiled, best.compiled) > 0) best = candidate
  }

  if (best) {
    const entry = best.methodMap.get(method)
    if (entry) return { type: 'found', entry, pathParams: best.params }
    return { type: 'method_not_allowed', allowed: [...best.methodMap.keys()] }
  }
  return { type: 'not_found' }
}

function matchPath(index: RouteIndex, pattern: string, actual: string): Record<string, string> | null {
  const { regex, paramNames } = getOrCompileRoute(index, pattern)
  const match = actual.match(regex)
  if (!match) return null

  const params = createSafeRecord<string>()
  for (let i = 0; i < paramNames.length; i++) {
    params[paramNames[i]!] = match[i + 1]!
  }
  return params
}

function compareRouteSpecificity(left: CompiledRoute, right: CompiledRoute): number {
  const length = Math.max(left.segmentKinds.length, right.segmentKinds.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (left.segmentKinds[index] ?? 0) - (right.segmentKinds[index] ?? 0)
    if (difference !== 0) return difference
  }
  if (left.templateCount !== right.templateCount) return right.templateCount - left.templateCount
  if (left.literalCharacterCount !== right.literalCharacterCount) {
    return left.literalCharacterCount - right.literalCharacterCount
  }
  return 0
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
