import { dirname, resolve } from 'node:path'
import { validateDefinitionId, type CanonicalDefinitionId } from './definition-id.js'
import { createDefinitionRef, type DefinitionNode, type DefinitionRef } from './definition-node.js'
import { collectRefs, isRelativeRef } from './ref-graph.js'
import type { SourceLocation } from './source-location.js'

export type DefinitionRegistryDiagnosticSeverity = 'error' | 'warning' | 'info'

export type DefinitionRegistryDiagnosticCode =
  | 'definition-registry/duplicate-id'
  | 'definition-registry/structural-duplicate'
  | 'definition-registry/missing-ref'
  | 'definition-registry/unsupported-ref'

export type DefinitionRegistryDiagnostic = {
  code: DefinitionRegistryDiagnosticCode
  severity: DefinitionRegistryDiagnosticSeverity
  message: string
  id?: CanonicalDefinitionId
  ids?: CanonicalDefinitionId[]
  ref?: string
  contentHash?: string
  sourcePath?: string
  sourcePointer?: string
  line?: number
  column?: number
  filePath?: string
  pointer?: string
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

export type DefinitionSemanticAlias = {
  sourceId: CanonicalDefinitionId
  targetId: CanonicalDefinitionId
  sourcePath: string
  sourcePointer: string
  sourceContentHash: string
  targetSourcePath: string
  targetSourcePointer: string
  targetContentHash: string
}

export type DefinitionRegistry = {
  valid: boolean
  nodes: DefinitionRegistryNode[]
  nodeById: ReadonlyMap<CanonicalDefinitionId, DefinitionRegistryNode>
  refEdges: DefinitionRegistryRefEdge[]
  semanticAliases: DefinitionSemanticAlias[]
  diagnostics: DefinitionRegistryDiagnostic[]
}

export type DefinitionRegistryOptions = {
  lookupSourceLocation?: (
    sourcePath: string,
    sourcePointer: string,
  ) => Pick<SourceLocation, 'line' | 'column'> | undefined
  structuralDuplicateSeverity?: 'info' | 'warning' | 'off'
}

export function createDefinitionRegistry(
  inputNodes: readonly DefinitionNode[],
  options: DefinitionRegistryOptions = {},
): DefinitionRegistry {
  const nodes: DefinitionRegistryNode[] = []
  const nodeById = new Map<CanonicalDefinitionId, DefinitionRegistryNode>()
  const diagnostics: DefinitionRegistryDiagnostic[] = []

  for (const inputNode of inputNodes) {
    const firstNode = nodeById.get(inputNode.id)
    if (firstNode) {
      diagnostics.push(createDuplicateIdDiagnostic(inputNode, firstNode, options))
      continue
    }

    const node: DefinitionRegistryNode = {
      ...inputNode,
      refs: mergeDefinitionRefs(inputNode.refs, collectDefinitionRefs(inputNode)),
    }
    nodes.push(node)
    nodeById.set(node.id, node)
  }

  const sourceIndex = createSourceIndex(nodes)
  const resolvedNodes = nodes.map(node => ({
    ...node,
    refs: node.refs.map(ref => resolveDefinitionRef(ref, sourceIndex, diagnostics, options)),
  }))
  const resolvedNodeById = new Map<CanonicalDefinitionId, DefinitionRegistryNode>()
  const refEdges: DefinitionRegistryRefEdge[] = []

  for (const node of resolvedNodes) {
    resolvedNodeById.set(node.id, node)
    for (const ref of node.refs) {
      if (ref.targetId && !resolvedNodeById.has(ref.targetId) && !nodeById.has(ref.targetId)) {
        diagnostics.push(createMissingTargetDiagnostic(ref, options))
      }
      refEdges.push(createRefEdge(node.id, ref))
    }
  }

  const semanticAliases = collectSemanticAliases(resolvedNodes, resolvedNodeById, diagnostics, options)
  diagnostics.push(...collectStructuralDuplicateDiagnostics(resolvedNodes, semanticAliases, options))

  return {
    valid: diagnostics.every(diagnostic => diagnostic.severity !== 'error'),
    nodes: resolvedNodes,
    nodeById: resolvedNodeById,
    refEdges,
    semanticAliases,
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

type SourceIndex = {
  bySource: ReadonlyMap<string, DefinitionRegistryNode>
  byPath: ReadonlyMap<string, readonly DefinitionRegistryNode[]>
}

type FileRefResolution = {
  filePath: string
  pointer?: string
  targetId?: CanonicalDefinitionId
  reason?: 'missing' | 'ambiguous' | 'unsupported'
}

function createSourceIndex(nodes: readonly DefinitionRegistryNode[]): SourceIndex {
  const bySource = new Map<string, DefinitionRegistryNode>()
  const byPath = new Map<string, DefinitionRegistryNode[]>()

  for (const node of nodes) {
    const sourcePath = normalizeSourcePath(node.sourcePath)
    bySource.set(sourceKey(sourcePath, node.sourcePointer), node)
    const pathNodes = byPath.get(sourcePath)
    if (pathNodes) {
      pathNodes.push(node)
    } else {
      byPath.set(sourcePath, [node])
    }
  }

  return { bySource, byPath }
}

function resolveDefinitionRef(
  ref: DefinitionRef,
  sourceIndex: SourceIndex,
  diagnostics: DefinitionRegistryDiagnostic[],
  options: DefinitionRegistryOptions,
): DefinitionRef {
  if (ref.targetId) return ref

  const canonicalTargetId = normalizeCanonicalRef(ref.ref)
  if (canonicalTargetId) {
    return createDefinitionRef({ ...ref, targetId: canonicalTargetId })
  }

  if (isCanonicalRef(ref.ref)) {
    diagnostics.push(createUnsupportedRefDiagnostic(
      ref,
      options,
      `Canonical definition ref "${ref.ref}" must use oa://kind/scope/domain/name with a valid canonical definition id.`,
    ))
    return ref
  }

  if (isRelativeRef(ref.ref)) {
    const fileRef = resolveFileRef(ref, sourceIndex)
    if (fileRef.targetId) {
      return createDefinitionRef({ ...ref, targetId: fileRef.targetId })
    }

    const message = fileRef.reason === 'ambiguous'
      ? `Relative definition ref "${ref.ref}" matches multiple definitions in ${fileRef.filePath}; add an explicit JSON Pointer.`
      : fileRef.reason === 'unsupported'
        ? `Relative definition ref "${ref.ref}" must use a JSON Pointer fragment when a fragment is present.`
        : `Relative definition ref "${ref.ref}" does not match a registered definition source.`
    const diagnosticInput: RefDiagnosticInput = {
      code: fileRef.reason === 'ambiguous' || fileRef.reason === 'unsupported'
        ? 'definition-registry/unsupported-ref'
        : 'definition-registry/missing-ref',
      ref,
      options,
      message,
      filePath: fileRef.filePath,
    }
    if (fileRef.pointer !== undefined) diagnosticInput.pointer = fileRef.pointer
    diagnostics.push(createRefDiagnostic(diagnosticInput))
    return ref
  }

  diagnostics.push(createUnsupportedRefDiagnostic(
    ref,
    options,
    `Unsupported definition ref "${ref.ref}". Use oa://kind/scope/domain/name or a relative file ref to a registered definition.`,
  ))
  return ref
}

function resolveFileRef(ref: DefinitionRef, sourceIndex: SourceIndex): FileRefResolution {
  const parsed = parseRelativeFileRef(ref.ref, ref.sourcePath)
  if (!parsed) {
    return {
      filePath: normalizeSourcePath(ref.sourcePath),
      reason: 'unsupported',
    }
  }

  if (parsed.pointer) {
    const target = sourceIndex.bySource.get(sourceKey(parsed.filePath, parsed.pointer))
    return {
      filePath: parsed.filePath,
      pointer: parsed.pointer,
      ...(target ? { targetId: target.id } : { reason: 'missing' }),
    }
  }

  const pathNodes = sourceIndex.byPath.get(parsed.filePath) ?? []
  if (pathNodes.length === 1) {
    const target = pathNodes[0]
    return {
      filePath: parsed.filePath,
      ...(target ? { targetId: target.id } : { reason: 'missing' }),
    }
  }

  return {
    filePath: parsed.filePath,
    reason: pathNodes.length > 1 ? 'ambiguous' : 'missing',
  }
}

function parseRelativeFileRef(ref: string, sourcePath: string): { filePath: string; pointer?: string } | undefined {
  const hashIndex = ref.indexOf('#')
  const filePart = hashIndex === -1 ? ref : ref.slice(0, hashIndex)
  const fragment = hashIndex === -1 ? undefined : ref.slice(hashIndex + 1)
  if (!filePart) return undefined

  const result = {
    filePath: normalizeSourcePath(resolve(dirname(sourcePath), filePart)),
  }

  if (fragment === undefined) return result
  if (fragment === '') return { ...result, pointer: '#' }
  if (!fragment.startsWith('/')) return undefined
  return { ...result, pointer: `#${fragment}` }
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

function collectSemanticAliases(
  nodes: readonly DefinitionRegistryNode[],
  nodeById: ReadonlyMap<CanonicalDefinitionId, DefinitionRegistryNode>,
  diagnostics: DefinitionRegistryDiagnostic[],
  options: DefinitionRegistryOptions,
): DefinitionSemanticAlias[] {
  const aliases: DefinitionSemanticAlias[] = []

  for (const node of nodes) {
    const rawTarget = readSemanticAliasTarget(node.metadata)
    if (rawTarget === undefined) continue

    const targetId = normalizeSemanticAliasTarget(rawTarget)
    if (!targetId) {
      diagnostics.push(createSemanticAliasUnsupportedDiagnostic(node, rawTarget, options))
      continue
    }

    const targetNode = nodeById.get(targetId)
    if (!targetNode) {
      diagnostics.push(createSemanticAliasMissingDiagnostic(node, targetId, rawTarget, options))
      continue
    }

    aliases.push({
      sourceId: node.id,
      targetId,
      sourcePath: node.sourcePath,
      sourcePointer: node.sourcePointer,
      sourceContentHash: node.contentHash,
      targetSourcePath: targetNode.sourcePath,
      targetSourcePointer: targetNode.sourcePointer,
      targetContentHash: targetNode.contentHash,
    })
  }

  return aliases
}

function collectStructuralDuplicateDiagnostics(
  nodes: readonly DefinitionRegistryNode[],
  semanticAliases: readonly DefinitionSemanticAlias[],
  options: DefinitionRegistryOptions,
): DefinitionRegistryDiagnostic[] {
  const severity = options.structuralDuplicateSeverity ?? 'info'
  if (severity === 'off') return []

  const groups = new Map<string, DefinitionRegistryNode[]>()
  for (const node of nodes) {
    if (node.kind !== 'schema') continue

    const group = groups.get(node.contentHash)
    if (group) {
      group.push(node)
    } else {
      groups.set(node.contentHash, [node])
    }
  }

  const intentionallyAliasedIds = new Set<CanonicalDefinitionId>()
  for (const group of groups.values()) {
    const groupIds = new Set(group.map(node => node.id))
    for (const alias of semanticAliases) {
      if (groupIds.has(alias.sourceId) && groupIds.has(alias.targetId)) {
        intentionallyAliasedIds.add(alias.sourceId)
      }
    }
  }

  const diagnostics: DefinitionRegistryDiagnostic[] = []
  for (const group of groups.values()) {
    const unaliasedNodes = group.filter(node => !intentionallyAliasedIds.has(node.id))
    if (unaliasedNodes.length <= 1) continue

    const firstNode = unaliasedNodes[0]
    if (!firstNode) continue
    const ids = unaliasedNodes.map(node => node.id)
    diagnostics.push({
      code: 'definition-registry/structural-duplicate',
      severity,
      ids,
      contentHash: firstNode.contentHash,
      sourcePath: firstNode.sourcePath,
      sourcePointer: firstNode.sourcePointer,
      message: `Schema content hash "${firstNode.contentHash}" is shared by multiple canonical ids (${ids.join(', ')}); definitions remain separate unless an explicit semantic alias is declared.`,
    })
  }

  return diagnostics
}

function readSemanticAliasTarget(metadata: DefinitionNode['metadata']): unknown {
  if (!metadata) return undefined
  return metadata.semanticAliasOf
}

function normalizeSemanticAliasTarget(target: unknown): CanonicalDefinitionId | undefined {
  if (typeof target !== 'string') return undefined

  const canonicalRefTarget = normalizeCanonicalRef(target)
  if (canonicalRefTarget) return canonicalRefTarget

  const result = validateDefinitionId(target)
  return result.valid ? result.id.id : undefined
}

function createSemanticAliasUnsupportedDiagnostic(
  node: DefinitionRegistryNode,
  rawTarget: unknown,
  options: DefinitionRegistryOptions,
): DefinitionRegistryDiagnostic {
  const location = options.lookupSourceLocation?.(node.sourcePath, node.sourcePointer)
  const ref = String(rawTarget)
  const diagnostic: DefinitionRegistryDiagnostic = {
    code: 'definition-registry/unsupported-ref',
    severity: 'error',
    ref,
    sourcePath: node.sourcePath,
    sourcePointer: node.sourcePointer,
    message: `Semantic alias for "${node.id}" must target a valid canonical id or oa:// definition ref.`,
  }

  if (location) {
    diagnostic.line = location.line
    diagnostic.column = location.column
  }

  return diagnostic
}

function createSemanticAliasMissingDiagnostic(
  node: DefinitionRegistryNode,
  targetId: CanonicalDefinitionId,
  rawTarget: unknown,
  options: DefinitionRegistryOptions,
): DefinitionRegistryDiagnostic {
  const location = options.lookupSourceLocation?.(node.sourcePath, node.sourcePointer)
  const diagnostic: DefinitionRegistryDiagnostic = {
    code: 'definition-registry/missing-ref',
    severity: 'error',
    id: targetId,
    ref: String(rawTarget),
    sourcePath: node.sourcePath,
    sourcePointer: node.sourcePointer,
    message: `Semantic alias for "${node.id}" resolves to missing canonical id "${targetId}".`,
  }

  if (location) {
    diagnostic.line = location.line
    diagnostic.column = location.column
  }

  return diagnostic
}

function normalizeCanonicalRef(ref: string): CanonicalDefinitionId | undefined {
  const prefix = 'oa://'
  if (!isCanonicalRef(ref)) return undefined

  const parts = ref.slice(prefix.length).split('/')
  if (parts.length !== 4) return undefined

  const [kind, scope, domain, name] = parts
  const result = validateDefinitionId(`${kind}:${scope}/${domain}/${name}`)
  return result.valid ? result.id.id : undefined
}

function createMissingTargetDiagnostic(
  ref: DefinitionRef,
  options: DefinitionRegistryOptions,
): DefinitionRegistryDiagnostic {
  const diagnosticInput: RefDiagnosticInput = {
    code: 'definition-registry/missing-ref',
    ref,
    options,
    message: `Definition ref "${ref.ref}" resolves to missing canonical id "${ref.targetId}".`,
  }
  if (ref.targetId !== undefined) diagnosticInput.id = ref.targetId
  return createRefDiagnostic(diagnosticInput)
}

function createUnsupportedRefDiagnostic(
  ref: DefinitionRef,
  options: DefinitionRegistryOptions,
  message: string,
): DefinitionRegistryDiagnostic {
  return createRefDiagnostic({
    code: 'definition-registry/unsupported-ref',
    ref,
    options,
    message,
  })
}

type RefDiagnosticInput = {
  code: DefinitionRegistryDiagnosticCode
  ref: DefinitionRef
  options: DefinitionRegistryOptions
  message: string
  id?: CanonicalDefinitionId
  filePath?: string
  pointer?: string
}

function createRefDiagnostic(input: RefDiagnosticInput): DefinitionRegistryDiagnostic {
  const location = input.options.lookupSourceLocation?.(input.ref.sourcePath, input.ref.sourcePointer)
  const diagnostic: DefinitionRegistryDiagnostic = {
    code: input.code,
    severity: 'error',
    message: input.message,
    ref: input.ref.ref,
    sourcePath: input.ref.sourcePath,
    sourcePointer: input.ref.sourcePointer,
  }

  if (input.id !== undefined) diagnostic.id = input.id
  if (input.filePath !== undefined) diagnostic.filePath = input.filePath
  if (input.pointer !== undefined) diagnostic.pointer = input.pointer
  if (location) {
    diagnostic.line = location.line
    diagnostic.column = location.column
  }

  return diagnostic
}

function isCanonicalRef(ref: string): boolean {
  return ref.startsWith('oa://')
}

function sourceKey(sourcePath: string, sourcePointer: string): string {
  return `${sourcePath}\0${sourcePointer}`
}

function normalizeSourcePath(sourcePath: string): string {
  return resolve(sourcePath)
}
