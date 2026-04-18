import type {
  CanonicalDefinitionId,
  DefinitionOpenApiEmitResult,
  DefinitionOutputAliasMetadata,
  DefinitionOutputNameCollisionReportEntry,
  DefinitionRegistry,
  DefinitionRegistryNode,
  DefinitionRegistryRefEdge,
  DefinitionTargetConfig,
  DefinitionTargetSelectionResult,
} from '@oa-sdk/parser'

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

export type BuildSpecCompositionReportOptions = {
  targetPath: string
  fragmentsDir: string
  target: DefinitionTargetConfig
  registry: DefinitionRegistry
  selection: DefinitionTargetSelectionResult
  emitted: DefinitionOpenApiEmitResult
}

export type BuildSpecCompositionReport = {
  schemaVersion: 'oa-gen.composition-report.v1'
  target: {
    name: string
    targetPath: string
    fragmentsDir: string
    scopes: string[]
    domains: string[]
    includePaths: string[]
    includeDefinitions: string[]
  }
  summary: {
    registryNodeCount: number
    selectedNodeCount: number
    directPathCount: number
    directDefinitionCount: number
    transitiveComponentCount: number
    omittedNodeCount: number
    sourceRefCount: number
    outputAliasCount: number
    renamedOutputAliasCount: number
    collisionReportCount: number
  }
  selected: {
    directPathIds: CanonicalDefinitionId[]
    directDefinitionIds: CanonicalDefinitionId[]
    transitiveComponentIds: CanonicalDefinitionId[]
    selectedNodeIds: CanonicalDefinitionId[]
  }
  output: {
    paths: BuildSpecCompositionOutputPath[]
    components: BuildSpecCompositionOutputComponent[]
    aliases: DefinitionOutputAliasMetadata[]
    renamedAliases: DefinitionOutputAliasMetadata[]
    collisionReport: DefinitionOutputNameCollisionReportEntry[]
  }
  omitted: {
    total: number
    byScope: Record<string, number>
    byDomain: Record<string, number>
    byKind: Record<string, number>
  }
  sourceRefs: BuildSpecCompositionSourceRef[]
}

export type BuildSpecCompositionOutputPath = {
  canonicalId: CanonicalDefinitionId
  openApiPath?: string
  direct: boolean
  sourcePath: string
  sourcePointer: string
}

export type BuildSpecCompositionOutputComponent = {
  canonicalId: CanonicalDefinitionId
  kind: ComponentLikeKind
  section: string
  outputName: string
  outputPointer: string
  direct: boolean
  sourcePath: string
  sourcePointer: string
}

export type BuildSpecCompositionSourceRef = {
  sourceId: CanonicalDefinitionId
  ref: string
  sourcePath: string
  sourcePointer: string
  targetId?: CanonicalDefinitionId
}

