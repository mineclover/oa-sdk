import type { HttpMethod, MatchResult, RouteIndex } from './types.js'
import { createSafeRecord } from './safe-record.js'

export const HTTP_METHODS: HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace', 'query']

/*
 * Route matching for a RouteIndex.
 *
 * Matching semantics (pinned against a linear regex reference by
 * route-match-oracle.test.ts):
 * - A path template expression `{name}` matches one or more characters other
 *   than `/`. Everything else in the template is matched literally and
 *   case-sensitively. The request path is used as given: no trailing-slash
 *   folding, no percent-decoding, and captured parameters are returned raw.
 * - Several expressions in one segment (`{name}.{ext}`) split that segment the
 *   way a backtracking regex with greedy groups does: an earlier parameter takes
 *   as many characters as it can while the rest of the segment still matches.
 * - When several templates match, the most specific one wins: segment kinds are
 *   compared left to right (a literal segment beats a templated one), then the
 *   template with fewer expressions, then the one with more literal characters,
 *   then declaration order. Concrete paths therefore beat templated ones, as
 *   OpenAPI requires. Segment kinds come from splitting the raw template at
 *   every `/`, including one inside an expression name such as `{a/b}`; that
 *   legacy ranking is kept as is.
 * - The method is checked only against the winning path, so a more specific
 *   path that lacks the method yields `method_not_allowed` even when a less
 *   specific path defines it.
 *
 * Instead of testing every route regex per request, the index is compiled once
 * per RouteIndex into an exact-path Map (template-free paths) and a segment trie
 * (templated paths). Segments that are a single bare expression become one
 * wildcard edge; only segments that mix literals and expressions, or hold
 * several expressions, keep a per-segment regex. Every route gets a precomputed
 * rank from the specificity order above, so choosing the winner is an integer
 * comparison and trie branches that cannot beat the current winner are pruned.
 *
 * RouteIndex is a mutable Map, and the linear matcher this replaced re-read it
 * on every call, so changes made in place must keep taking effect. The compiled
 * matcher records the paths it was built from, in order, and each call compares
 * them with the live keys before using it. That is one string comparison per
 * path with no regex work; any difference, including a path deleted and re-added
 * (which moves it last in declaration order), rebuilds the matcher. Method maps
 * are not compiled at all: they are always read from the index.
 */

type RouteSpecificity = {
  /** Literal segments (1) beat template segments (0) at the same position. */
  segmentKinds: number[]
  templateCount: number
  literalCharacterCount: number
}

type CompiledRoute = {
  pattern: string
  paramNames: string[]
  /** Position in the specificity order: lower ranks win. Unique per matcher. */
  rank: number
}

/** How one segment of a template (split at `/` outside expressions) matches. */
type SegmentShape =
  | { kind: 'literal'; text: string }
  | { kind: 'param' }
  | { kind: 'composite'; source: string; captureCount: number }

type ParsedTemplate = {
  segments: SegmentShape[]
  paramNames: string[]
  specificity: RouteSpecificity
}

type SegmentNode = {
  /** Lowest rank of any route in this subtree; Infinity when it holds none. */
  minRank: number
  /** Most specific route whose template ends at this node. */
  route: CompiledRoute | undefined
  literals: Map<string, SegmentNode> | undefined
  /** Edge for a segment that is exactly one `{name}` expression. */
  param: SegmentNode | undefined
  /** Edges for segments mixing literals and expressions, best subtree first. */
  composites: CompositeEdge[] | undefined
}

type CompositeEdge = {
  regex: RegExp
  captureCount: number
  node: SegmentNode
}

type RouteMatcher = {
  /** RouteIndex keys in iteration (declaration) order when the matcher was built. */
  patterns: readonly string[]
  exact: Map<string, CompiledRoute>
  root: SegmentNode
}

type RouteHit = {
  route: CompiledRoute
  values: readonly string[]
}

type SearchState = {
  best: CompiledRoute | undefined
  bestRank: number
  values: readonly string[]
}

const TEMPLATE_EXPRESSION = /\{([^{}]+)\}/g
const CONTAINS_TEMPLATE_EXPRESSION = /\{[^{}]+\}/
const EMPTY_VALUES: readonly string[] = Object.freeze([])

/** Compiled matchers keyed by RouteIndex identity, revalidated on every call. */
const matcherCache = new WeakMap<RouteIndex, RouteMatcher>()

