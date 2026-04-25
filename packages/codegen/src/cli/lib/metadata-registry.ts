import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import {
  parseDefinitionId,
  type CanonicalDefinitionId,
  type DefinitionRegistryNode,
  type DefinitionTargetSelectionResult,
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

export const METADATA_REGISTRY_SCHEMA_VERSION = 'oa-gen.metadata-registry.v1'
export const METADATA_STABLE_KEY_NAMESPACE = 'oa-meta'
export const METADATA_STABLE_KEY_VERSION = 'v1'

const METADATA_STABLE_KEY_HASH_DOMAIN = 'oa-gen.metadata-registry.stable-key.v1'
const METADATA_TRACKING_ID_HASH_DOMAIN = 'oa-gen.metadata-registry.tracking-id.v1'

export type BuildSpecMetadataTrackingIdSource = 'explicit' | 'generated'

export type BuildSpecMetadataRegistry = {
  schemaVersion: typeof METADATA_REGISTRY_SCHEMA_VERSION
  targetName: string
  summary: BuildSpecMetadataRegistrySummary
  duplicates: BuildSpecMetadataRegistryDuplicates
  entries: Record<string, BuildSpecMetadataRegistryEntry>
}

export type BuildSpecMetadataRegistrySummary = {
  entryCount: number
  explicitTrackingIdCount: number
  generatedTrackingIdCount: number
  invalidTrackingIdCount: number
  duplicateTrackingIdCount: number
  duplicateStableKeyCount: number
  duplicateOutputPointerCount: number
}

export type BuildSpecMetadataRegistryDuplicates = {
  trackingIds: BuildSpecMetadataDuplicateTrackingId[]
  stableKeys: BuildSpecMetadataDuplicateStableKey[]
  outputPointers: BuildSpecMetadataDuplicateOutputPointer[]
}

export type BuildSpecMetadataDuplicateTrackingId = {
  trackingId: string
  entries: BuildSpecMetadataDuplicateEntry[]
}

export type BuildSpecMetadataDuplicateStableKey = {
  stableKey: string
  entries: BuildSpecMetadataDuplicateEntry[]
}

export type BuildSpecMetadataDuplicateOutputPointer = {
  pointer: string
  entries: BuildSpecMetadataDuplicateEntry[]
}

export type BuildSpecMetadataDuplicateEntry = {
  pointer: string
  canonicalId: CanonicalDefinitionId
  kind: string
  sourcePath: string
  sourcePointer: string
  trackingId: string
  trackingIdSource: BuildSpecMetadataTrackingIdSource
  identityKey: string
  identitySource: BuildSpecMetadataIdentitySource
  stableKey: string
}

export type BuildSpecMetadataIdentitySource = 'canonical' | 'replacement'

export type BuildSpecMetadataInvalidTrackingId = {
  value: unknown
  reason: string
}

export type BuildSpecMetadataInvalidReplacementId = {
  value: unknown
  reason: string
}

export type BuildSpecMetadataRegistryEntry = {
  pointer: string
  canonicalId: CanonicalDefinitionId
  kind: string
  sourcePath: string
  sourcePointer: string
  contentHash: string
  trackingId: string
  trackingIdSource: BuildSpecMetadataTrackingIdSource
  identityKey: string
  identitySource: BuildSpecMetadataIdentitySource
  stableKey: string
  metadata: Record<string, unknown>
  openApiPath?: string
  method?: string
  componentSection?: string
  outputName?: string
  replaces?: CanonicalDefinitionId[]
  invalidTrackingId?: BuildSpecMetadataInvalidTrackingId
  invalidReplaces?: BuildSpecMetadataInvalidReplacementId[]
  refs?: BuildSpecMetadataRegistryRef[]
  examples?: BuildSpecMetadataRegistryExample[]
}

export type BuildSpecMetadataRegistryRef = {
  ref: string
  sourcePointer: string
  targetId?: CanonicalDefinitionId
}

export type BuildSpecMetadataRegistryExample = {
  sourcePointer: string
}

export type BuildSpecMetadataRegistryDiagnosticCode =
  | 'metadata-registry/duplicate-output-pointer'
  | 'metadata-registry/duplicate-tracking-id'
  | 'metadata-registry/duplicate-stable-key'
  | 'metadata-registry/invalid-tracking-id'
  | 'metadata-registry/invalid-replaces-id'

export type BuildSpecMetadataRegistryDiagnostic = {
  code: BuildSpecMetadataRegistryDiagnosticCode
  severity: 'error'
  message: string
  targetName: string
  trackingId?: string
  stableKey?: string
  outputPointer?: string
  pointer?: string
  pointers: string[]
  sourcePath?: string
  sourcePointer?: string
  value?: unknown
}

export type BuildSpecMetadataRegistryResult = {
  registry: BuildSpecMetadataRegistry
  diagnostics: BuildSpecMetadataRegistryDiagnostic[]
}

export type BuildSpecMetadataRegistryDiffKind = 'added' | 'removed' | 'changed'

export type BuildSpecMetadataRegistryDiffEntry = {
  kind: BuildSpecMetadataRegistryDiffKind
  pointer: string
  message: string
  base?: BuildSpecMetadataRegistryEntry
  head?: BuildSpecMetadataRegistryEntry
}

type MetadataEntryBuckets = Map<string, BuildSpecMetadataRegistryEntry[]>

export function createBuildSpecMetadataRegistry(
  selection: DefinitionTargetSelectionResult,
): BuildSpecMetadataRegistryResult {
  const entryBuckets: MetadataEntryBuckets = new Map()

  for (const node of selection.nodes) {
    if (node.kind === 'path') {
      addPathMetadataEntries(entryBuckets, node, selection)
      continue
    }

    if (isComponentLikeNode(node)) {
      addComponentMetadataEntry(entryBuckets, node, selection)
    }
  }

  const allEntries = sortedAllEntries(entryBuckets)
  const sortedEntries = createStableEntriesMap(entryBuckets)
  const duplicates = collectDuplicates(entryBuckets, allEntries)
  const invalidTrackingIds = allEntries.filter(entry => entry.invalidTrackingId !== undefined)
  const invalidReplaces = allEntries.filter(entry => entry.invalidReplaces !== undefined && entry.invalidReplaces.length > 0)
  const registry: BuildSpecMetadataRegistry = {
    schemaVersion: METADATA_REGISTRY_SCHEMA_VERSION,
    targetName: selection.target.name,
    summary: {
      entryCount: Object.keys(sortedEntries).length,
      explicitTrackingIdCount: Object.values(sortedEntries)
        .filter(entry => entry.trackingIdSource === 'explicit').length,
      generatedTrackingIdCount: Object.values(sortedEntries)
        .filter(entry => entry.trackingIdSource === 'generated').length,
      invalidTrackingIdCount: invalidTrackingIds.length,
      duplicateTrackingIdCount: duplicates.trackingIds.length,
      duplicateStableKeyCount: duplicates.stableKeys.length,
      duplicateOutputPointerCount: duplicates.outputPointers.length,
    },
    duplicates,
    entries: sortedEntries,
  }
  return {
    registry,
    diagnostics: [
      ...createDuplicateDiagnostics(selection.target.name, duplicates),
      ...createInvalidTrackingIdDiagnostics(selection.target.name, invalidTrackingIds),
      ...createInvalidReplacesDiagnostics(selection.target.name, invalidReplaces),
    ],
  }
}

export function loadBuildSpecMetadataRegistry(filePath: string): BuildSpecMetadataRegistry {
  const resolved = resolve(process.cwd(), filePath)
  const parsed = JSON.parse(readFileSync(resolved, 'utf8')) as unknown
  if (!isRecord(parsed)) {
    throw new Error(`Metadata registry sidecar must be an object: ${resolved}`)
  }
  if (parsed.schemaVersion !== METADATA_REGISTRY_SCHEMA_VERSION) {
    throw new Error(`Invalid metadata registry schemaVersion: ${resolved}`)
  }
  if (typeof parsed.targetName !== 'string') {
    throw new Error(`Metadata registry targetName must be a string: ${resolved}`)
  }

  const summary = parsed.summary
  if (!isRecord(summary)) {
    throw new Error(`Metadata registry summary must be an object: ${resolved}`)
  }
  for (const key of [
    'entryCount',
    'explicitTrackingIdCount',
    'generatedTrackingIdCount',
    'invalidTrackingIdCount',
    'duplicateTrackingIdCount',
    'duplicateStableKeyCount',
    'duplicateOutputPointerCount',
  ] as const) {
    if (typeof summary[key] !== 'number') {
      throw new Error(`Metadata registry summary.${key} must be a number: ${resolved}`)
    }
  }

  const duplicates = parsed.duplicates
  if (!isRecord(duplicates)) {
    throw new Error(`Metadata registry duplicates must be an object: ${resolved}`)
  }
  if (
    !Array.isArray(duplicates.trackingIds)
    || !Array.isArray(duplicates.stableKeys)
    || !Array.isArray(duplicates.outputPointers)
  ) {
    throw new Error(`Metadata registry duplicates arrays are invalid: ${resolved}`)
  }

  const entries = parsed.entries
  if (!isRecord(entries)) {
    throw new Error(`Metadata registry entries must be an object: ${resolved}`)
  }

  const typedEntries: Record<string, BuildSpecMetadataRegistryEntry> = {}
  for (const [pointer, value] of Object.entries(entries)) {
    if (!isRecord(value)) {
      throw new Error(`Invalid metadata registry entry at ${pointer}: expected object`)
    }
    if (
      typeof value.pointer !== 'string'
      || typeof value.canonicalId !== 'string'
      || typeof value.kind !== 'string'
      || typeof value.sourcePath !== 'string'
      || typeof value.sourcePointer !== 'string'
      || typeof value.contentHash !== 'string'
      || typeof value.trackingId !== 'string'
      || (value.trackingIdSource !== 'explicit' && value.trackingIdSource !== 'generated')
      || typeof value.identityKey !== 'string'
      || (value.identitySource !== 'canonical' && value.identitySource !== 'replacement')
      || typeof value.stableKey !== 'string'
      || !isRecord(value.metadata)
    ) {
      throw new Error(`Invalid metadata registry entry at ${pointer}: missing required fields`)
    }
    typedEntries[pointer] = {
      pointer: value.pointer,
      canonicalId: value.canonicalId as CanonicalDefinitionId,
      kind: value.kind,
      sourcePath: value.sourcePath,
      sourcePointer: value.sourcePointer,
      contentHash: value.contentHash,
      trackingId: value.trackingId,
      trackingIdSource: value.trackingIdSource,
      identityKey: value.identityKey,
      identitySource: value.identitySource,
      stableKey: value.stableKey,
      metadata: { ...value.metadata },
      ...(typeof value.openApiPath === 'string' ? { openApiPath: value.openApiPath } : {}),
      ...(typeof value.method === 'string' ? { method: value.method } : {}),
      ...(typeof value.componentSection === 'string' ? { componentSection: value.componentSection } : {}),
      ...(typeof value.outputName === 'string' ? { outputName: value.outputName } : {}),
      ...(Array.isArray(value.replaces) ? { replaces: value.replaces as CanonicalDefinitionId[] } : {}),
      ...(Array.isArray(value.invalidReplaces) ? { invalidReplaces: value.invalidReplaces as BuildSpecMetadataInvalidReplacementId[] } : {}),
      ...(isRecord(value.invalidTrackingId) ? { invalidTrackingId: value.invalidTrackingId as BuildSpecMetadataInvalidTrackingId } : {}),
      ...(Array.isArray(value.refs) ? { refs: value.refs as BuildSpecMetadataRegistryRef[] } : {}),
      ...(Array.isArray(value.examples) ? { examples: value.examples as BuildSpecMetadataRegistryExample[] } : {}),
    }
  }

  return {
    schemaVersion: METADATA_REGISTRY_SCHEMA_VERSION,
    targetName: parsed.targetName,
    summary: {
      entryCount: summary.entryCount as number,
      explicitTrackingIdCount: summary.explicitTrackingIdCount as number,
      generatedTrackingIdCount: summary.generatedTrackingIdCount as number,
      invalidTrackingIdCount: summary.invalidTrackingIdCount as number,
      duplicateTrackingIdCount: summary.duplicateTrackingIdCount as number,
      duplicateStableKeyCount: summary.duplicateStableKeyCount as number,
      duplicateOutputPointerCount: summary.duplicateOutputPointerCount as number,
    },
    duplicates: {
      trackingIds: duplicates.trackingIds as BuildSpecMetadataDuplicateTrackingId[],
      stableKeys: duplicates.stableKeys as BuildSpecMetadataDuplicateStableKey[],
      outputPointers: duplicates.outputPointers as BuildSpecMetadataDuplicateOutputPointer[],
    },
    entries: Object.fromEntries(
      Object.entries(typedEntries).sort(([left], [right]) => left.localeCompare(right)),
    ),
  }
}

export function diffBuildSpecMetadataRegistries(
  base: BuildSpecMetadataRegistry,
  head: BuildSpecMetadataRegistry,
): BuildSpecMetadataRegistryDiffEntry[] {
  const differences: BuildSpecMetadataRegistryDiffEntry[] = []
  const pointers = [...new Set([
    ...Object.keys(base.entries),
    ...Object.keys(head.entries),
  ])].sort((left, right) => left.localeCompare(right))

  for (const pointer of pointers) {
    const baseEntry = base.entries[pointer]
    const headEntry = head.entries[pointer]
    if (baseEntry === undefined && headEntry !== undefined) {
      differences.push({
        kind: 'added',
        pointer,
        message: `Metadata registry entry added for ${pointer}.`,
        head: headEntry,
      })
      continue
    }
    if (baseEntry !== undefined && headEntry === undefined) {
      differences.push({
        kind: 'removed',
        pointer,
        message: `Metadata registry entry removed for ${pointer}.`,
        base: baseEntry,
      })
      continue
    }
    if (baseEntry === undefined || headEntry === undefined) continue
    if (stableStringify(baseEntry) === stableStringify(headEntry)) continue
    differences.push({
      kind: 'changed',
      pointer,
      message: `Metadata registry entry changed for ${pointer}.`,
      base: baseEntry,
      head: headEntry,
    })
  }

  return differences
}

function addPathMetadataEntries(
  entries: MetadataEntryBuckets,
  node: DefinitionRegistryNode,
  selection: DefinitionTargetSelectionResult,
): void {
  const openApiPath = readPathMetadata(node)
  if (openApiPath === undefined) return

  const pathMetadata = readMetadata(node.metadata)
  const pathReplacementIds = readReplacementIds(pathMetadata)
  const pathPointer = `#/paths/${encodePointerToken(openApiPath)}`
  addMetadataEntry(entries, createMetadataEntry({
    pointer: pathPointer,
    node,
    sourcePointer: node.sourcePointer,
    metadata: pathMetadata,
    replacementIds: pathReplacementIds,
    openApiPath,
    refs: refsForNode(selection, node, node.sourcePointer),
    examples: examplesForContent(node.content, node.sourcePointer),
  }))

  const content = isRecord(node.content) ? node.content : undefined
  if (!content) return

  for (const method of OPERATION_METHODS) {
    const operation = content[method]
    if (!isRecord(operation)) continue

    const sourcePointer = `${node.sourcePointer}/${method}`
    const operationPointer = `${pathPointer}/${method}`
    const operationMetadata = readOperationMetadata(node.metadata, method)
    addMetadataEntry(entries, createMetadataEntry({
      pointer: operationPointer,
      node,
      sourcePointer,
      metadata: operationMetadata,
      inheritedReplacementIds: pathReplacementIds.replaces,
      openApiPath,
      method,
      refs: refsForNode(selection, node, sourcePointer),
      examples: examplesForContent(operation, sourcePointer),
    }))
  }
}

function addComponentMetadataEntry(
  entries: MetadataEntryBuckets,
  node: DefinitionRegistryNode & { kind: ComponentLikeKind },
  selection: DefinitionTargetSelectionResult,
): void {
  const componentSection = COMPONENT_SECTION_BY_KIND[node.kind]
  const outputName = selection.outputNameAllocation.outputNames.get(node.id) ?? node.localName
  const pointer = `#/components/${componentSection}/${encodePointerToken(outputName)}`

  addMetadataEntry(entries, createMetadataEntry({
    pointer,
    node,
    sourcePointer: node.sourcePointer,
    metadata: readMetadata(node.metadata),
    componentSection,
    outputName,
    refs: refsForNode(selection, node, node.sourcePointer),
    examples: examplesForContent(node.content, node.sourcePointer),
  }))
}

function createMetadataEntry(input: {
  pointer: string
  node: DefinitionRegistryNode
  sourcePointer: string
  metadata: Record<string, unknown>
  replacementIds?: {
    replaces: CanonicalDefinitionId[]
    invalidReplaces: BuildSpecMetadataInvalidReplacementId[]
  }
  inheritedReplacementIds?: CanonicalDefinitionId[]
  openApiPath?: string
  method?: string
  componentSection?: string
  outputName?: string
  refs: BuildSpecMetadataRegistryRef[]
  examples: BuildSpecMetadataRegistryExample[]
}): BuildSpecMetadataRegistryEntry {
  const kind = input.method === undefined ? input.node.kind : 'operation'
  const replacementIds = input.replacementIds ?? readReplacementIds(input.metadata)
  const effectiveReplacementIds = replacementIds.replaces.length > 0
    ? replacementIds.replaces
    : (input.inheritedReplacementIds ?? [])
  const identitySource = effectiveReplacementIds.length > 0 ? 'replacement' : 'canonical'
  const identityKey = createIdentityKey(
    input.node.id,
    kind,
    input.method,
    effectiveReplacementIds,
  )
  const stableKey = createStableKey(identityKey)
  const explicitTracking = readTrackingId(input.metadata)
  const entry: BuildSpecMetadataRegistryEntry = {
    pointer: input.pointer,
    canonicalId: input.node.id,
    kind,
    sourcePath: input.node.sourcePath,
    sourcePointer: input.sourcePointer,
    contentHash: input.node.contentHash,
    trackingId: explicitTracking.trackingId ?? createGeneratedTrackingId(stableKey),
    trackingIdSource: explicitTracking.trackingId === undefined ? 'generated' : 'explicit',
    identityKey,
    identitySource,
    stableKey,
    metadata: input.metadata,
  }

  if (input.openApiPath !== undefined) entry.openApiPath = input.openApiPath
  if (input.method !== undefined) entry.method = input.method
  if (input.componentSection !== undefined) entry.componentSection = input.componentSection
  if (input.outputName !== undefined) entry.outputName = input.outputName
  if (effectiveReplacementIds.length > 0) entry.replaces = effectiveReplacementIds
  if (replacementIds.invalidReplaces.length > 0) entry.invalidReplaces = replacementIds.invalidReplaces
  if (explicitTracking.invalidTrackingId !== undefined) entry.invalidTrackingId = explicitTracking.invalidTrackingId
  if (input.refs.length > 0) entry.refs = input.refs
  if (input.examples.length > 0) entry.examples = input.examples

  return entry
}

function addMetadataEntry(
  entries: MetadataEntryBuckets,
  entry: BuildSpecMetadataRegistryEntry,
): void {
  const bucket = entries.get(entry.pointer)
  if (bucket) {
    bucket.push(entry)
  } else {
    entries.set(entry.pointer, [entry])
  }
}

function createStableEntriesMap(
  buckets: MetadataEntryBuckets,
): Record<string, BuildSpecMetadataRegistryEntry> {
  return Object.fromEntries(
    [...buckets.entries()]
      .map(([pointer, entries]) => [
        pointer,
        [...entries].sort(compareMetadataEntries)[0],
      ] as const)
      .filter((entry): entry is readonly [string, BuildSpecMetadataRegistryEntry] => entry[1] !== undefined)
      .sort(([left], [right]) => left.localeCompare(right)),
  )
}

function sortedAllEntries(buckets: MetadataEntryBuckets): BuildSpecMetadataRegistryEntry[] {
  return [...buckets.values()]
    .flatMap(entries => entries)
    .sort(compareMetadataEntries)
}

function compareMetadataEntries(
  left: BuildSpecMetadataRegistryEntry,
  right: BuildSpecMetadataRegistryEntry,
): number {
  return left.pointer.localeCompare(right.pointer)
    || left.identityKey.localeCompare(right.identityKey)
    || left.canonicalId.localeCompare(right.canonicalId)
    || left.sourcePath.localeCompare(right.sourcePath)
    || left.sourcePointer.localeCompare(right.sourcePointer)
}

function collectDuplicates(
  buckets: MetadataEntryBuckets,
  entries: readonly BuildSpecMetadataRegistryEntry[],
): BuildSpecMetadataRegistryDuplicates {
  const trackingIds = groupDuplicateEntries(entries, entry => entry.trackingId)
    .map(([trackingId, duplicateEntries]) => ({ trackingId, entries: duplicateEntries }))
  const stableKeys = groupDuplicateEntries(entries, entry => entry.stableKey)
    .map(([stableKey, duplicateEntries]) => ({ stableKey, entries: duplicateEntries }))
  const outputPointers = [...buckets.entries()]
    .filter(([, bucket]) => bucket.length > 1)
    .map(([pointer, bucket]) => ({
      pointer,
      entries: bucket.map(toDuplicateEntry).sort(compareDuplicateEntries),
    }))
    .sort((left, right) => left.pointer.localeCompare(right.pointer))

  return {
    trackingIds,
    stableKeys,
    outputPointers,
  }
}

function groupDuplicateEntries(
  entries: readonly BuildSpecMetadataRegistryEntry[],
  getKey: (entry: BuildSpecMetadataRegistryEntry) => string,
): Array<[string, BuildSpecMetadataDuplicateEntry[]]> {
  const byKey = new Map<string, BuildSpecMetadataDuplicateEntry[]>()
  for (const entry of entries) {
    const key = getKey(entry)
    const duplicateEntry = toDuplicateEntry(entry)
    const group = byKey.get(key)
    if (group) {
      group.push(duplicateEntry)
    } else {
      byKey.set(key, [duplicateEntry])
    }
  }

  return [...byKey.entries()]
    .filter(([, duplicateEntries]) => duplicateEntries.length > 1)
    .map(([key, duplicateEntries]): [string, BuildSpecMetadataDuplicateEntry[]] => [
      key,
      duplicateEntries.sort(compareDuplicateEntries),
    ])
    .sort(([left], [right]) => left.localeCompare(right))
}

function compareDuplicateEntries(
  left: BuildSpecMetadataDuplicateEntry,
  right: BuildSpecMetadataDuplicateEntry,
): number {
  return left.pointer.localeCompare(right.pointer)
    || left.identityKey.localeCompare(right.identityKey)
    || left.canonicalId.localeCompare(right.canonicalId)
    || left.sourcePath.localeCompare(right.sourcePath)
    || left.sourcePointer.localeCompare(right.sourcePointer)
}

function toDuplicateEntry(entry: BuildSpecMetadataRegistryEntry): BuildSpecMetadataDuplicateEntry {
  return {
    pointer: entry.pointer,
    canonicalId: entry.canonicalId,
    kind: entry.kind,
    sourcePath: entry.sourcePath,
    sourcePointer: entry.sourcePointer,
    trackingId: entry.trackingId,
    trackingIdSource: entry.trackingIdSource,
    identityKey: entry.identityKey,
    identitySource: entry.identitySource,
    stableKey: entry.stableKey,
  }
}

function createDuplicateDiagnostics(
  targetName: string,
  duplicates: BuildSpecMetadataRegistryDuplicates,
): BuildSpecMetadataRegistryDiagnostic[] {
  return [
    ...duplicates.outputPointers.map(duplicate => ({
      code: 'metadata-registry/duplicate-output-pointer' as const,
      severity: 'error' as const,
      targetName,
      outputPointer: duplicate.pointer,
      pointer: duplicate.pointer,
      pointers: [duplicate.pointer],
      message: `Metadata registry output pointer "${duplicate.pointer}" is assigned to multiple metadata entries: ${duplicate.entries.map(entry => entry.identityKey).join(', ')}.`,
    })),
    ...duplicates.trackingIds.map(duplicate => ({
      code: 'metadata-registry/duplicate-tracking-id' as const,
      severity: 'error' as const,
      targetName,
      trackingId: duplicate.trackingId,
      pointers: duplicate.entries.map(entry => entry.pointer),
      message: `Metadata registry tracking id "${duplicate.trackingId}" is assigned to multiple output pointers: ${duplicate.entries.map(entry => entry.pointer).join(', ')}.`,
    })),
    ...duplicates.stableKeys.map(duplicate => ({
      code: 'metadata-registry/duplicate-stable-key' as const,
      severity: 'error' as const,
      targetName,
      stableKey: duplicate.stableKey,
      pointers: duplicate.entries.map(entry => entry.pointer),
      message: `Metadata registry stable key "${duplicate.stableKey}" is assigned to multiple output pointers: ${duplicate.entries.map(entry => entry.pointer).join(', ')}.`,
    })),
  ]
}

function createInvalidTrackingIdDiagnostics(
  targetName: string,
  entries: readonly BuildSpecMetadataRegistryEntry[],
): BuildSpecMetadataRegistryDiagnostic[] {
  return entries
    .filter((entry): entry is BuildSpecMetadataRegistryEntry & {
      invalidTrackingId: BuildSpecMetadataInvalidTrackingId
    } => entry.invalidTrackingId !== undefined)
    .map(entry => ({
      code: 'metadata-registry/invalid-tracking-id' as const,
      severity: 'error' as const,
      targetName,
      pointer: entry.pointer,
      pointers: [entry.pointer],
      sourcePath: entry.sourcePath,
      sourcePointer: entry.sourcePointer,
      value: entry.invalidTrackingId.value,
      message: `Metadata registry tracking id at ${entry.pointer} is invalid: ${entry.invalidTrackingId.reason}.`,
    }))
}

function createInvalidReplacesDiagnostics(
  targetName: string,
  entries: readonly BuildSpecMetadataRegistryEntry[],
): BuildSpecMetadataRegistryDiagnostic[] {
  return entries.flatMap(entry => (entry.invalidReplaces ?? []).map(invalid => ({
    code: 'metadata-registry/invalid-replaces-id' as const,
    severity: 'error' as const,
    targetName,
    pointer: entry.pointer,
    pointers: [entry.pointer],
    sourcePath: entry.sourcePath,
    sourcePointer: entry.sourcePointer,
    value: invalid.value,
    message: `Metadata registry replaces id at ${entry.pointer} is invalid: ${invalid.reason}.`,
  })))
}

function refsForNode(
  selection: DefinitionTargetSelectionResult,
  node: DefinitionRegistryNode,
  sourcePointerPrefix: string,
): BuildSpecMetadataRegistryRef[] {
  return selection.refEdges
    .filter(edge => edge.sourceId === node.id && (
      edge.sourcePointer === sourcePointerPrefix
      || edge.sourcePointer.startsWith(`${sourcePointerPrefix}/`)
    ))
    .map(edge => {
      const ref: BuildSpecMetadataRegistryRef = {
        ref: edge.ref,
        sourcePointer: edge.sourcePointer,
      }
      if (edge.targetId !== undefined) ref.targetId = edge.targetId
      return ref
    })
    .sort((left, right) => (
      left.sourcePointer.localeCompare(right.sourcePointer)
      || left.ref.localeCompare(right.ref)
      || (left.targetId ?? '').localeCompare(right.targetId ?? '')
    ))
}

function examplesForContent(
  value: unknown,
  sourcePointer: string,
): BuildSpecMetadataRegistryExample[] {
  const examples: BuildSpecMetadataRegistryExample[] = []
  collectExamples(value, sourcePointer, examples)
  return examples.sort((left, right) => left.sourcePointer.localeCompare(right.sourcePointer))
}

function collectExamples(
  value: unknown,
  pointer: string,
  examples: BuildSpecMetadataRegistryExample[],
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectExamples(item, `${pointer}/${index}`, examples))
    return
  }

  if (!isRecord(value)) return

  for (const [key, child] of Object.entries(value)) {
    const childPointer = `${pointer}/${encodePointerToken(key)}`
    if (key === 'example') {
      examples.push({ sourcePointer: childPointer })
      continue
    }

    if (key === 'examples') {
      if (isRecord(child)) {
        for (const name of Object.keys(child).sort((left, right) => left.localeCompare(right))) {
          examples.push({ sourcePointer: `${childPointer}/${encodePointerToken(name)}` })
        }
      } else {
        examples.push({ sourcePointer: childPointer })
      }
      continue
    }

    collectExamples(child, childPointer, examples)
  }
}

