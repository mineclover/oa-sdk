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
import { resolvePointer } from './ref-resolver.js'

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
  lookupSourceLocation?: (filePath: string, pointer: string) => { line: number; column: number } | undefined
}

export function resolveRefGraph(spec: OasDocument | Record<string, unknown>, options: RefGraphOptions = {}): RefGraph {
  const nodes: RefGraphNode[] = []
  const diagnostics: RefGraphDiagnostic[] = []
  const resolver = createRefResolver({
    ...(options.basePath ? { entryPath: options.basePath } : {}),
    ...(options.lookupSourceLocation ? { lookupSourceLocation: options.lookupSourceLocation } : {}),
  })

  visitDocument(spec, '#', options.basePath, [], [], 0, spec)
  return { nodes, diagnostics }

  /**
   * @param stack 전개 중인 대상 cacheKey
   * @param entryDescents stack 각 대상에 진입한 시점까지 지난 instance 하위 키워드 수
   * @param frameDescents 이 문서 조각(frame)에 진입한 시점의 instance 하위 키워드 수
   */
  function visitDocument(
    document: unknown,
    sourcePointer: string,
    basePath: string | undefined,
    stack: string[],
    entryDescents: number[],
    frameDescents: number,
    refRoot: unknown,
  ): void {
    collectRefs(document, sourcePointer, (ref, refPointer) => {
      const descents = frameDescents + countInstanceDescents(relativeSegments(sourcePointer, refPointer))
      resolveRef(ref, refPointer, refRoot, basePath, stack, entryDescents, descents)
    })
  }

  function resolveRef(
    ref: string,
    sourcePointer: string,
    root: unknown,
    basePath: string | undefined,
    stack: string[],
    entryDescents: number[],
    descents: number,
  ): void {
    const resolution = resolver.resolve({ ref, sourcePointer, root, ...(basePath ? { basePath } : {}), stack })
    if (resolution.diagnostic?.code === 'ref-cycle') {
      const index = stack.indexOf(resolution.cacheKey)
      if (index !== -1 && descents > entryDescents[index]!) {
        // Recursion through an instance-descending keyword is a valid schema
        // graph edge; the target is already being visited higher in the stack.
        const target = resolution.kind === 'internal' ? resolvePointer(resolution.pointer ?? ref, root) : undefined
        nodes.push({ ...toGraphNode(resolution), resolved: true, ...(target !== undefined ? { target } : {}) })
        return
      }
    }
    nodes.push(toGraphNode(resolution))
    if (resolution.diagnostic) diagnostics.push(resolution.diagnostic)
    if (!resolution.resolved) return

    const targetPointer = resolution.pointer ?? ref
    visitDocument(
      resolution.target,
      targetPointer,
      resolution.basePath ?? basePath,
      [...stack, resolution.cacheKey],
      [...entryDescents, descents],
      descents,
      resolution.documentRoot ?? root,
    )
  }
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
