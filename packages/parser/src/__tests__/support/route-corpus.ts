/**
 * Deterministic route-set and request-path generators for route matching tests
 * and benchmarks. Everything is driven by a seeded PRNG so failures reproduce.
 */
import type { HttpMethod, OperationEntry, RouteIndex } from '../../types.js'

export type Random = {
  next(): number
  int(maxExclusive: number): number
  pick<T>(items: readonly T[]): T
  chance(probability: number): boolean
}

/** mulberry32: small, fast, and good enough for corpus generation. */
export function createRandom(seed: number): Random {
  let state = seed >>> 0
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: maxExclusive => Math.floor(next() * maxExclusive),
    pick: items => items[Math.floor(next() * items.length)]!,
    chance: probability => next() < probability,
  }
}

const ROUTE_METHODS: readonly HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete']

export function createOperationEntry(openApiPath: string, method: HttpMethod): OperationEntry {
  return {
    operationId: `${method} ${openApiPath}`,
    openApiPath,
    method,
    tags: [],
    deprecated: false,
    parameters: [],
    responses: {},
    security: [],
    servers: [],
    callbacks: {},
  }
}

export function createRouteIndex(routes: ReadonlyArray<readonly [string, readonly HttpMethod[]]>): RouteIndex {
  const index: RouteIndex = new Map()
  for (const [pattern, methods] of routes) {
    index.set(pattern, new Map(methods.map(method => [method, createOperationEntry(pattern, method)])))
  }
  return index
}

// ─── Adversarial corpus (oracle equivalence) ────────────────────────────────

/** Literal segments, including regex metacharacters, encodings, case variants, and stray braces. */
const LITERAL_SEGMENTS = [
  'users', 'Users', 'me', 'files', 'v1', 'v1.0', 'items', 'a', 'b', 'json',
  'café', 'caf%C3%A9', '%20', 'x-y', '$ref', '(x)', 'a+b', '*', '[0]', '.', '..',
  '{}', '{', '}', '__proto__',
] as const

/** Segments holding expressions: bare, partial, several per segment, and odd names. */
const TEMPLATED_SEGMENTS = [
  '{id}', '{userId}', '{id}', '{name}.{ext}', '{a}{b}', 'v{version}', '{id}.json',
  'pre-{x}-post', '{x}-{y}-{z}', '{{x}}', '{a/b}', '{file}.tar.gz', '{name}.{ext}.{gz}',
  '{__proto__}', '{constructor}', '{id}{id}', '{a//b}', '{/id}',
] as const

/** Parameter values for building matching paths: never empty, never containing `/`. */
const PARAM_VALUES = [
  '1', '42', 'abc', 'me', 'users', 'a.b', 'a.b.c', 'archive.tar.gz', 'x-y-z', 'pre-1-post',
  '%2F', '%20', 'caf%C3%A9', 'café', '..', '.', 'json', 'v1', '{id}', 'ü', '😀',
  'a?b', 'a#b', 'a b', 'A', '__proto__',
] as const

function generatePattern(random: Random): string {
  const segmentCount = random.int(6)
  const segments: string[] = []
  for (let i = 0; i < segmentCount; i += 1) {
    const roll = random.next()
    if (roll < 0.55) segments.push(random.pick(LITERAL_SEGMENTS))
    else if (roll < 0.94) segments.push(random.pick(TEMPLATED_SEGMENTS))
    else segments.push('')
  }
  let pattern = (random.chance(0.95) ? '/' : '') + segments.join('/')
  if (random.chance(0.1)) pattern += '/'
  return pattern
}

/** A variant of `pattern` that overlaps it: one segment swapped for a literal, template, or neighbor. */
function overlapPattern(random: Random, pattern: string): string {
  const segments = pattern.split('/')
  const position = random.int(segments.length)
  segments[position] = random.chance(0.5) ? random.pick(TEMPLATED_SEGMENTS) : random.pick(LITERAL_SEGMENTS)
  if (random.chance(0.2)) segments.push(random.pick(TEMPLATED_SEGMENTS))
  return segments.join('/')
}

function generateMethods(random: Random): HttpMethod[] {
  if (random.chance(0.03)) return []
  const methods = ROUTE_METHODS.filter(() => random.chance(0.4))
  return methods.length > 0 ? methods : [random.pick(ROUTE_METHODS)]
}

export function generateAdversarialRouteIndex(random: Random): RouteIndex {
  const patterns: string[] = []
  const baseCount = 3 + random.int(25)
  for (let i = 0; i < baseCount; i += 1) {
    patterns.push(patterns.length > 0 && random.chance(0.45)
      ? overlapPattern(random, random.pick(patterns))
      : generatePattern(random))
  }
  return createRouteIndex(patterns.map(pattern => [pattern, generateMethods(random)] as const))
}

