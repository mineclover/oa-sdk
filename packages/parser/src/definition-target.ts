import type { OasInfo } from './types/document.js'
import type { OasServer } from './types/server.js'
import type { OasTag } from './types/headers-tags.js'
import type { CanonicalDefinitionId } from './definition-id.js'
import {
  allocateDefinitionOutputNames,
  type DefinitionOutputNameAllocationOptions,
  type DefinitionOutputNameAllocationResult,
} from './definition-output-names.js'
import type { DefinitionOutputNameMap } from './definition-output-refs.js'
import type {
  DefinitionRegistry,
  DefinitionRegistryNode,
  DefinitionRegistryRefEdge,
} from './definition-registry.js'

export type DefinitionTargetNamingPolicy = {
  aliases?: DefinitionOutputNameMap
}

export type DefinitionTargetConfig = {
  name: string
  info?: OasInfo
  scopes: readonly string[]
  domains: readonly string[]
  servers: readonly OasServer[]
  tags?: readonly OasTag[]
  includePaths: readonly string[]
  includeDefinitions?: readonly CanonicalDefinitionId[]
  namingPolicy?: DefinitionTargetNamingPolicy
}

export type DefinitionTargetDiagnosticCode =
  | 'definition-target/path-not-found'
  | 'definition-target/definition-not-found'
  | 'definition-target/disallowed-definition'
  | 'definition-target/disallowed-ref'

export type DefinitionTargetDiagnostic = {
  code: DefinitionTargetDiagnosticCode
  severity: 'error'
  targetName: string
  message: string
  path?: string
  id?: CanonicalDefinitionId
  sourceId?: CanonicalDefinitionId
  targetId?: CanonicalDefinitionId
  ref?: string
  sourcePath?: string
  sourcePointer?: string
}

export type DefinitionTargetSelectionResult = {
  valid: boolean
  target: DefinitionTargetConfig
  directPathIds: CanonicalDefinitionId[]
  directDefinitionIds: CanonicalDefinitionId[]
  nodes: DefinitionRegistryNode[]
  nodeById: ReadonlyMap<CanonicalDefinitionId, DefinitionRegistryNode>
  refEdges: DefinitionRegistryRefEdge[]
  outputNameAllocation: DefinitionOutputNameAllocationResult
  diagnostics: DefinitionTargetDiagnostic[]
}

type PathNode = DefinitionRegistryNode & { kind: 'path' }

export function selectDefinitionTarget(
  registry: DefinitionRegistry,
  target: DefinitionTargetConfig,
): DefinitionTargetSelectionResult {
  const diagnostics: DefinitionTargetDiagnostic[] = []
  const directPathIds = selectDirectPathIds(registry.nodes, target, diagnostics)
  const directDefinitionIds = selectDirectDefinitionIds(registry, target, diagnostics)
  const selectedIds = collectTransitiveTargetIds(registry, target, [
    ...directPathIds,
    ...directDefinitionIds,
  ], diagnostics)
  const selectedNodes = registry.nodes.filter(node => selectedIds.has(node.id))
  const nodeById = new Map<CanonicalDefinitionId, DefinitionRegistryNode>()

  for (const node of selectedNodes) {
    nodeById.set(node.id, node)
  }

  const allocationOptions: DefinitionOutputNameAllocationOptions = {
    targetName: target.name,
  }
  if (target.namingPolicy?.aliases !== undefined) {
    allocationOptions.aliases = target.namingPolicy.aliases
  }

  const outputNameAllocation = allocateDefinitionOutputNames(selectedNodes, allocationOptions)
  const refEdges = registry.refEdges.filter(edge => selectedIds.has(edge.sourceId))

  return {
    valid: registry.valid && outputNameAllocation.valid && diagnostics.length === 0,
    target,
    directPathIds,
    directDefinitionIds,
    nodes: selectedNodes,
    nodeById,
    refEdges,
    outputNameAllocation,
    diagnostics,
  }
}

function selectDirectPathIds(
  nodes: readonly DefinitionRegistryNode[],
  target: DefinitionTargetConfig,
  diagnostics: DefinitionTargetDiagnostic[],
): CanonicalDefinitionId[] {
  const pathNodes = nodes.filter(isPathNode)
  const directPathIds: CanonicalDefinitionId[] = []

  for (const includePath of target.includePaths) {
    const matches = pathNodes.filter(node => {
      return readPathMetadata(node) === includePath && isAllowedTargetNode(node, target)
    })

    if (matches.length === 0) {
      diagnostics.push({
        code: 'definition-target/path-not-found',
        severity: 'error',
        targetName: target.name,
        path: includePath,
        message: `Target "${target.name}" include path "${includePath}" did not match a path definition in configured scopes/domains.`,
      })
      continue
    }

    for (const node of matches) {
      directPathIds.push(node.id)
    }
  }

  return [...new Set(directPathIds)]
}