/**
 * Finds the operation that handles `method` on `urlPath` in a RouteIndex.
 *
 * `urlPath` is matched as given, so callers strip any server base path and query
 * string first; trailing slashes are significant and parameters are returned
 * without percent-decoding. When several paths match, the most specific one wins
 * (concrete paths beat templated ones), and the method is checked on that path
 * only, so `method_not_allowed` lists the winning path's methods.
 *
 * The index is compiled into a lookup structure on first use and cached per
 * RouteIndex object. The index may still be changed in place: each call checks
 * that it holds the same paths in the same order (one string comparison per
 * path) and recompiles it if not, and method maps are read live.
 */
export function matchRoute(
  index: RouteIndex,
  method: HttpMethod,
  urlPath: string,
): MatchResult {
  const hit = findRoute(getRouteMatcher(index), urlPath)
  // The matcher's paths equal the live keys, so the winner's method map exists.
  const methodMap = hit && index.get(hit.route.pattern)
  if (!hit || !methodMap) return { type: 'not_found' }

  const entry = methodMap.get(method)
  if (entry) return { type: 'found', entry, pathParams: buildParams(hit) }
  return { type: 'method_not_allowed', allowed: [...methodMap.keys()] }
}

function getRouteMatcher(index: RouteIndex): RouteMatcher {
  const cached = matcherCache.get(index)
  if (cached && hasSamePatterns(index, cached.patterns)) return cached
  const matcher = buildRouteMatcher(index)
  matcherCache.set(index, matcher)
  return matcher
}

/**
 * True when the index's keys are exactly `patterns`, in the same order. Order
 * matters because declaration order breaks specificity ties. A Map exposes no
 * version, so a same-size change (one path swapped for another, or a path
 * deleted and re-added) is only visible by comparing every key.
 */
function hasSamePatterns(index: RouteIndex, patterns: readonly string[]): boolean {
  if (index.size !== patterns.length) return false
  let position = 0
  for (const pattern of index.keys()) {
    if (pattern !== patterns[position]) return false
    position += 1
  }
  return true
}

function buildRouteMatcher(index: RouteIndex): RouteMatcher {
  const patterns = [...index.keys()]
  // Rank = position in the specificity order, declaration order breaking ties.
  const ranked = patterns
    .map((pattern, order) => ({ pattern, order, template: parseTemplate(pattern) }))
    .sort((left, right) =>
      compareRouteSpecificity(right.template.specificity, left.template.specificity) || left.order - right.order)

  const exact = new Map<string, CompiledRoute>()
  const trie = new SegmentTrieBuilder()
  ranked.forEach(({ pattern, template }, rank) => {
    const route: CompiledRoute = { pattern, paramNames: template.paramNames, rank }
    if (template.paramNames.length === 0) exact.set(pattern, route)
    else trie.insert(template.segments, route)
  })
  return { patterns, exact, root: trie.finish() }
}

function parseTemplate(pattern: string): ParsedTemplate {
  const segments = new SegmentShapeBuilder()
  const paramNames: string[] = []
  let cursor = 0
  for (const match of pattern.matchAll(TEMPLATE_EXPRESSION)) {
    segments.appendLiteral(pattern.slice(cursor, match.index))
    segments.appendParam()
    paramNames.push(match[1]!)
    cursor = match.index + match[0].length
  }
  segments.appendLiteral(pattern.slice(cursor))

  const segmentKinds: number[] = []
  for (const segment of pattern.split('/')) {
    if (segment) segmentKinds.push(CONTAINS_TEMPLATE_EXPRESSION.test(segment) ? 0 : 1)
  }
  return {
    segments: segments.finish(),
    paramNames,
    specificity: {
      segmentKinds,
      templateCount: paramNames.length,
      literalCharacterCount: segments.literalCharacterCount,
    },
  }
}

/**
 * Splits a template into segment shapes. Only `/` in literal text separates
 * segments: an expression never matches `/`, so every segment of a matching
 * request lines up with exactly one template segment.
 */
class SegmentShapeBuilder {
  literalCharacterCount = 0
  private readonly shapes: SegmentShape[] = []
  /** All literal text of the open segment. */
  private literal = ''
  /** Regex source of the open segment up to its last expression. */
  private source = ''
  /** Literal text after the last expression, not yet escaped into `source`. */
  private pendingLiteral = ''
  private captureCount = 0

  appendLiteral(text: string): void {
    this.literalCharacterCount += text.length
    let start = 0
    for (let slash = text.indexOf('/'); slash !== -1; slash = text.indexOf('/', start)) {
      this.appendSegmentText(text.slice(start, slash))
      this.closeSegment()
      start = slash + 1
    }
    this.appendSegmentText(text.slice(start))
  }

  appendParam(): void {
    this.source += `${escapeRegExp(this.pendingLiteral)}([^/]+)`
    this.pendingLiteral = ''
    this.captureCount += 1
  }

  finish(): SegmentShape[] {
    this.closeSegment()
    return this.shapes
  }

