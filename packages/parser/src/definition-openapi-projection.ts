import { createHash } from 'node:crypto'
import {
  attachOpenApiProjectionExtensions,
  type OpenApiProjectionDocumentWithExtensions,
  type OpenApiProjectionResult,
  type SchemaDiagnostic,
  type SchemaRefEdge,
  type SchemaSourceCoordinate,
  type SchemaTypeTarget,
} from '@oa-sdk/openapi-projection-contract'
import type { OasDocument } from './oas32-types.js'
import type { CanonicalDefinitionId } from './definition-id.js'
import type {
  DefinitionOutputAliasMetadata,
  DefinitionOutputNameCollisionReportEntry,
} from './definition-output-names.js'
import type {
  DefinitionRegistry,
  DefinitionRegistryDiagnostic,
  DefinitionRegistryNode,
  DefinitionRegistryRefEdge,
} from './definition-registry.js'
import type {
  DefinitionTargetDiagnostic,
  DefinitionTargetSelectionResult,
} from './definition-target.js'
import type {
  DefinitionOpenApiEmitDiagnostic,
  DefinitionOpenApiEmitReport,
  DefinitionOpenApiEmitResult,
} from './definition-openapi-emit.js'

export const DEFINITION_PROJECTION_OUTPUT_NAMES_EXTENSION = 'x-oa-sdk-definition-output-names'
export const DEFINITION_PROJECTION_COLLISION_REPORT_EXTENSION = 'x-oa-sdk-definition-collision-report'

export type DefinitionOpenApiProjectionMetadataExtensions = {
  [DEFINITION_PROJECTION_OUTPUT_NAMES_EXTENSION]: DefinitionOutputAliasMetadata[]
  [DEFINITION_PROJECTION_COLLISION_REPORT_EXTENSION]: DefinitionOutputNameCollisionReportEntry[]
}

export type DefinitionOpenApiProjectionDocument =
  OpenApiProjectionDocumentWithExtensions<OasDocument & DefinitionOpenApiProjectionMetadataExtensions>

export type DefinitionOpenApiProjectionAdapterInput = {
  registry: DefinitionRegistry
  selection: DefinitionTargetSelectionResult
  emitted: DefinitionOpenApiEmitResult
}

export type DefinitionOpenApiProjectionAdapterOptions = {
  versionHash?: string
  lookupSourceLocation?: (
    sourcePath: string,
    sourcePointer: string,
  ) => SourceLocationLike | undefined
}

export type DefinitionOpenApiProjectionResult =
  OpenApiProjectionResult<DefinitionOpenApiProjectionDocument>

type DefinitionDiagnostic =
  | DefinitionRegistryDiagnostic
  | DefinitionTargetDiagnostic
  | DefinitionOpenApiEmitDiagnostic

type SourceLocationLike = { line: number; column: number }

export function toDefinitionOpenApiProjectionResult(
  input: DefinitionOpenApiProjectionAdapterInput,
  options: DefinitionOpenApiProjectionAdapterOptions = {},
): DefinitionOpenApiProjectionResult {
  const refs = input.registry.refEdges.map(edge => toSchemaRefEdge(edge, options))
  const sources = toSourceMap(input.registry.nodes, options)
  const diagnostics = collectProjectionDiagnostics(input)
    .map(diagnostic => toSchemaDiagnostic(diagnostic, options))
  const versionHash = options.versionHash ?? computeDefinitionOpenApiProjectionVersionHash(input)
  const typeTargets = toSchemaTypeTargets(input.selection, options)

  const projectionWithoutSchemaExtensions = attachDefinitionProjectionMetadata(
    input.emitted.document,
    input.emitted.report,
  )
  const baseResult: OpenApiProjectionResult<OasDocument & DefinitionOpenApiProjectionMetadataExtensions> = {
    profile: 'full-api-document',
    projection: projectionWithoutSchemaExtensions,
    refs,
    diagnostics,
    sources,
    versionHash,
    typeTargets,
  }

  return {
    ...baseResult,
    projection: attachOpenApiProjectionExtensions(baseResult) as DefinitionOpenApiProjectionDocument,
  }
}

export function computeDefinitionOpenApiProjectionVersionHash(
  input: DefinitionOpenApiProjectionAdapterInput,
): string {
  const hashInput = {
    registryNodes: input.registry.nodes.map(node => ({
      id: node.id,
      contentHash: node.contentHash,
    })).sort((left, right) => left.id.localeCompare(right.id)),
    target: input.selection.target,
    outputNames: [...input.selection.outputNameAllocation.outputNames.entries()]
      .sort(([left], [right]) => left.localeCompare(right)),
    document: input.emitted.document,
  }

  return `sha256:${createHash('sha256').update(stableStringify(hashInput)).digest('hex')}`
}

