/**
 * Ref-preserving projection — 문서의 재사용 선언과 그 사이의 `$ref`를 인라인 전개 없이
 * 그래프로 투영한다 (Goal 69.7).
 *
 * - 노드: 진입 문서의 선언(`components.*` 항목, `paths` 항목, `webhooks` 항목)과
 *   외부 파일의 참조 대상. id는 진입 문서 선언이면 정규화된 JSON Pointer,
 *   외부 대상이면 `<filePath>#<pointer>`다.
 * - 엣지: occurrence와 참조 대상이 모두 노드 안에 있는 해결된 `$ref` occurrence 하나당
 *   하나. occurrence를 포함하는 가장 가까운 노드가 source, 참조 대상을 포함하는 가장
 *   가까운 노드가 target이다. 자기 참조도 유지한다.
 * - 엣지가 없는 occurrence는 진단이 가리킨다. 해결되지 않은 occurrence는 resolver 진단
 *   (`ref-not-found` 등)이, occurrence나 참조 대상이 어떤 노드에도 속하지 않는
 *   occurrence(`info`·`x-` 확장·비표준 `components` 섹션 아래 등)는 그 끝마다
 *   `ref-source-outside-nodes`/`ref-target-outside-nodes` 진단이 가리킨다.
 * - 순환 위의 엣지는 `recursion`으로 표시한다. instance 하위로 내려가는 유효한 재귀는
 *   `guarded`, 진전이 없는 순환은 `unguarded`(`ref-cycle` 진단과 같은 occurrence)다.
 *
 * 인라인 출력과 달리 크기가 occurrence 수에 비례하므로, 순환이 많은 문서도 그대로
 * 시각화·편집 도구에 넘길 수 있다.
 */

import type { OasDocument } from './oas32-types.js'
import { canonicalJsonPointerFragment, escapeJsonPointerToken, unescapeJsonPointerToken } from './json-pointer.js'
import { analyzeRefGraph, type RefGraphDiagnostic, type RefGraphOptions, type RefOccurrence } from './ref-graph.js'

export type RefProjectionNodeKind =
  | 'schema'
  | 'response'
  | 'parameter'
  | 'example'
  | 'requestBody'
  | 'header'
  | 'securityScheme'
  | 'link'
  | 'callback'
  | 'pathItem'
  | 'mediaType'
  | 'path'
  | 'webhook'
  | 'external'

export type RefProjectionNode = {
  id: string
  kind: RefProjectionNodeKind
  /** 선언 이름 (스키마 이름, 경로 템플릿 등). 외부 대상은 pointer의 마지막 세그먼트. */
  name: string
  /** 선언이 있는 파일 안의 정규화된 JSON Pointer */
  pointer: string
  /** 외부 대상이 있는 파일. 진입 문서 선언에는 없다. */
  filePath?: string
}

export type RefProjectionRecursion = 'guarded' | 'unguarded'

export type RefProjectionEdge = {
  source: string
  target: string
  ref: string
  /** occurrence의 `.../$ref` pointer (occurrence가 있는 파일 기준) */
  sourcePointer: string
  sourceFilePath?: string
  recursion?: RefProjectionRecursion
}

/**
 * A resolved `$ref` occurrence that has no edge because no node contains one of
 * its ends: the occurrence (`ref-source-outside-nodes`) or its target
 * (`ref-target-outside-nodes`). An occurrence with neither end inside a node
 * gets one diagnostic for each end.
 */
export type RefProjectionOutsideNodesDiagnostic = {
  code: 'ref-source-outside-nodes' | 'ref-target-outside-nodes'
  ref: string
  message: string
  /** occurrence의 `.../$ref` pointer (occurrence가 있는 파일 기준) */
  sourcePointer: string
  /** occurrence가 있는 파일. 진입 문서는 `basePath`를 넘겼을 때만 있다 (resolver 진단과 같은 규칙). */
  sourceFilePath?: string
  /** 참조 대상이 진입 문서 밖에 있을 때 그 파일 */
  filePath?: string
  /** 참조 대상의 정규화된 JSON Pointer (대상 파일 기준) */
  pointer: string
  /** `lookupSourceLocation`이 찾은 occurrence 위치 */
  line?: number
  column?: number
}