export function createBuildSpecCompositionReport(
  options: BuildSpecCompositionReportOptions,
): BuildSpecCompositionReport {
  const directPathIds = new Set(options.selection.directPathIds)
  const directDefinitionIds = new Set(options.selection.directDefinitionIds)
  const selectedIds = new Set(options.selection.nodes.map(node => node.id))
  const omittedNodes = options.registry.nodes.filter(node => !selectedIds.has(node.id))
  const transitiveComponentIds = options.selection.nodes
    .filter(node => isComponentLikeKind(node.kind))
    .filter(node => !directDefinitionIds.has(node.id))
    .map(node => node.id)
    .sort((left, right) => left.localeCompare(right))
  const sourceRefs = options.selection.refEdges
    .map(toSourceRef)
    .sort((left, right) => (
      left.sourceId.localeCompare(right.sourceId)
      || (left.targetId ?? '').localeCompare(right.targetId ?? '')
      || left.ref.localeCompare(right.ref)
      || left.sourcePointer.localeCompare(right.sourcePointer)
    ))

  return {
    schemaVersion: 'oa-gen.composition-report.v1',
    target: {
      name: options.target.name,
      targetPath: options.targetPath,
      fragmentsDir: options.fragmentsDir,
      scopes: [...options.target.scopes],
      domains: [...options.target.domains],
      includePaths: [...options.target.includePaths],
      includeDefinitions: [...(options.target.includeDefinitions ?? [])],
    },
    summary: {
      registryNodeCount: options.registry.nodes.length,
      selectedNodeCount: options.selection.nodes.length,
      directPathCount: options.selection.directPathIds.length,
      directDefinitionCount: options.selection.directDefinitionIds.length,
      transitiveComponentCount: transitiveComponentIds.length,
      omittedNodeCount: omittedNodes.length,
      sourceRefCount: sourceRefs.length,
      outputAliasCount: options.emitted.report.aliases.length,
      renamedOutputAliasCount: options.emitted.report.renamedAliases.length,
      collisionReportCount: options.emitted.report.collisionReport.length,
    },
    selected: {
      directPathIds: [...options.selection.directPathIds],
      directDefinitionIds: [...options.selection.directDefinitionIds],
      transitiveComponentIds,
      selectedNodeIds: options.selection.nodes
        .map(node => node.id)
        .sort((left, right) => left.localeCompare(right)),
    },
    output: {
      paths: options.selection.nodes
        .filter((node): node is DefinitionRegistryNode & { kind: 'path' } => node.kind === 'path')
        .map(node => toOutputPath(node, directPathIds))
        .sort((left, right) => (
          (left.openApiPath ?? '').localeCompare(right.openApiPath ?? '')
          || left.canonicalId.localeCompare(right.canonicalId)
        )),
      components: options.selection.nodes
        .filter((node): node is DefinitionRegistryNode & { kind: ComponentLikeKind } => isComponentLikeKind(node.kind))
        .map(node => toOutputComponent(node, directDefinitionIds, options.selection))
        .sort((left, right) => (
          left.section.localeCompare(right.section)
          || left.outputName.localeCompare(right.outputName)
          || left.canonicalId.localeCompare(right.canonicalId)
        )),
      aliases: [...options.emitted.report.aliases],
      renamedAliases: [...options.emitted.report.renamedAliases],
      collisionReport: [...options.emitted.report.collisionReport],
    },
    omitted: {
      total: omittedNodes.length,
      byScope: countBy(omittedNodes, node => node.scope),
      byDomain: countBy(omittedNodes, node => node.domain),
      byKind: countBy(omittedNodes, node => node.kind),
    },
    sourceRefs,
  }
}

function toOutputPath(
  node: DefinitionRegistryNode & { kind: 'path' },
  directPathIds: ReadonlySet<CanonicalDefinitionId>,
): BuildSpecCompositionOutputPath {
  const result: BuildSpecCompositionOutputPath = {
    canonicalId: node.id,
    direct: directPathIds.has(node.id),
    sourcePath: node.sourcePath,
    sourcePointer: node.sourcePointer,
  }
  const openApiPath = readPathMetadata(node)
  if (openApiPath !== undefined) result.openApiPath = openApiPath
  return result
}

function toOutputComponent(
  node: DefinitionRegistryNode & { kind: ComponentLikeKind },
  directDefinitionIds: ReadonlySet<CanonicalDefinitionId>,
  selection: DefinitionTargetSelectionResult,
): BuildSpecCompositionOutputComponent {
  const section = COMPONENT_SECTION_BY_KIND[node.kind]
  const outputName = selection.outputNameAllocation.outputNames.get(node.id) ?? node.localName
  return {
    canonicalId: node.id,
    kind: node.kind,
    section,
    outputName,
    outputPointer: `#/components/${section}/${encodePointerToken(outputName)}`,
    direct: directDefinitionIds.has(node.id),
    sourcePath: node.sourcePath,
    sourcePointer: node.sourcePointer,
  }
}

function toSourceRef(edge: DefinitionRegistryRefEdge): BuildSpecCompositionSourceRef {
  const ref: BuildSpecCompositionSourceRef = {
    sourceId: edge.sourceId,
    ref: edge.ref,
    sourcePath: edge.sourcePath,
    sourcePointer: edge.sourcePointer,
  }
  if (edge.targetId !== undefined) ref.targetId = edge.targetId
  return ref
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
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const property = (value as Record<string, unknown>)[key]
  return typeof property === 'string' ? property : undefined
}

function isComponentLikeKind(kind: string): kind is ComponentLikeKind {
  return Object.prototype.hasOwnProperty.call(COMPONENT_SECTION_BY_KIND, kind)
}

function countBy<T>(items: readonly T[], getKey: (item: T) => string): Record<string, number> {
  const counts = new Map<string, number>()
  for (const item of items) {
    const key = getKey(item)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)))
}

function encodePointerToken(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1')
}