function selectDirectDefinitionIds(
  registry: DefinitionRegistry,
  target: DefinitionTargetConfig,
  diagnostics: DefinitionTargetDiagnostic[],
): CanonicalDefinitionId[] {
  const ids = target.includeDefinitions ?? []
  const directDefinitionIds: CanonicalDefinitionId[] = []

  for (const id of ids) {
    const node = registry.nodeById.get(id)
    if (!node) {
      diagnostics.push({
        code: 'definition-target/definition-not-found',
        severity: 'error',
        targetName: target.name,
        id,
        message: `Target "${target.name}" include definition "${id}" did not match a registered definition.`,
      })
      continue
    }

    if (!isAllowedTargetNode(node, target)) {
      diagnostics.push({
        code: 'definition-target/disallowed-definition',
        severity: 'error',
        targetName: target.name,
        id,
        message: `Target "${target.name}" cannot include definition "${id}" because scope "${node.scope}" or domain "${node.domain}" is outside configured scopes/domains.`,
      })
      continue
    }

    directDefinitionIds.push(id)
  }

  return [...new Set(directDefinitionIds)]
}

function collectTransitiveTargetIds(
  registry: DefinitionRegistry,
  target: DefinitionTargetConfig,
  directPathIds: readonly CanonicalDefinitionId[],
  diagnostics: DefinitionTargetDiagnostic[],
): ReadonlySet<CanonicalDefinitionId> {
  const edgesBySource = groupEdgesBySource(registry.refEdges)
  const selectedIds = new Set<CanonicalDefinitionId>()
  const queue: DefinitionRegistryNode[] = []

  for (const id of directPathIds) {
    const node = registry.nodeById.get(id)
    if (node) includeNode(node, selectedIds, queue)
  }

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const node = queue[cursor]
    if (!node) continue

    for (const edge of edgesBySource.get(node.id) ?? []) {
      if (!edge.targetId) continue
      const targetId = edge.targetId
      const targetNode = registry.nodeById.get(targetId)
      if (!targetNode) continue

      if (!isAllowedTargetNode(targetNode, target)) {
        diagnostics.push(createDisallowedRefDiagnostic(edge, targetId, targetNode, target))
        continue
      }

      includeNode(targetNode, selectedIds, queue)
    }
  }

  return selectedIds
}

function includeNode(
  node: DefinitionRegistryNode,
  selectedIds: Set<CanonicalDefinitionId>,
  queue: DefinitionRegistryNode[],
): void {
  if (selectedIds.has(node.id)) return
  selectedIds.add(node.id)
  queue.push(node)
}

function groupEdgesBySource(
  edges: readonly DefinitionRegistryRefEdge[],
): ReadonlyMap<CanonicalDefinitionId, readonly DefinitionRegistryRefEdge[]> {
  const bySource = new Map<CanonicalDefinitionId, DefinitionRegistryRefEdge[]>()

  for (const edge of edges) {
    const sourceEdges = bySource.get(edge.sourceId)
    if (sourceEdges) {
      sourceEdges.push(edge)
    } else {
      bySource.set(edge.sourceId, [edge])
    }
  }

  return bySource
}

function createDisallowedRefDiagnostic(
  edge: DefinitionRegistryRefEdge,
  targetId: CanonicalDefinitionId,
  targetNode: DefinitionRegistryNode,
  target: DefinitionTargetConfig,
): DefinitionTargetDiagnostic {
  return {
    code: 'definition-target/disallowed-ref',
    severity: 'error',
    targetName: target.name,
    id: targetNode.id,
    sourceId: edge.sourceId,
    targetId,
    ref: edge.ref,
    sourcePath: edge.sourcePath,
    sourcePointer: edge.sourcePointer,
    message: `Target "${target.name}" cannot include referenced definition "${targetNode.id}" because scope "${targetNode.scope}" or domain "${targetNode.domain}" is outside configured scopes/domains.`,
  }
}

function isAllowedTargetNode(node: DefinitionRegistryNode, target: DefinitionTargetConfig): boolean {
  return target.scopes.includes(node.scope) && target.domains.includes(node.domain)
}

function isPathNode(node: DefinitionRegistryNode): node is PathNode {
  return node.kind === 'path'
}

function readPathMetadata(node: PathNode): string | undefined {
  return readStringProperty(node.metadata, 'path')
    ?? readStringProperty(node.metadata, 'openApiPath')
    ?? readStringProperty(node.metadata, 'openapiPath')
    ?? readStringProperty(node.content, 'path')
    ?? readStringProperty(node.content, 'openApiPath')
    ?? readStringProperty(node.content, 'openapiPath')
}

function readStringProperty(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const property = (value as Record<string, unknown>)[key]
  return typeof property === 'string' ? property : undefined
}
