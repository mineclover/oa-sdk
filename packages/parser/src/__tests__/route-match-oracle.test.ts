import { describe, expect, it } from 'vitest'
import { HTTP_METHODS, matchRoute } from '../route-match.js'
import type { HttpMethod, MatchResult, RouteIndex } from '../types.js'
import { linearMatchRoute, listMatchingPatterns } from './support/linear-route-match.js'
import {
  createRandom,
  generateAdversarialRouteIndex,
  generateApiRouteSet,
  generateRequestPaths,
} from './support/route-corpus.js'

/** Plain-data view of a match result; pathParams keeps key order and own keys only. */
function describeResult(result: MatchResult): unknown {
  switch (result.type) {
    case 'found':
      return {
        type: result.type,
        openApiPath: result.entry.openApiPath,
        method: result.entry.method,
        pathParams: Object.entries(result.pathParams),
        prototype: Object.getPrototypeOf(result.pathParams),
      }
    case 'method_not_allowed':
      return { type: result.type, allowed: result.allowed }
    case 'not_found':
      return { type: result.type }
  }
}

type Mismatch = {
  routes: string[]
  method: HttpMethod
  urlPath: string
  expected: unknown
  actual: unknown
}

function compareWithOracle(
  index: RouteIndex,
  method: HttpMethod,
  urlPath: string,
): { expected: MatchResult; mismatch: Mismatch | undefined } {
  const expected = linearMatchRoute(index, method, urlPath)
  const actual = matchRoute(index, method, urlPath)
  const sameEntry = expected.type !== 'found' || (actual.type === 'found' && actual.entry === expected.entry)
  const expectedView = describeResult(expected)
  const actualView = describeResult(actual)
  if (sameEntry && JSON.stringify(expectedView) === JSON.stringify(actualView)) return { expected, mismatch: undefined }
  return { expected, mismatch: { routes: [...index.keys()], method, urlPath, expected: expectedView, actual: actualView } }
}

// The reference matcher is linear in the number of routes, so these corpora take
// a few hundred milliseconds normally and several seconds on a loaded host.
const ORACLE_TIMEOUT_MS = 60_000

describe('matchRoute oracle equivalence with the linear regex matcher', () => {
  it('agrees on a generated adversarial corpus of route sets and request paths', () => {
    const random = createRandom(0x5eed_2c2)
    const mismatches: Mismatch[] = []
    const coverage = {
      requests: 0,
      found: 0,
      methodNotAllowed: 0,
      notFound: 0,
      ambiguous: 0,
      ambiguousWithStatic: 0,
      winnerNotFirstCandidate: 0,
      compositeWinner: 0,
      emptySegmentRoutes: 0,
    }

    for (let routeSet = 0; routeSet < 400; routeSet += 1) {
      const index = generateAdversarialRouteIndex(random)
      const declaredMethods = [...new Set([...index.values()].flatMap(methodMap => [...methodMap.keys()]))]
      for (const pattern of index.keys()) {
        if (pattern.includes('//') || pattern.endsWith('/')) coverage.emptySegmentRoutes += 1
      }
      for (const urlPath of generateRequestPaths(random, index, 60)) {
        // Mostly methods the set declares (to reach `found`), sometimes any method.
        const method = declaredMethods.length > 0 && random.chance(0.75)
          ? random.pick(declaredMethods)
          : random.pick(HTTP_METHODS)
        coverage.requests += 1
        const { expected, mismatch } = compareWithOracle(index, method, urlPath)
        if (mismatch) mismatches.push(mismatch)

        if (expected.type === 'found') coverage.found += 1
        else if (expected.type === 'method_not_allowed') coverage.methodNotAllowed += 1
        else coverage.notFound += 1

        const candidates = listMatchingPatterns(index, urlPath)
        if (candidates.length > 1) {
          coverage.ambiguous += 1
          if (candidates.some(pattern => !/\{[^{}]+\}/.test(pattern))) coverage.ambiguousWithStatic += 1
        }
        if (expected.type === 'found') {
          const winner = expected.entry.openApiPath
          if (candidates[0] !== winner) coverage.winnerNotFirstCandidate += 1
          if (winner.split('/').some(segment => /\{[^{}]+\}/.test(segment) && !/^\{[^{}]+\}$/.test(segment))) {
            coverage.compositeWinner += 1
          }
        }
      }
    }

    expect(mismatches.slice(0, 5)).toEqual([])
    // The corpus must actually exercise the interesting cases, not just misses.
    expect(coverage.found).toBeGreaterThan(2_000)
    expect(coverage.methodNotAllowed).toBeGreaterThan(1_000)
    expect(coverage.notFound).toBeGreaterThan(2_000)
    expect(coverage.ambiguous).toBeGreaterThan(1_000)
    expect(coverage.ambiguousWithStatic).toBeGreaterThan(50)
    expect(coverage.winnerNotFirstCandidate).toBeGreaterThan(200)
    expect(coverage.compositeWinner).toBeGreaterThan(200)
    expect(coverage.emptySegmentRoutes).toBeGreaterThan(100)
  }, ORACLE_TIMEOUT_MS)

  it('agrees on API-shaped route sets for hits and misses across sizes', () => {
    const mismatches: Mismatch[] = []
    // Declared methods with one or several routes per path, plus an undeclared one.
    const methods: HttpMethod[] = ['get', 'post', 'patch', 'query']
    for (const routeCount of [7, 50, 300]) {
      const { index, staticHits, templatedHits, misses } = generateApiRouteSet(routeCount, routeCount)
      for (const urlPath of [...staticHits, ...templatedHits, ...misses]) {
        for (const method of methods) {
          const { mismatch } = compareWithOracle(index, method, urlPath)
          if (mismatch) mismatches.push(mismatch)
        }
      }
    }
    expect(mismatches.slice(0, 5)).toEqual([])
  }, ORACLE_TIMEOUT_MS)
})
