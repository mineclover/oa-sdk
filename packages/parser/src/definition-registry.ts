import { validateDefinitionId, type CanonicalDefinitionId } from './definition-id.js'
import { createDefinitionRef, type DefinitionNode, type DefinitionRef } from './definition-node.js'
import { collectRefs } from './ref-graph.js'
import type { SourceLocation } from './source-location.js'

export type DefinitionRegistryDiagnosticSeverity = 'error' | 'warning' | 'info'

export type DefinitionRegistryDiagnosticCode = 'definition-registry/duplicate-id'

export type DefinitionRegistryDiagnostic = {
  code: DefinitionRegistryDiagnosticCode
  severity: DefinitionRegistryDiagnosticSeverity
  message: string
  id?: CanonicalDefinitionId
  sourcePath?: string
  sourcePointer?: string
  line?: number
  column?: number
  firstSourcePath?: string
  firstSourcePointer?: string
  firstLine?: number
  firstColumn?: number
}

export type DefinitionRegistryRefEdge = {
  sourceId: CanonicalDefinitionId
  ref: string
  sourcePath: string
  sourcePointer: string
  targetId?: CanonicalDefinitionId
}

export type DefinitionRegistryNode = DefinitionNode

export type DefinitionRegistry = {
  valid: boolean
  nodes: DefinitionRegistryNode[]
  nodeById: ReadonlyMap<CanonicalDefinitionId, DefinitionRegistryNode>
  refEdges: DefinitionRegistryRefEdge[]
  diagnostics: DefinitionRegistryDiagnostic[]
}

export type DefinitionRegistryOptions = {
  lookupSourceLocation?: (
    sourcePath: string,
    sourcePointer: string,
  ) => Pick<SourceLocation, 'line' | 'column'> | undefined
}

export function createDefinitionRegistry(
  inputNodes: readonly DefinitionNode[],
  options: DefinitionRegistryOptions = {},
): DefinitionRegistry {
  const nodes: DefinitionRegistryNode[] = []
  const nodeById = new Map<CanonicalDefinitionId, DefinitionRegistryNode>()
  const refEdges: DefinitionRegistryRefEdge[] = []
  const diagnostics: DefinitionRegistryDiagnostic[] = []

  for (const inputNode of inputNodes) {
    const firstNode = nodeById.get(inputNode.id)
    if (firstNode) {
      diagnostics.push(createDuplicateIdDiagnostic(inputNode, firstNode, options))
      continue
    }

    const refs = mergeDefinitionRefs(inputNode.refs, collectDefinitionRefs(inputNode))
    const node: DefinitionRegistryNode = { ...inputNode, refs }
    nodes.push(node)
    nodeById.set(node.id, node)
    refEdges.push(...refs.map(ref => createRefEdge(node.id, ref)))
  }

  return {
    valid: diagnostics.every(diagnostic => diagnostic.severity !== 'error'),
    nodes,
    nodeById,
    refEdges,
    diagnostics,
  }
}

export function collectDefinitionRefs(node: DefinitionNode): DefinitionRef[] {
  const refs: DefinitionRef[] = []

  collectRefs(node.content, node.sourcePointer, (ref, sourcePointer) => {
    const targetId = normalizeCanonicalRef(ref)
    refs.push(createDefinitionRef({
      ref,
      sourcePath: node.sourcePath,
      sourcePointer,
      ...(targetId ? { targetId } : {}),
    }))
  })

  return refs
}

function mergeDefinitionRefs(
  explicitRefs: readonly DefinitionRef[],
  collectedRefs: readonly DefinitionRef[],
): DefinitionRef[] {
  const refsByPosition = new Map<string, DefinitionRef>()

  for (const ref of [...explicitRefs, ...collectedRefs]) {
    const key = `${ref.sourcePath}\0${ref.sourcePointer}\0${ref.ref}`
    const previous = refsByPosition.get(key)
    if (!previous || (previous.targetId === undefined && ref.targetId !== undefined)) {
      refsByPosition.set(key, ref)
    }
  }

  return [...refsByPosition.values()]
}

function createRefEdge(sourceId: CanonicalDefinitionId, ref: DefinitionRef): DefinitionRegistryRefEdge {
  return {
    sourceId,
    ref: ref.ref,
    sourcePath: ref.sourcePath,
    sourcePointer: ref.sourcePointer,
    ...(ref.targetId ? { targetId: ref.targetId } : {}),
  }
}

function createDuplicateIdDiagnostic(
  duplicateNode: DefinitionNode,
  firstNode: DefinitionNode,
  options: DefinitionRegistryOptions,
): DefinitionRegistryDiagnostic {
  const duplicateLocation = options.lookupSourceLocation?.(duplicateNode.sourcePath, duplicateNode.sourcePointer)
  const firstLocation = options.lookupSourceLocation?.(firstNode.sourcePath, firstNode.sourcePointer)
  const diagnostic: DefinitionRegistryDiagnostic = {
    code: 'definition-registry/duplicate-id',
    severity: 'error',
    id: duplicateNode.id,
    message: `Duplicate definition id "${duplicateNode.id}" already registered from ${firstNode.sourcePath}${firstNode.sourcePointer}.`,
    sourcePath: duplicateNode.sourcePath,
    sourcePointer: duplicateNode.sourcePointer,
    firstSourcePath: firstNode.sourcePath,
    firstSourcePointer: firstNode.sourcePointer,
  }

  if (duplicateLocation) {
    diagnostic.line = duplicateLocation.line
    diagnostic.column = duplicateLocation.column
  }
  if (firstLocation) {
    diagnostic.firstLine = firstLocation.line
    diagnostic.firstColumn = firstLocation.column
  }

  return diagnostic
}

function normalizeCanonicalRef(ref: string): CanonicalDefinitionId | undefined {
  const prefix = 'oa://'
  if (!ref.startsWith(prefix)) return undefined

  const parts = ref.slice(prefix.length).split('/')
  if (parts.length !== 4) return undefined

  const [kind, scope, domain, name] = parts
  const result = validateDefinitionId(`${kind}:${scope}/${domain}/${name}`)
  return result.valid ? result.id.id : undefined
}