export type RefProjectionDiagnostic = RefGraphDiagnostic | RefProjectionOutsideNodesDiagnostic

export type RefProjectionDiagnosticCode = RefProjectionDiagnostic['code']

export type RefProjection = {
  nodes: RefProjectionNode[]
  edges: RefProjectionEdge[]
  /**
   * Resolver diagnostics of the ref graph, then the occurrences left without an
   * edge because an end lies outside every node. Every `$ref` occurrence has
   * exactly one edge unless one of these names it: an unresolved occurrence by
   * its resolver diagnostic, any other by `ref-source-outside-nodes` and/or
   * `ref-target-outside-nodes`.
   */
  diagnostics: RefProjectionDiagnostic[]
}

const COMPONENT_KINDS: ReadonlyArray<readonly [section: string, kind: RefProjectionNodeKind]> = [
  ['schemas', 'schema'],
  ['responses', 'response'],
  ['parameters', 'parameter'],
  ['examples', 'example'],
  ['requestBodies', 'requestBody'],
  ['headers', 'header'],
  ['securitySchemes', 'securityScheme'],
  ['links', 'link'],
  ['callbacks', 'callback'],
  ['pathItems', 'pathItem'],
  ['mediaTypes', 'mediaType'],
]

export function projectRefGraph(
  spec: OasDocument | Record<string, unknown>,
  options: RefGraphOptions = {},
): RefProjection {
  const analysis = analyzeRefGraph(spec, options)
  const nodes = collectDeclarations(spec)
  const entryOwners = new PointerOwnerIndex(nodes)
  const externalNodes = new Map<string, RefProjectionNode>()
  const externalOwners = new Map<string, PointerOwnerIndex>()

  // External targets become nodes before attribution, so occurrences inside an
  // external document can be owned by the target that contains them.
  for (const occurrence of analysis.occurrences) {
    const target = targetLocation(occurrence, options.basePath)
    if (!target || target.filePath === undefined) continue
    const id = `${target.filePath}${target.pointer}`
    if (externalNodes.has(id)) continue
    const node: RefProjectionNode = {
      id,
      kind: 'external',
      name: lastSegment(target.pointer) ?? target.filePath,
      pointer: target.pointer,
      filePath: target.filePath,
    }
    externalNodes.set(id, node)
    const index = externalOwners.get(target.filePath) ?? new PointerOwnerIndex([])
    index.add(node)
    externalOwners.set(target.filePath, index)
  }

  const ownersFor = (filePath: string | undefined) =>
    filePath === undefined ? entryOwners : externalOwners.get(filePath)

  const edges: RefProjectionEdge[] = []
  const outsideNodes: RefProjectionOutsideNodesDiagnostic[] = []
  for (const occurrence of analysis.occurrences) {
    const target = targetLocation(occurrence, options.basePath)
    // An unresolved occurrence is named by its resolver diagnostic.
    if (!target) continue
    const sourceFile = fileOf(occurrence.basePath, options.basePath)
    const source = ownersFor(sourceFile)?.ownerOf(occurrence.sourcePointer)
    const targetNode = ownersFor(target.filePath)?.ownerOf(target.pointer)
    if (!source || !targetNode) {
      if (!source) outsideNodes.push(outsideNodesDiagnostic('ref-source-outside-nodes', occurrence, target, options))
      if (!targetNode) outsideNodes.push(outsideNodesDiagnostic('ref-target-outside-nodes', occurrence, target, options))
      continue
    }

    const recursion: RefProjectionRecursion | undefined = analysis.unguardedCycles.has(occurrence)
      ? 'unguarded'
      : analysis.cycles.has(occurrence) ? 'guarded' : undefined
    edges.push({
      source: source.id,
      target: targetNode.id,
      ref: occurrence.ref,
      sourcePointer: occurrence.sourcePointer,
      ...(sourceFile !== undefined ? { sourceFilePath: sourceFile } : {}),
      ...(recursion ? { recursion } : {}),
    })
  }

  return {
    nodes: [...nodes, ...externalNodes.values()],
    edges,
    diagnostics: [...analysis.graph.diagnostics, ...outsideNodes],
  }
}