function readOperationMetadata(value: unknown, method: string): Record<string, unknown> {
  const metadata = readMetadata(value)
  const operations = readRecord(metadata.operations) ?? readRecord(metadata.methods)
  const operationMetadata = readRecord(operations?.[method])
  return operationMetadata ? { ...operationMetadata } : {}
}

function readTrackingId(metadata: Record<string, unknown>): {
  trackingId?: string
  invalidTrackingId?: BuildSpecMetadataInvalidTrackingId
} {
  if (Object.prototype.hasOwnProperty.call(metadata, 'trackingId')) {
    return normalizeTrackingId(metadata.trackingId, 'metadata.trackingId')
  }

  if (Object.prototype.hasOwnProperty.call(metadata, 'tracking')) {
    const tracking = metadata.tracking
    if (isRecord(tracking) && Object.prototype.hasOwnProperty.call(tracking, 'id')) {
      return normalizeTrackingId(tracking.id, 'metadata.tracking.id')
    }
    return normalizeTrackingId(tracking, 'metadata.tracking')
  }

  return {}
}

function normalizeTrackingId(value: unknown, source: string): {
  trackingId?: string
  invalidTrackingId?: BuildSpecMetadataInvalidTrackingId
} {
  if (typeof value !== 'string') {
    return {
      invalidTrackingId: {
        value,
        reason: `${source} must be a string`,
      },
    }
  }

  const normalized = value.trim()
  if (!/^trk_[a-z0-9][a-z0-9_:-]*$/.test(normalized)) {
    return {
      invalidTrackingId: {
        value,
        reason: `${source} must match /^trk_[a-z0-9][a-z0-9_:-]*$/ after trimming`,
      },
    }
  }

  return { trackingId: normalized }
}

