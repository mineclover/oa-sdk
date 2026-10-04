/**
 * Route matching benchmark: linear regex reference vs the indexed matcher.
 *
 * Run from the repository root:
 *   node --import tsx packages/parser/src/__tests__/support/route-match-benchmark.ts
 *
 * For each route-set size it reports the median per-call time of `matchRoute`
 * for concrete-path hits, templated-path hits, misses, and an interleaved mix,
 * plus the median cost of the first call on a fresh RouteIndex (which compiles
 * the per-index cache). Both matchers see identical inputs, and their results
 * are checked for equality before timing.
 */
import { performance } from 'node:perf_hooks'
import { matchRoute } from '../../route-match.js'
import type { HttpMethod, MatchResult, RouteIndex } from '../../types.js'
import { linearMatchRoute } from './linear-route-match.js'
import { generateApiRouteSet } from './route-corpus.js'

type Matcher = (index: RouteIndex, method: HttpMethod, urlPath: string) => MatchResult

const ROUTE_COUNTS = [50, 500, 2000]
const SAMPLES = 15
const TARGET_SAMPLE_MS = 25
const COLD_SAMPLES = 9

const MATCHERS: ReadonlyArray<readonly [string, Matcher]> = [
  ['linear', linearMatchRoute],
  ['indexed', matchRoute],
]

let checksum = 0

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

function runCalls(match: Matcher, index: RouteIndex, paths: string[], calls: number): void {
  for (let call = 0; call < calls; call += 1) {
    if (match(index, 'get', paths[call % paths.length]!).type === 'found') checksum += 1
  }
}

/** Median per-call microseconds over samples sized to take about TARGET_SAMPLE_MS each. */
function measurePerCall(match: Matcher, index: RouteIndex, paths: string[]): number {
  runCalls(match, index, paths, paths.length * 3)
  let calls = paths.length
  for (;;) {
    const start = performance.now()
    runCalls(match, index, paths, calls)
    if (performance.now() - start >= TARGET_SAMPLE_MS) break
    calls *= 2
  }
  const samples: number[] = []
  for (let sample = 0; sample < SAMPLES; sample += 1) {
    const start = performance.now()
    runCalls(match, index, paths, calls)
    samples.push(((performance.now() - start) * 1000) / calls)
  }
  return median(samples)
}

/** Median microseconds of the first call on a fresh RouteIndex (cache compile included). */
function measureFirstCall(match: Matcher, index: RouteIndex, path: string): number {
  const samples: number[] = []
  for (let sample = 0; sample < COLD_SAMPLES; sample += 1) {
    const fresh: RouteIndex = new Map(index)
    const start = performance.now()
    if (match(fresh, 'get', path).type === 'found') checksum += 1
    samples.push((performance.now() - start) * 1000)
  }
  return median(samples)
}

function interleave(...lists: string[][]): string[] {
  const result: string[] = []
  const length = Math.max(...lists.map(list => list.length))
  for (let i = 0; i < length; i += 1) {
    for (const list of lists) if (i < list.length) result.push(list[i]!)
  }
  return result
}

function assertSameResults(index: RouteIndex, paths: string[]): void {
  for (const path of paths) {
    const expected = JSON.stringify(linearMatchRoute(index, 'get', path))
    const actual = JSON.stringify(matchRoute(index, 'get', path))
    if (expected !== actual) throw new Error(`matchers disagree on ${path}: ${expected} vs ${actual}`)
  }
}

const format = (value: number): string => value >= 100 ? value.toFixed(0) : value.toFixed(2)

console.log(`node ${process.version}, ${SAMPLES} samples of ~${TARGET_SAMPLE_MS} ms, median per call (µs)`)
console.log('| routes | scenario | linear µs | indexed µs | speedup |')
console.log('|---:|---|---:|---:|---:|')
for (const routeCount of ROUTE_COUNTS) {
  const { index, staticHits, templatedHits, misses } = generateApiRouteSet(routeCount, routeCount)
  const scenarios: ReadonlyArray<readonly [string, string[]]> = [
    ['static hit', staticHits],
    ['templated hit', templatedHits],
    ['miss', misses],
    ['mixed', interleave(staticHits, templatedHits, misses)],
  ]
  assertSameResults(index, scenarios.flatMap(([, paths]) => paths))

  for (const [scenario, paths] of scenarios) {
    const [linear, indexed] = MATCHERS.map(([, match]) => measurePerCall(match, index, paths))
    console.log(`| ${routeCount} | ${scenario} | ${format(linear!)} | ${format(indexed!)} | ${(linear! / indexed!).toFixed(1)}x |`)
  }
  const [linearCold, indexedCold] = MATCHERS.map(([, match]) => measureFirstCall(match, index, templatedHits[0]!))
  console.log(`| ${routeCount} | first call (cache build) | ${format(linearCold!)} | ${format(indexedCold!)} | ${(linearCold! / indexedCold!).toFixed(1)}x |`)
}
console.log(`checksum ${checksum}`)