  private appendSegmentText(text: string): void {
    this.literal += text
    this.pendingLiteral += text
  }

  private closeSegment(): void {
    if (this.captureCount === 0) {
      this.shapes.push({ kind: 'literal', text: this.literal })
    } else if (this.captureCount === 1 && this.literal === '') {
      this.shapes.push({ kind: 'param' })
    } else {
      const source = `^${this.source}${escapeRegExp(this.pendingLiteral)}$`
      this.shapes.push({ kind: 'composite', source, captureCount: this.captureCount })
    }
    this.literal = ''
    this.source = ''
    this.pendingLiteral = ''
    this.captureCount = 0
  }
}

function compareRouteSpecificity(left: RouteSpecificity, right: RouteSpecificity): number {
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

function createNode(): SegmentNode {
  return { minRank: Infinity, route: undefined, literals: undefined, param: undefined, composites: undefined }
}

/** Builds the segment trie for templated paths, inserting routes in any order. */
class SegmentTrieBuilder {
  private readonly root = createNode()
  /** Composite edges per node, keyed by regex source so equal shapes share a branch. */
  private readonly compositeEdges = new Map<SegmentNode, Map<string, CompositeEdge>>()

  insert(segments: SegmentShape[], route: CompiledRoute): void {
    let node = this.root
    node.minRank = Math.min(node.minRank, route.rank)
    for (const shape of segments) {
      node = this.childFor(node, shape)
      node.minRank = Math.min(node.minRank, route.rank)
    }
    // Templates that end at the same node have the same shape and match exactly
    // the same paths, so only the most specific (lowest-ranked) one can win.
    if (!node.route || route.rank < node.route.rank) node.route = route
  }

  /** Orders composite edges so the most promising branch is searched first. */
  finish(): SegmentNode {
    for (const node of this.compositeEdges.keys()) {
      node.composites!.sort((left, right) => left.node.minRank - right.node.minRank)
    }
    return this.root
  }

  private childFor(node: SegmentNode, shape: SegmentShape): SegmentNode {
    switch (shape.kind) {
      case 'literal': {
        node.literals ??= new Map()
        let child = node.literals.get(shape.text)
        if (!child) {
          child = createNode()
          node.literals.set(shape.text, child)
        }
        return child
      }
      case 'param':
        node.param ??= createNode()
        return node.param
      case 'composite': {
        let edges = this.compositeEdges.get(node)
        if (!edges) {
          edges = new Map()
          this.compositeEdges.set(node, edges)
        }
        let edge = edges.get(shape.source)
        if (!edge) {
          edge = { regex: new RegExp(shape.source), captureCount: shape.captureCount, node: createNode() }
          edges.set(shape.source, edge)
          ;(node.composites ??= []).push(edge)
        }
        return edge.node
      }
    }
  }
}

function findRoute(matcher: RouteMatcher, urlPath: string): RouteHit | undefined {
  const exact = matcher.exact.get(urlPath)
  const state: SearchState = {
    best: exact,
    bestRank: exact ? exact.rank : Infinity,
    values: EMPTY_VALUES,
  }
  if (matcher.root.minRank < state.bestRank) {
    searchNode(matcher.root, urlPath.split('/'), 0, [], state)
  }
  return state.best ? { route: state.best, values: state.values } : undefined
}

function searchNode(
  node: SegmentNode,
  segments: string[],
  depth: number,
  values: string[],
  state: SearchState,
): void {
  if (node.minRank >= state.bestRank) return
  if (depth === segments.length) {
    const route = node.route
    if (route && route.rank < state.bestRank) {
      state.best = route
      state.bestRank = route.rank
      state.values = values.slice()
    }
    return
  }

  const segment = segments[depth]!
  const literal = node.literals?.get(segment)
  if (literal) searchNode(literal, segments, depth + 1, values, state)

  if (node.param && segment.length > 0) {
    values.push(segment)
    searchNode(node.param, segments, depth + 1, values, state)
    values.pop()
  }

  if (node.composites) {
    for (const edge of node.composites) {
      if (edge.node.minRank >= state.bestRank) continue
      const match = edge.regex.exec(segment)
      if (!match) continue
      for (let group = 1; group <= edge.captureCount; group += 1) values.push(match[group]!)
      searchNode(edge.node, segments, depth + 1, values, state)
      values.length -= edge.captureCount
    }
  }
}

function buildParams(hit: RouteHit): Record<string, string> {
  const params = createSafeRecord<string>()
  const { paramNames } = hit.route
  for (let i = 0; i < paramNames.length; i += 1) {
    params[paramNames[i]!] = hit.values[i]!
  }
  return params
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
