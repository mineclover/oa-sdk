import { escapeJsonPointerToken, unescapeJsonPointerToken, type OasSchema } from '@oa-sdk/parser'
interface ObjectCycle {
  pointer: string
  targetPointer: string
  parent: Record<string, unknown> | unknown[]
  keyOrIndex: string | number
}

function findObjectCycles(root: unknown): ObjectCycle[] {
  if (!root || typeof root !== 'object') return []
  const cycles: ObjectCycle[] = []
  const stack: Array<{ node: unknown; pointer: string }> = []

  function walk(
    node: unknown,
    pointer: string,
    parent?: Record<string, unknown> | unknown[],
    keyOrIndex?: string | number,
  ): void {
    if (!node || typeof node !== 'object') return
    const match = stack.find(entry => entry.node === node)
    if (match) {
      cycles.push({
        pointer: pointer || '/',
        targetPointer: match.pointer || '/',
        parent: parent!,
        keyOrIndex: keyOrIndex!,
      })
      return
    }

    stack.push({ node, pointer })
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        walk(node[i], `${pointer}/${i}`, node, i)
      }
    } else {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        const escaped = escapeJsonPointerToken(k)
        walk(v, `${pointer}/${escaped}`, node as Record<string, unknown>, k)
      }
    }
    stack.pop()
  }

  walk(root, '')
  return cycles
}

const GLOBAL_SCHEMA_REF_CACHE = new WeakMap<object, Set<string>>()
const EMPTY_REF_SET: ReadonlySet<string> = new Set<string>()

/**
 * Fast-path extraction of schema target name from a $ref pointer.
 * Matches #/components/schemas/<Target> and #/schemas/<Target> without regex allocations.
 */
export function parseRefTarget(ref: unknown): string | null {
  if (typeof ref !== 'string') return null
  let raw: string | null = null
  if (ref.startsWith('#/components/schemas/')) {
    raw = ref.slice(21)
  } else if (ref.startsWith('#/schemas/')) {
    raw = ref.slice(10)
  }
  if (!raw || raw.length === 0) return null
  try {
    return unescapeJsonPointerToken(decodeURIComponent(raw))
  } catch {
    return unescapeJsonPointerToken(raw)
  }
}

/**
 * Traverses an AST node and extracts all referenced component schema names.
 * Uses WeakMap memoization to eliminate redundant traversals and an active stack set
 * to guard against cyclic object graph loops.
 */
export function extractRefsFromNode(
  node: unknown,
  cache: WeakMap<object, Set<string>> = GLOBAL_SCHEMA_REF_CACHE,
  activeStack: Set<unknown> = new Set<unknown>(),
): Set<string> {
  if (!node || typeof node !== 'object') {
    return EMPTY_REF_SET as Set<string>
  }

  const cached = cache.get(node)
  if (cached !== undefined) {
    return cached
  }

  if (activeStack.has(node)) {
    return EMPTY_REF_SET as Set<string>
  }

  activeStack.add(node)
  const refs = new Set<string>()

  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const item = node[i]
      if (item && typeof item === 'object') {
        const childRefs = extractRefsFromNode(item, cache, activeStack)
        for (const r of childRefs) {
          refs.add(r)
        }
      }
    }
  } else {
    const obj = node as Record<string, unknown>
    const refVal = obj['$ref']
    if (typeof refVal === 'string') {
      const target = parseRefTarget(refVal)
      if (target !== null) {
        refs.add(target)
      }
    }

    for (const key of Object.keys(obj)) {
      if (key !== '$ref') {
        const val = obj[key]
        if (val && typeof val === 'object') {
          const childRefs = extractRefsFromNode(val, cache, activeStack)
          for (const r of childRefs) {
            refs.add(r)
          }
        }
      }
    }
  }

  activeStack.delete(node)
  cache.set(node, refs)
  return refs
}

/**
 * Identifies all schemas in components.schemas that participate in a directed reference cycle.
 * Uses Tarjan's Strongly Connected Components (SCC) linear O(V + E) algorithm and memoized
 * $ref extraction to eliminate exponential/quadratic traversal blowup.
 */
export function findCircularSchemas(
  schemas: Record<string, OasSchema>,
  cache: WeakMap<object, Set<string>> = GLOBAL_SCHEMA_REF_CACHE,
): Set<string> {
  const graph = new Map<string, Set<string>>()
  const activeStack = new Set<unknown>()

  for (const [name, s] of Object.entries(schemas)) {
    const refs = extractRefsFromNode(s, cache, activeStack)
    graph.set(name, refs)
  }

  const circular = new Set<string>()
  const indices = new Map<string, number>()
  const lowlink = new Map<string, number>()
  const onStack = new Set<string>()
  const sccStack: string[] = []
  let currentIndex = 0

  function strongConnect(node: string): void {
    indices.set(node, currentIndex)
    lowlink.set(node, currentIndex)
    currentIndex++
    sccStack.push(node)
    onStack.add(node)

    const neighbors = graph.get(node)
    if (neighbors) {
      for (const next of neighbors) {
        if (!graph.has(next)) {
          // Target is not in the components schema graph (external or dangling reference)
          continue
        }
        if (!indices.has(next)) {
          // Successor has not yet been visited; recurse
          strongConnect(next)
          const nextLow = lowlink.get(next)!
          const curLow = lowlink.get(node)!
          if (nextLow < curLow) {
            lowlink.set(node, nextLow)
          }
        } else if (onStack.has(next)) {
          // Successor is on the stack and hence in the current SCC
          const nextIndex = indices.get(next)!
          const curLow = lowlink.get(node)!
          if (nextIndex < curLow) {
            lowlink.set(node, nextIndex)
          }
        }
      }
    }

    // If node is a root node of an SCC, pop the stack and collect component members
    if (lowlink.get(node) === indices.get(node)) {
      const component: string[] = []
      let w: string
      do {
        w = sccStack.pop()!
        onStack.delete(w)
        component.push(w)
      } while (w !== node)

      if (component.length > 1) {
        for (const member of component) {
          circular.add(member)
        }
      } else {
        // Single-node component: participates in a cycle if and only if it has a self-loop
        const singleNeighbors = graph.get(node)
        if (singleNeighbors && singleNeighbors.has(node)) {
          circular.add(node)
        }
      }
    }
  }

  for (const node of Object.keys(schemas)) {
    if (!indices.has(node)) {
      strongConnect(node)
    }
  }

  return circular
}

export { findObjectCycles }
