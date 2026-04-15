import { parseDefinitionId, type CanonicalDefinitionId, type DefinitionId, type DefinitionKind } from './definition-id.js'

export type DefinitionMetadata = Readonly<Record<string, unknown>>

export type DefinitionRef = {
  ref: string
  sourcePath: string
  sourcePointer: string
  targetId?: CanonicalDefinitionId
  metadata?: DefinitionMetadata
}

export type DefinitionNode = {
  id: CanonicalDefinitionId
  kind: DefinitionKind
  scope: string
  domain: string
  localName: string
  sourcePath: string
  sourcePointer: string
  contentHash: string
  content: unknown
  metadata?: DefinitionMetadata
  refs: DefinitionRef[]
}

export type CreateDefinitionRefInput = {
  ref: string
  sourcePath: string
  sourcePointer: string
  targetId?: string | DefinitionId
  metadata?: DefinitionMetadata
}

export type CreateDefinitionNodeInput = {
  id: string | DefinitionId
  sourcePath: string
  sourcePointer: string
  contentHash: string
  content: unknown
  metadata?: DefinitionMetadata
  refs?: readonly DefinitionRef[]
}

export function createDefinitionRef(input: CreateDefinitionRefInput): DefinitionRef {
  const ref: DefinitionRef = {
    ref: input.ref,
    sourcePath: input.sourcePath,
    sourcePointer: input.sourcePointer,
  }

  if (input.targetId !== undefined) {
    ref.targetId = normalizeDefinitionId(input.targetId).id
  }
  if (input.metadata !== undefined) {
    ref.metadata = input.metadata
  }

  return ref
}

export function createDefinitionNode(input: CreateDefinitionNodeInput): DefinitionNode {
  const id = normalizeDefinitionId(input.id)
  const node: DefinitionNode = {
    id: id.id,
    kind: id.kind,
    scope: id.scope,
    domain: id.domain,
    localName: id.name,
    sourcePath: input.sourcePath,
    sourcePointer: input.sourcePointer,
    contentHash: input.contentHash,
    content: input.content,
    refs: [...(input.refs ?? [])],
  }

  if (input.metadata !== undefined) {
    node.metadata = input.metadata
  }

  return node
}

function normalizeDefinitionId(input: string | DefinitionId): DefinitionId {
  return typeof input === 'string' ? parseDefinitionId(input) : input
}
