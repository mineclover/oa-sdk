/**
 * Ref-preserving projection — 문서의 재사용 선언과 그 사이의 `$ref`를 인라인 전개 없이
 * 그래프로 투영한다 (Goal 69.7).
 *
 * - 노드: 진입 문서의 선언(`components.*` 항목, `paths` 항목, `webhooks` 항목)과
 *   외부 파일의 참조 대상. id는 진입 문서 선언이면 정규화된 JSON Pointer,
 *   외부 대상이면 `<filePath>#<pointer>`다.
 * - 엣지: `$ref` occurrence 하나당 하나. occurrence를 포함하는 가장 가까운 선언이
 *   source, 참조 대상을 포함하는 가장 가까운 선언이 target이다. 자기 참조도 유지한다.
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

export type RefProjection = {
  nodes: RefProjectionNode[]
  edges: RefProjectionEdge[]
  diagnostics: RefGraphDiagnostic[]
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
  for (const occurrence of analysis.occurrences) {
    const target = targetLocation(occurrence, options.basePath)
    if (!target) continue
    const sourceFile = fileOf(occurrence.basePath, options.basePath)
    const source = ownersFor(sourceFile)?.ownerOf(occurrence.sourcePointer)
    const targetNode = ownersFor(target.filePath)?.ownerOf(target.pointer)
    if (!source || !targetNode) continue

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
    diagnostics: analysis.graph.diagnostics,
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
