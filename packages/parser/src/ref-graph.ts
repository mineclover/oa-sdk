import type { OasDocument } from './oas32-types.js'
import {
  createRefResolver,
  type RefResolution,
  type RefResolverDiagnostic,
  type RefResolverDiagnosticCode,
  type RefResolverKind,
} from './ref-resolver.js'
import { getOwnString } from './safe-record.js'
import { countInstanceDescents } from './recursion-guard.js'

export { isRelativeRef, resolvePointer } from './ref-resolver.js'

export type RefKind = RefResolverKind

export type RefGraphDiagnosticCode = RefResolverDiagnosticCode

export type RefGraphDiagnostic = RefResolverDiagnostic

/**
 * One `$ref` occurrence in the entry document or a loaded external document.
 * `resolved` means the reference target exists; whether the occurrence closes
 * an unguarded cycle is reported separately as a `ref-cycle` diagnostic.
 */
export type RefGraphNode = {
  ref: string
  kind: RefKind
  sourcePointer: string
  sourceFilePath?: string
  resolved: boolean
  filePath?: string
  pointer?: string
  target?: unknown
}

export type RefGraph = {
  nodes: RefGraphNode[]
  diagnostics: RefGraphDiagnostic[]
}

export type RefGraphOptions = {
  basePath?: string
  lookupSourceLocation?: (filePath: string, pointer: string) => { line: number; column: number } | undefined
}

/** @internal Shared with `ref-projection.ts`. */
export type RefOccurrence = {
  ref: string
  sourcePointer: string
  basePath: string | undefined
  root: unknown
  resolution: RefResolution
}

/** @internal A reference from inside one target to another target. */
export type RefEdge = {
  from: string
  to: string
  /** Instance-descending keywords between the `from` target root and the occurrence. */
  descents: number
  occurrence: RefOccurrence
}

/**
 * Build the `$ref` graph of a document: one node per `$ref` occurrence, each
 * reference target visited once.
 *
 * A cycle is valid recursion when it crosses an instance-descending keyword
 * (`recursion-guard.ts`). Descent counts are non-negative, so an unguarded
 * cycle exists exactly when the edges with zero descents contain a cycle; every
 * occurrence on such a cycle gets a `ref-cycle` diagnostic.
 */
export function resolveRefGraph(spec: OasDocument | Record<string, unknown>, options: RefGraphOptions = {}): RefGraph {
  return analyzeRefGraph(spec, options).graph
}

/** @internal Occurrence-level analysis behind `resolveRefGraph`. */
export type RefGraphAnalysis = {
  graph: RefGraph
  /** Every `$ref` occurrence in discovery order (parallel to `graph.nodes`). */
  occurrences: RefOccurrence[]
  edges: RefEdge[]
  /** Occurrences on a cycle that never descends into the instance. */
  unguardedCycles: ReadonlySet<RefOccurrence>
  /** Occurrences on any cycle (valid recursion or unguarded). */
  cycles: ReadonlySet<RefOccurrence>
}

/** @internal */
export function analyzeRefGraph(spec: OasDocument | Record<string, unknown>, options: RefGraphOptions = {}): RefGraphAnalysis {
  const nodes: RefGraphNode[] = []
  const diagnostics: RefGraphDiagnostic[] = []
  const resolver = createRefResolver({
    ...(options.basePath ? { entryPath: options.basePath } : {}),
    ...(options.lookupSourceLocation ? { lookupSourceLocation: options.lookupSourceLocation } : {}),
  })
  const occurrences = new Map<string, RefOccurrence>()
  const visitedTargets = new Set<string>()
  const edges: RefEdge[] = []

  visitDocument(spec, '#', options.basePath, undefined, spec)
  const unguardedCycles = findCycleOccurrences(edges.filter(edge => edge.descents === 0))
  for (const occurrence of unguardedCycles) {
    const cycle = resolver.resolve({
      ref: occurrence.ref,
      sourcePointer: occurrence.sourcePointer,
      root: occurrence.root,
      ...(occurrence.basePath ? { basePath: occurrence.basePath } : {}),
      stack: [occurrence.resolution.cacheKey],
    })
    if (cycle.diagnostic) diagnostics.push(cycle.diagnostic)
  }
  return {
    graph: { nodes, diagnostics },
    occurrences: [...occurrences.values()],
    edges,
    unguardedCycles,
    cycles: findCycleOccurrences(edges),
  }

  /**
   * @param basePointer pointer of `document` inside its file
   * @param frameKey cacheKey of the target `document` was reached as; undefined for the entry document
   */
  function visitDocument(
    document: unknown,
    basePointer: string,
    basePath: string | undefined,
    frameKey: string | undefined,
    refRoot: unknown,
  ): void {
    collectRefs(document, basePointer, (ref, refPointer) => {
      const occurrence = recordOccurrence(ref, refPointer, basePath, refRoot)
      const { resolution } = occurrence
      if (!resolution.resolved) return

      if (frameKey !== undefined) {
        edges.push({
          from: frameKey,
          to: resolution.cacheKey,
          descents: countInstanceDescents(relativeSegments(basePointer, refPointer)),
          occurrence,
        })
      }
      if (visitedTargets.has(resolution.cacheKey)) return
      visitedTargets.add(resolution.cacheKey)
      visitDocument(
        resolution.target,
        resolution.pointer ?? ref,
        resolution.basePath ?? basePath,
        resolution.cacheKey,
        resolution.documentRoot ?? refRoot,
      )
    })
  }

  function recordOccurrence(
    ref: string,
    sourcePointer: string,
    basePath: string | undefined,
    root: unknown,
  ): RefOccurrence {
    const key = `${basePath ?? ''}\u0000${sourcePointer}`
    const existing = occurrences.get(key)
    if (existing) return existing

    const resolution = resolver.resolve({ ref, sourcePointer, root, ...(basePath ? { basePath } : {}) })
    const occurrence: RefOccurrence = { ref, sourcePointer, basePath, root, resolution }
    occurrences.set(key, occurrence)
    nodes.push(toGraphNode(resolution))
    if (resolution.diagnostic) diagnostics.push(resolution.diagnostic)
    return occurrence
  }
}

