import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type {
  CanonicalDefinitionId,
  DefinitionRegistryNode,
  DefinitionTargetSelectionResult,
} from '@oa-sdk/parser'

const OPERATION_METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
  'query',
] as const

const COMPONENT_SECTION_BY_KIND = {
  schema: 'schemas',
  response: 'responses',
  parameter: 'parameters',
  requestBody: 'requestBodies',
  header: 'headers',
  link: 'links',
  callback: 'callbacks',
  securityScheme: 'securitySchemes',
} as const

type ComponentLikeKind = keyof typeof COMPONENT_SECTION_BY_KIND

export type BuildSpecProvenanceEntry = {
  canonicalId: CanonicalDefinitionId
  kind: string
  sourcePath: string
  sourcePointer: string
  contentHash: string
}

export type BuildSpecProvenanceMap = Record<string, BuildSpecProvenanceEntry>

export type BuildSpecProvenanceDiffKind = 'added' | 'removed' | 'changed'

export type BuildSpecProvenanceDiffEntry = {
  kind: BuildSpecProvenanceDiffKind
  pointer: string
  message: string
  base?: BuildSpecProvenanceEntry
  head?: BuildSpecProvenanceEntry
}

export function createBuildSpecProvenanceMap(
  selection: DefinitionTargetSelectionResult,
): BuildSpecProvenanceMap {
  const provenance: BuildSpecProvenanceMap = {}

  for (const node of selection.nodes) {
    if (node.kind === 'path') {
      addPathProvenance(provenance, node)
      continue
    }
    if (isComponentLikeNode(node)) {
      addComponentProvenance(provenance, node, selection)
    }
  }

  return Object.fromEntries(
    Object.entries(provenance).sort(([left], [right]) => left.localeCompare(right)),
  )
}

export function loadBuildSpecProvenanceMap(filePath: string): BuildSpecProvenanceMap {
  const resolved = resolve(process.cwd(), filePath)
  const parsed = JSON.parse(readFileSync(resolved, 'utf8')) as unknown
  if (!isRecord(parsed)) {
    throw new Error(`Provenance sidecar must be an object: ${resolved}`)
  }

  const map: BuildSpecProvenanceMap = {}
  for (const [pointer, value] of Object.entries(parsed)) {
    if (!isRecord(value)) {
      throw new Error(`Invalid provenance entry at ${pointer}: expected object`)
    }
    if (
      typeof value.canonicalId !== 'string'
      || typeof value.kind !== 'string'
      || typeof value.sourcePath !== 'string'
      || typeof value.sourcePointer !== 'string'
      || typeof value.contentHash !== 'string'
    ) {
      throw new Error(`Invalid provenance entry at ${pointer}: missing canonicalId/kind/sourcePath/sourcePointer/contentHash`)
    }
    map[pointer] = {
      canonicalId: value.canonicalId as CanonicalDefinitionId,
      kind: value.kind,
      sourcePath: value.sourcePath,
      sourcePointer: value.sourcePointer,
      contentHash: value.contentHash,
    }
  }
  return Object.fromEntries(
    Object.entries(map).sort(([left], [right]) => left.localeCompare(right)),
  )
}

export function diffBuildSpecProvenanceMaps(
  base: BuildSpecProvenanceMap,
  head: BuildSpecProvenanceMap,
): BuildSpecProvenanceDiffEntry[] {
  const entries: BuildSpecProvenanceDiffEntry[] = []
  const pointers = [...new Set([
    ...Object.keys(base),
    ...Object.keys(head),
  ])].sort((left, right) => left.localeCompare(right))

  for (const pointer of pointers) {
    const baseEntry = base[pointer]
    const headEntry = head[pointer]
    if (baseEntry === undefined && headEntry !== undefined) {
      entries.push({
        kind: 'added',
        pointer,
        message: `Provenance added for ${pointer}.`,
        head: headEntry,
      })
      continue
    }
    if (baseEntry !== undefined && headEntry === undefined) {
      entries.push({
        kind: 'removed',
        pointer,
        message: `Provenance removed for ${pointer}.`,
        base: baseEntry,
      })
      continue
    }
    if (baseEntry === undefined || headEntry === undefined) continue
    if (stableStringify(baseEntry) === stableStringify(headEntry)) continue
    entries.push({
      kind: 'changed',
      pointer,
      message: `Provenance changed for ${pointer}.`,
      base: baseEntry,
      head: headEntry,
    })
  }

  return entries
}

function addPathProvenance(
  provenance: BuildSpecProvenanceMap,
  node: DefinitionRegistryNode,
): void {
  const openApiPath = readPathMetadata(node)
  if (openApiPath === undefined) return

  const pathPointer = `#/paths/${encodePointerToken(openApiPath)}`
  provenance[pathPointer] = toProvenanceEntry(node, node.sourcePointer)

  const content = isRecord(node.content) ? node.content : undefined
  if (!content) return
  for (const method of OPERATION_METHODS) {
    if (!isRecord(content[method])) continue
    provenance[`${pathPointer}/${method}`] = toProvenanceEntry(
      node,
      `${node.sourcePointer}/${method}`,
    )
  }
}

function addComponentProvenance(
  provenance: BuildSpecProvenanceMap,
  node: DefinitionRegistryNode & { kind: ComponentLikeKind },
  selection: DefinitionTargetSelectionResult,
): void {
  const section = COMPONENT_SECTION_BY_KIND[node.kind]
  const outputName = selection.outputNameAllocation.outputNames.get(node.id) ?? node.localName
  provenance[`#/components/${section}/${encodePointerToken(outputName)}`] =
    toProvenanceEntry(node, node.sourcePointer)
}

function toProvenanceEntry(
  node: DefinitionRegistryNode,
  sourcePointer: string,
): BuildSpecProvenanceEntry {
  return {
    canonicalId: node.id,
    kind: node.kind,
    sourcePath: node.sourcePath,
    sourcePointer,
    contentHash: node.contentHash,
  }
}

function readPathMetadata(node: DefinitionRegistryNode): string | undefined {
  return readStringProperty(node.metadata, 'path')
    ?? readStringProperty(node.metadata, 'openApiPath')
    ?? readStringProperty(node.metadata, 'openapiPath')
    ?? readStringProperty(node.content, 'path')
    ?? readStringProperty(node.content, 'openApiPath')
    ?? readStringProperty(node.content, 'openapiPath')
}

function readStringProperty(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined
  const property = value[key]
  return typeof property === 'string' ? property : undefined
}

function isComponentLikeKind(kind: string): kind is ComponentLikeKind {
  return Object.prototype.hasOwnProperty.call(COMPONENT_SECTION_BY_KIND, kind)
}

function isComponentLikeNode(
  node: DefinitionRegistryNode,
): node is DefinitionRegistryNode & { kind: ComponentLikeKind } {
  return isComponentLikeKind(node.kind)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function encodePointerToken(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1')
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(item => stableStringify(item)).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
    .join(',')}}`
}