function attachDefinitionProjectionMetadata(
  document: OasDocument,
  report: DefinitionOpenApiEmitReport,
): OasDocument & DefinitionOpenApiProjectionMetadataExtensions {
  return {
    ...document,
    [DEFINITION_PROJECTION_OUTPUT_NAMES_EXTENSION]: report.aliases.map(alias => ({ ...alias })),
    [DEFINITION_PROJECTION_COLLISION_REPORT_EXTENSION]: report.collisionReport.map(entry => ({ ...entry })),
  }
}

function toSchemaRefEdge(
  edge: DefinitionRegistryRefEdge,
  options: DefinitionOpenApiProjectionAdapterOptions,
): SchemaRefEdge {
  return {
    from: edge.sourceId,
    ...(edge.targetId !== undefined ? { to: edge.targetId } : {}),
    ref: edge.ref,
    kind: 'definition-ref',
    source: toFileSourceCoordinate(edge.sourcePath, edge.sourcePointer, undefined, options),
  }
}

function toSourceMap(
  nodes: readonly DefinitionRegistryNode[],
  options: DefinitionOpenApiProjectionAdapterOptions,
): Record<string, SchemaSourceCoordinate> {
  const sources: Record<string, SchemaSourceCoordinate> = {}

  for (const node of nodes) {
    sources[node.id] = toFileSourceCoordinate(node.sourcePath, node.sourcePointer, undefined, options)
  }

  return sources
}

function collectProjectionDiagnostics(input: DefinitionOpenApiProjectionAdapterInput): DefinitionDiagnostic[] {
  return dedupeDiagnostics([
    ...input.registry.diagnostics,
    ...input.selection.diagnostics,
    ...input.selection.outputNameAllocation.diagnostics,
    ...input.emitted.diagnostics,
  ])
}

function toSchemaDiagnostic(
  diagnostic: DefinitionDiagnostic,
  options: DefinitionOpenApiProjectionAdapterOptions,
): SchemaDiagnostic {
  const result: SchemaDiagnostic = {
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
  }
  const source = diagnosticSource(diagnostic, options)
  if (source !== undefined) result.source = source
  return result
}

function diagnosticSource(
  diagnostic: DefinitionDiagnostic,
  options: DefinitionOpenApiProjectionAdapterOptions,
): SchemaSourceCoordinate | undefined {
  if (!('sourcePath' in diagnostic) || diagnostic.sourcePath === undefined) return undefined

  return toFileSourceCoordinate(
    diagnostic.sourcePath,
    'sourcePointer' in diagnostic && diagnostic.sourcePointer !== undefined
      ? diagnostic.sourcePointer
      : '#',
    inlineDiagnosticLocation(diagnostic),
    options,
  )
}

function inlineDiagnosticLocation(
  diagnostic: DefinitionDiagnostic,
): { line?: number; column?: number } | undefined {
  const line = 'line' in diagnostic ? diagnostic.line : undefined
  const column = 'column' in diagnostic ? diagnostic.column : undefined

  if (line === undefined && column === undefined) return undefined
  return {
    ...(line !== undefined ? { line } : {}),
    ...(column !== undefined ? { column } : {}),
  }
}

function toFileSourceCoordinate(
  sourcePath: string,
  sourcePointer: string,
  inlineLocation: { line?: number; column?: number } | undefined,
  options: DefinitionOpenApiProjectionAdapterOptions,
): SchemaSourceCoordinate {
  const location = inlineLocation?.line !== undefined || inlineLocation?.column !== undefined
    ? inlineLocation
    : options.lookupSourceLocation?.(sourcePath, sourcePointer)

  return {
    kind: 'file',
    filePath: sourcePath,
    pointer: sourcePointer,
    ...(location?.line !== undefined ? { line: location.line } : {}),
    ...(location?.column !== undefined ? { column: location.column } : {}),
  }
}

function toSchemaTypeTargets(
  selection: DefinitionTargetSelectionResult,
  options: DefinitionOpenApiProjectionAdapterOptions,
): SchemaTypeTarget[] {
  return selection.outputNameAllocation.aliases.map(alias => {
    const target: SchemaTypeTarget = {
      id: alias.id,
      name: alias.outputName,
      kind: alias.kind,
    }
    const node = selection.nodeById.get(alias.id as CanonicalDefinitionId)
    if (node) {
      target.source = toFileSourceCoordinate(node.sourcePath, node.sourcePointer, undefined, options)
    }
    return target
  })
}

function dedupeDiagnostics<T extends DefinitionDiagnostic>(diagnostics: readonly T[]): T[] {
  const seen = new Set<string>()
  const result: T[] = []

  for (const diagnostic of diagnostics) {
    const key = stableStringify(diagnostic)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(diagnostic)
  }

  return result
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)

  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(',')}]`
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))

  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
    .join(',')}}`
}