function outsideNodesDiagnostic(
  code: RefProjectionOutsideNodesDiagnostic['code'],
  occurrence: RefOccurrence,
  target: { filePath: string | undefined; pointer: string },
  options: RefGraphOptions,
): RefProjectionOutsideNodesDiagnostic {
  const message = code === 'ref-source-outside-nodes'
    ? `$ref occurrence를 포함하는 노드가 없어 엣지로 투영하지 않았습니다: ${occurrence.sourcePointer}`
    : `참조 대상을 포함하는 노드가 없어 엣지로 투영하지 않았습니다: ${occurrence.ref}`
  const location = occurrence.basePath === undefined
    ? undefined
    : options.lookupSourceLocation?.(occurrence.basePath, occurrence.sourcePointer)
  return {
    code,
    ref: occurrence.ref,
    message,
    sourcePointer: occurrence.sourcePointer,
    ...(occurrence.basePath !== undefined ? { sourceFilePath: occurrence.basePath } : {}),
    ...(target.filePath !== undefined ? { filePath: target.filePath } : {}),
    pointer: target.pointer,
    ...(location ? { line: location.line, column: location.column } : {}),
  }
}

function collectDeclarations(spec: OasDocument | Record<string, unknown>): RefProjectionNode[] {
  const nodes: RefProjectionNode[] = []
  const root = spec as Record<string, unknown>
  const components = asRecord(root.components)
  for (const [section, kind] of COMPONENT_KINDS) {
    for (const name of Object.keys(asRecord(components?.[section]) ?? {})) {
      const pointer = `#/components/${section}/${escapeJsonPointerToken(name)}`
      nodes.push({ id: pointer, kind, name, pointer })
    }
  }
  for (const [container, kind] of [['paths', 'path'], ['webhooks', 'webhook']] as const) {
    for (const name of Object.keys(asRecord(root[container]) ?? {})) {
      const pointer = `#/${container}/${escapeJsonPointerToken(name)}`
      nodes.push({ id: pointer, kind, name, pointer })
    }
  }
  return nodes
}

/** File and pointer the occurrence resolves to; `filePath` is undefined for the entry document. */
function targetLocation(
  occurrence: RefOccurrence,
  entryPath: string | undefined,
): { filePath: string | undefined; pointer: string } | undefined {
  const { resolution } = occurrence
  if (!resolution.resolved || resolution.pointer === undefined) return undefined
  const filePath = resolution.kind === 'external' ? resolution.filePath : occurrence.basePath
  return { filePath: fileOf(filePath, entryPath), pointer: resolution.pointer }
}

function fileOf(filePath: string | undefined, entryPath: string | undefined): string | undefined {
  return filePath === undefined || filePath === entryPath ? undefined : filePath
}

/** Finds the declaration whose pointer is the longest segment-prefix of a pointer. */
class PointerOwnerIndex {
  private readonly byPointer = new Map<string, RefProjectionNode>()

  constructor(nodes: readonly RefProjectionNode[]) {
    for (const node of nodes) this.add(node)
  }

  add(node: RefProjectionNode): void {
    this.byPointer.set(node.pointer, node)
  }

  ownerOf(pointer: string): RefProjectionNode | undefined {
    let candidate = canonicalJsonPointerFragment(pointer) ?? pointer
    for (;;) {
      const owner = this.byPointer.get(candidate)
      if (owner) return owner
      const slash = candidate.lastIndexOf('/')
      if (slash <= 0) return undefined
      candidate = candidate.slice(0, slash)
    }
  }
}

function lastSegment(pointer: string): string | undefined {
  const slash = pointer.lastIndexOf('/')
  if (slash < 0 || slash === pointer.length - 1) return undefined
  return unescapeJsonPointerToken(pointer.slice(slash + 1))
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}
