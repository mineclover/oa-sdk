import { describe, expect, it } from 'vitest'
import { getCachedRouteMatcher, HTTP_METHODS, matchRoute } from '../route-match.js'
import type { HttpMethod, MatchResult, RouteIndex } from '../types.js'
import { linearMatchRoute, listMatchingPatterns } from './support/linear-route-match.js'
import {
  changeRouteIndexInPlace,
  createRandom,
  generateAdversarialRouteIndex,
  generateApiRouteSet,
  generateRequestPaths,
  instantiatePattern,
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

function haveSameKeyOrder(left: RouteIndex, right: RouteIndex): boolean {
  const rightKeys = [...right.keys()]
  return left.size === right.size && [...left.keys()].every((key, position) => key === rightKeys[position])
}

/** The path that wins for `urlPath` whatever the method, per the linear reference. */
function winningPattern(index: RouteIndex, urlPath: string): string | undefined {
  const probe = linearMatchRoute(index, 'get', urlPath)
  if (probe.type === 'found') return probe.entry.openApiPath
  if (probe.type === 'not_found') return undefined
  const method = probe.allowed[0]
  const retry = method && linearMatchRoute(index, method, urlPath)
  return retry && retry.type === 'found' ? retry.entry.openApiPath : '(a path without methods)'
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

  it('agrees while the route index is changed in place between requests', () => {
    const random = createRandom(0x2c2_ca5e)
    const mismatches: Mismatch[] = []
    const coverage = { requests: 0, found: 0, sameSizeKeyChanges: 0, matcherReused: 0, matcherRebuilt: 0 }
    // The compiled matcher must be reused exactly when the paths and their order
    // are unchanged: a rebuild on an unchanged index loses the speedup, and
    // reuse after a key change would serve stale matches.
    const cacheMismatches: Array<{ kind: string; step: number; keysUnchanged: boolean }> = []
    const changeKinds = new Map<string, number>()
    const staleSensitiveByKind = new Map<string, number>()
    const increment = (counts: Map<string, number>, kind: string): void => {
      counts.set(kind, (counts.get(kind) ?? 0) + 1)
    }

    /**
     * Compares one request with the oracle. `before` is set after a same-size
     * change of the keys: a request whose winning path differs from the one in
     * the index before that change is one that a matcher still serving the old
     * key set would answer wrongly, so counting them shows the corpus can catch
     * a stale cache.
     */
    const request = (index: RouteIndex, urlPath: string, before?: { index: RouteIndex; kind: string }): void => {
      const method = random.chance(0.8) ? 'get' : random.pick(HTTP_METHODS)
      coverage.requests += 1
      const { expected, mismatch } = compareWithOracle(index, method, urlPath)
      if (mismatch) mismatches.push(mismatch)
      if (expected.type === 'found') coverage.found += 1
      if (before && winningPattern(before.index, urlPath) !== winningPattern(index, urlPath)) {
        increment(staleSensitiveByKind, before.kind)
      }
    }

    for (let run = 0; run < 150; run += 1) {
      const index = generateAdversarialRouteIndex(random)
      const sparePatterns = [...generateAdversarialRouteIndex(random).keys()]
      let matcherAfterRequests: object | undefined
      for (let step = 0; step < 25; step += 1) {
        // Warm the matcher's cache on the current key set before every change.
        for (const urlPath of generateRequestPaths(random, index, 2)) request(index, urlPath)
        // Nothing changed the keys since the previous step's requests.
        const matcherBeforeChange = getCachedRouteMatcher(index)
        if (matcherAfterRequests && matcherBeforeChange !== matcherAfterRequests) {
          cacheMismatches.push({ kind: 'no change', step, keysUnchanged: true })
        }

        const previous = new Map(index)
        const change = changeRouteIndexInPlace(random, index, sparePatterns)
        increment(changeKinds, change.kind)
        const sameSizeKeyChange = change.sameSize && !haveSameKeyOrder(previous, index)
        if (sameSizeKeyChange) coverage.sameSizeKeyChanges += 1
        // Requests for the paths the change touched, in either order, then others.
        const targeted = change.patterns.map(pattern => instantiatePattern(random, pattern))
        if (random.chance(0.5)) targeted.reverse()
        for (const urlPath of [...targeted, ...generateRequestPaths(random, index, 2)]) {
          request(index, urlPath, sameSizeKeyChange ? { index: previous, kind: change.kind } : undefined)
        }

        // Every step makes at least two requests after the change, so the cache
        // holds whatever matcher matchRoute settled on for the current keys.
        matcherAfterRequests = getCachedRouteMatcher(index)
        const keysUnchanged = haveSameKeyOrder(previous, index)
        if (keysUnchanged) coverage.matcherReused += 1
        else coverage.matcherRebuilt += 1
        if ((matcherAfterRequests === matcherBeforeChange) !== keysUnchanged) {
          cacheMismatches.push({ kind: change.kind, step, keysUnchanged })
        }
      }
    }

    expect(mismatches.slice(0, 5)).toEqual([])
    expect(cacheMismatches.slice(0, 5)).toEqual([])
    expect(coverage.found).toBeGreaterThan(5_000)
    expect(coverage.sameSizeKeyChanges).toBeGreaterThan(1_500)
    expect(coverage.matcherReused).toBeGreaterThan(300)
    expect(coverage.matcherRebuilt).toBeGreaterThan(2_500)
    for (const kind of ['add', 'remove', 'replace', 're-add', 'methods', 'refill']) {
      expect(changeKinds.get(kind) ?? 0, kind).toBeGreaterThan(100)
    }
    // Requests a stale key set would get wrong. Tie-break reorderings (re-add)
    // are rare in a random corpus; route-match.test.ts pins one explicitly.
    expect(staleSensitiveByKind.get('replace') ?? 0).toBeGreaterThan(500)
    expect(staleSensitiveByKind.get('refill') ?? 0).toBeGreaterThan(500)
    expect(staleSensitiveByKind.get('re-add') ?? 0).toBeGreaterThan(0)
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
