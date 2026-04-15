import type { OasDocument } from './oas32-types.js'
import {
  createRefResolver,
  type RefResolution,
  type RefResolverDiagnostic,
  type RefResolverDiagnosticCode,
  type RefResolverKind,
} from './ref-resolver.js'

export { isRelativeRef, resolvePointer } from './ref-resolver.js'

export type RefKind = RefResolverKind

export type RefGraphDiagnosticCode = RefResolverDiagnosticCode

export type RefGraphDiagnostic = RefResolverDiagnostic

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
}

export function resolveRefGraph(spec: OasDocument | Record<string, unknown>, options: RefGraphOptions = {}): RefGraph {
  const nodes: RefGraphNode[] = []
  const diagnostics: RefGraphDiagnostic[] = []
  const resolver = createRefResolver({ ...(options.basePath ? { entryPath: options.basePath } : {}) })

  visitDocument(spec, '#', options.basePath, [], spec)
  return { nodes, diagnostics }

  function visitDocument(
    document: unknown,
    sourcePointer: string,
    basePath: string | undefined,
    stack: string[],
    refRoot: unknown,
  ): void {
    collectRefs(document, sourcePointer, (ref, refPointer) => {
      resolveRef(ref, refPointer, refRoot, basePath, stack)
    })
  }

  function resolveRef(ref: string, sourcePointer: string, root: unknown, basePath: string | undefined, stack: string[]): void {
    const resolution = resolver.resolve({ ref, sourcePointer, root, ...(basePath ? { basePath } : {}), stack })
    nodes.push(toGraphNode(resolution))
    if (resolution.diagnostic) diagnostics.push(resolution.diagnostic)
    if (!resolution.resolved) return

    visitDocument(
      resolution.target,
      resolution.pointer ?? ref,
      resolution.basePath ?? basePath,
      [...stack, resolution.cacheKey],
      resolution.documentRoot ?? root,
    )
  }
}

export function collectRefs(node: unknown, sourcePointer: string, onRef: (ref: string, sourcePointer: string) => void): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    node.forEach((item, index) => collectRefs(item, `${sourcePointer}/${index}`, onRef))
    return
  }

  const obj = node as Record<string, unknown>
  if (typeof obj['$ref'] === 'string') {
    onRef(obj['$ref'], `${sourcePointer}/$ref`)
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