const TEMPLATE_EXPRESSION = /\{[^{}]+\}/g

/** A concrete path the template should match, built by filling every expression. */
export function instantiatePattern(random: Random, pattern: string): string {
  return pattern.replace(TEMPLATE_EXPRESSION, () => random.pick(PARAM_VALUES))
}

/** Small edits that turn a matching path into a near miss (or a hit for a sibling route). */
const NEAR_MISS_MUTATIONS: ReadonlyArray<(random: Random, path: string) => string> = [
  (_, path) => `${path}/`,
  (_, path) => path.endsWith('/') ? path.slice(0, -1) : `${path}//`,
  (_, path) => path.toUpperCase(),
  (_, path) => path.toLowerCase(),
  (random, path) => `${path}/${random.pick(PARAM_VALUES)}`,
  (_, path) => path.slice(0, Math.max(0, path.lastIndexOf('/'))),
  (_, path) => path.replace('/', '//'),
  (_, path) => path.replaceAll('/', '%2F'),
  (_, path) => path.replaceAll('%20', ' ').replaceAll('%C3%A9', 'é'),
  (_, path) => encodeURI(path),
  (_, path) => `/api${path}`,
  (_, path) => path.slice(1),
  (random, path) => {
    const segments = path.split('/')
    segments[random.int(segments.length)] = ''
    return segments.join('/')
  },
  (random, path) => {
    const segments = path.split('/')
    segments[random.int(segments.length)] = random.pick(LITERAL_SEGMENTS)
    return segments.join('/')
  },
]

export function generateRequestPaths(random: Random, index: RouteIndex, count: number): string[] {
  const patterns = [...index.keys()]
  const paths: string[] = []
  for (let i = 0; i < count; i += 1) {
    const roll = random.next()
    if (roll < 0.5 && patterns.length > 0) {
      paths.push(instantiatePattern(random, random.pick(patterns)))
    } else if (roll < 0.85 && patterns.length > 0) {
      const mutate = random.pick(NEAR_MISS_MUTATIONS)
      paths.push(mutate(random, instantiatePattern(random, random.pick(patterns))))
    } else {
      const segmentCount = random.int(6)
      const segments = Array.from({ length: segmentCount }, () =>
        random.chance(0.5) ? random.pick(LITERAL_SEGMENTS) : random.pick(PARAM_VALUES))
      paths.push(`/${segments.join('/')}`)
    }
  }
  return paths
}

// ─── API-shaped corpus (benchmarks) ─────────────────────────────────────────

export type ApiRouteSet = {
  index: RouteIndex
  /** Requests for template-free paths. */
  staticHits: string[]
  /** Requests answered by templated paths, including partial-segment ones. */
  templatedHits: string[]
  /** Requests that match no path. */
  misses: string[]
}

/**
 * A REST-like API with about `routeCount` paths, roughly 40% template-free:
 * collections, items, sub-collections, `{id}.{format}` exports, and literal
 * siblings (`/search`) that overlap item templates.
 */
export function generateApiRouteSet(routeCount: number, seed = 1): ApiRouteSet {
  const random = createRandom(seed)
  const routes: Array<readonly [string, readonly HttpMethod[]]> = []
  const staticHits: string[] = []
  const templatedHits: string[] = []
  const misses: string[] = []
  /** Adds the route while there is room and, if it was added, its sample requests. */
  const add = (pattern: string, methods: readonly HttpMethod[], hits: string[], requests: string[]): void => {
    if (routes.length >= routeCount) return
    routes.push([pattern, methods])
    hits.push(...requests)
  }

  for (let resource = 0; routes.length < routeCount; resource += 1) {
    const base = `/api/v${1 + (resource % 3)}/resource${resource}`
    const id = `id_${random.int(1_000_000)}`
    add(base, ['get', 'post'], staticHits, [base])
    add(`${base}/{resource${resource}Id}`, ['get', 'put', 'delete'], templatedHits, [`${base}/${id}`])
    add(`${base}/search`, ['get'], staticHits, [`${base}/search`])
    add(`${base}/{id}/items`, ['get', 'post'], templatedHits, [`${base}/${id}/items`])
    add(`${base}/{id}/items/{itemId}`, ['get', 'patch'], templatedHits, [`${base}/${id}/items/${random.int(1000)}`])
    add(`${base}/{id}.{format}`, ['get'], templatedHits, [`${base}/${id}.json`])
    add(`${base}/{id}/status`, ['get'], templatedHits, [`${base}/${id}/status`])
    misses.push(`${base}/${id}/unknown`, `${base}/`, `/api/v9/resource${resource}`)
  }

  return { index: createRouteIndex(routes), staticHits, templatedHits, misses }
}