function readReplacementIds(metadata: Record<string, unknown>): {
  replaces: CanonicalDefinitionId[]
  invalidReplaces: BuildSpecMetadataInvalidReplacementId[]
} {
  if (!Object.prototype.hasOwnProperty.call(metadata, 'replaces')) {
    return { replaces: [], invalidReplaces: [] }
  }

  const raw = metadata.replaces
  const values = Array.isArray(raw) ? raw : [raw]
  const replaces: CanonicalDefinitionId[] = []
  const invalidReplaces: BuildSpecMetadataInvalidReplacementId[] = []

  for (const value of values) {
    if (typeof value !== 'string') {
      invalidReplaces.push({
        value,
        reason: 'metadata.replaces entries must be canonical definition id strings',
      })
      continue
    }

    const normalized = value.trim()
    try {
      replaces.push(parseDefinitionId(normalized).id)
    } catch (error) {
      invalidReplaces.push({
        value,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    replaces: [...new Set(replaces)],
    invalidReplaces,
  }
}

function createIdentityKey(
  canonicalId: CanonicalDefinitionId,
  kind: string,
  method: string | undefined,
  replacements: readonly CanonicalDefinitionId[],
): string {
  const identityId = replacements[0] ?? canonicalId
  return method === undefined
    ? `definition:${identityId}`
    : `operation:${identityId}:${method}`
}

function createStableKey(identityKey: string): string {
  const digest = createHash('sha256')
    .update(METADATA_STABLE_KEY_HASH_DOMAIN)
    .update('\0')
    .update(identityKey)
    .digest('hex')
  return `${METADATA_STABLE_KEY_NAMESPACE}:${METADATA_STABLE_KEY_VERSION}:${digest.slice(0, 32)}`
}

function createGeneratedTrackingId(stableKey: string): string {
  const digest = createHash('sha256')
    .update(METADATA_TRACKING_ID_HASH_DOMAIN)
    .update('\0')
    .update(stableKey)
    .digest('hex')
  return `trk_${digest.slice(0, 16)}`
}

function readPathMetadata(node: DefinitionRegistryNode): string | undefined {
  return readStringProperty(node.metadata, 'path')
    ?? readStringProperty(node.metadata, 'openApiPath')
    ?? readStringProperty(node.metadata, 'openapiPath')
    ?? readStringProperty(node.content, 'path')
    ?? readStringProperty(node.content, 'openApiPath')
    ?? readStringProperty(node.content, 'openapiPath')
}

function readMetadata(value: unknown): Record<string, unknown> {
  return isRecord(value) ? { ...value } : {}
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
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