/** Occurrences whose edge lies on a cycle of `edges`, in edge order. */
function findCycleOccurrences(edges: readonly RefEdge[]): Set<RefOccurrence> {
  const component = stronglyConnectedComponents(edges)
  const cyclic = new Set<RefOccurrence>()
  for (const edge of edges) {
    const from = component.get(edge.from)
    if (from === undefined || from !== component.get(edge.to)) continue
    if (edge.from === edge.to || from.size > 1) cyclic.add(edge.occurrence)
  }
  return cyclic
}

/** Iterative Tarjan SCC over edge endpoints; maps each vertex to its component. */
function stronglyConnectedComponents(edges: readonly RefEdge[]): Map<string, Set<string>> {
  const adjacency = new Map<string, string[]>()
  for (const edge of edges) {
    const targets = adjacency.get(edge.from) ?? []
    targets.push(edge.to)
    adjacency.set(edge.from, targets)
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, [])
  }

  const index = new Map<string, number>()
  const lowLink = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const component = new Map<string, Set<string>>()
  let nextIndex = 0

  for (const root of adjacency.keys()) {
    if (index.has(root)) continue
    const work: Array<{ vertex: string; next: number }> = [{ vertex: root, next: 0 }]
    index.set(root, nextIndex)
    lowLink.set(root, nextIndex)
    nextIndex += 1
    stack.push(root)
    onStack.add(root)

    while (work.length > 0) {
      const frame = work[work.length - 1]!
      const successors = adjacency.get(frame.vertex)!
      if (frame.next < successors.length) {
        const successor = successors[frame.next]!
        frame.next += 1
        if (!index.has(successor)) {
          index.set(successor, nextIndex)
          lowLink.set(successor, nextIndex)
          nextIndex += 1
          stack.push(successor)
          onStack.add(successor)
          work.push({ vertex: successor, next: 0 })
        } else if (onStack.has(successor)) {
          lowLink.set(frame.vertex, Math.min(lowLink.get(frame.vertex)!, index.get(successor)!))
        }
        continue
      }

      work.pop()
      const parent = work[work.length - 1]
      if (parent) lowLink.set(parent.vertex, Math.min(lowLink.get(parent.vertex)!, lowLink.get(frame.vertex)!))
      if (lowLink.get(frame.vertex) !== index.get(frame.vertex)) continue

      const members = new Set<string>()
      let member: string
      do {
        member = stack.pop()!
        onStack.delete(member)
        members.add(member)
        component.set(member, members)
      } while (member !== frame.vertex)
    }
  }
  return component
}

/** `refPointer`(`.../$ref`)가 가리키는 객체까지의 경로를 `basePointer` 기준 세그먼트로 반환. */
function relativeSegments(basePointer: string, refPointer: string): string[] {
  const objectPointer = refPointer.slice(0, -'/$ref'.length)
  if (objectPointer.length <= basePointer.length) return []
  return objectPointer
    .slice(basePointer.length + 1)
    .split('/')
    .map(segment => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
}

export function collectRefs(node: unknown, sourcePointer: string, onRef: (ref: string, sourcePointer: string) => void): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    node.forEach((item, index) => collectRefs(item, `${sourcePointer}/${index}`, onRef))
    return
  }

  const obj = node as Record<string, unknown>
  const ref = getOwnString(obj, '$ref')
  if (ref !== undefined) {
    onRef(ref, `${sourcePointer}/$ref`)
  }

  for (const [key, value] of Object.entries(obj)) {
    collectRefs(value, `${sourcePointer}/${escapePointer(key)}`, onRef)
  }
}

function escapePointer(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1')
}

function toGraphNode(resolution: RefResolution): RefGraphNode {
  return {
    ref: resolution.ref,
    kind: resolution.kind,
    sourcePointer: resolution.sourcePointer,
    ...(resolution.sourceFilePath ? { sourceFilePath: resolution.sourceFilePath } : {}),
    resolved: resolution.resolved,
    ...(resolution.filePath ? { filePath: resolution.filePath } : {}),
    ...(resolution.pointer ? { pointer: resolution.pointer } : {}),
    ...(resolution.resolved ? { target: resolution.target } : {}),
  }
}
