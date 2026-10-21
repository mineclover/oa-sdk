/**
 * Named validators for the documents `oa-gen trace` and the traceability API read from disk:
 * the OpenAPI spec, the `.oa-manifest.json` manifest, the build-spec provenance map, and the
 * `.oa-trace.json` sidecar. Each `parse` returns the validated value or throws a TypeError that
 * names the offending member, so malformed input never reaches the graph builder as a domain
 * type. This module stays free of TypeSpec and parser dependencies so the CLI can load it at
 * startup.
 */

import type { OasDocument } from '@oa-sdk/parser'
import type { ManifestArtifact } from '../routing/manifest-manager.js'
import { ARTIFACT_KINDS } from '../config.js'
import {
  parseBuildSpecProvenanceMap,
  type BuildSpecProvenanceMap,
} from '../cli/lib/provenance-report.js'
import type {
  SpecDefinitionKind,
  SpecTraceabilityDiagnostic,
  SpecTraceabilityDiagnosticCode,
  SpecTraceabilityEdge,
  SpecTraceabilityEdgeKind,
  SpecTraceabilityGraph,
  SpecTraceabilityNode,
  SpecTraceArtifactKind,
  SpecTraceGeneratedArtifactMapping,
  SpecTraceGovernanceCapabilities,
  SpecTraceSourceCoordinates,
  SpecTraceSourceOrigin,
  SpecTraceabilitySummary,
} from './spec-traceability.js'

/** A named runtime validator: `parse` returns the validated value or throws a TypeError. */
export interface TraceInputSchema<T> {
  parse(value: unknown): T
}

/** The part of `.oa-manifest.json` the traceability graph reads: each artifact's path and kind. */
export type SpecTraceManifest = {
  artifacts: ReadonlyArray<Pick<ManifestArtifact, 'path' | 'kind'>>
}

/**
 * An OpenAPI document as the traceability graph reads it: `openapi` and `info` as the
 * specification requires, and `paths`, `webhooks` and `components` as objects when present.
 * Their members are checked where the graph reads them.
 */
export const TraceOpenApiDocumentSchema: TraceInputSchema<OasDocument> = {
  parse(value: unknown): OasDocument {
    if (!isRecord(value)) throw new TypeError('OpenAPI document must be an object')
    if (typeof value.openapi !== 'string') throw new TypeError('OpenAPI document: openapi must be a version string')
    if (!isOpenApiInfo(value.info)) throw new TypeError('OpenAPI document: info must be an object with string title and version')
    for (const member of ['paths', 'webhooks', 'components'] as const) {
      if (value[member] !== undefined && !isRecord(value[member])) {
        throw new TypeError(`OpenAPI document: ${member} must be an object`)
      }
    }
    if (!isOpenApiDocument(value)) throw new TypeError('OpenAPI document has an unexpected shape')
    return value
  },
}

/**
 * `.oa-manifest.json` artifacts with a string `path` and a known artifact `kind`. Records of
 * kinds this codegen does not know (written by a newer generator) are skipped, not rejected.
 */
export const SpecTraceManifestSchema: TraceInputSchema<SpecTraceManifest> = {
  parse(value: unknown): SpecTraceManifest {
    if (!isRecord(value)) throw new TypeError('Manifest must be an object')
    if (!Array.isArray(value.artifacts)) throw new TypeError('Manifest: artifacts must be an array')
    const artifacts: Array<Pick<ManifestArtifact, 'path' | 'kind'>> = []
    value.artifacts.forEach((artifact: unknown, index) => {
      if (!isRecord(artifact)) throw new TypeError(`Manifest: artifacts[${index}] must be an object`)
      if (typeof artifact.path !== 'string' || artifact.path.length === 0) {
        throw new TypeError(`Manifest: artifacts[${index}].path must be a non-empty string`)
      }
      if (typeof artifact.kind !== 'string') throw new TypeError(`Manifest: artifacts[${index}].kind must be a string`)
      const kind = ARTIFACT_KINDS.find(known => known === artifact.kind)
      if (kind) artifacts.push({ path: artifact.path, kind })
    })
    return { artifacts }
  },
}

/** The build-spec `--provenance` map, validated by `parseBuildSpecProvenanceMap`. */
export function buildSpecProvenanceMapSchema(label: string): TraceInputSchema<BuildSpecProvenanceMap> {
  return { parse: (value: unknown) => parseBuildSpecProvenanceMap(value, label) }
}

const SPEC_DEFINITION_KINDS: Record<SpecDefinitionKind, true> = {
  schema: true,
  operation: true,
  webhook: true,
  parameter: true,
  response: true,
  requestBody: true,
  header: true,
  link: true,
  callback: true,
  securityScheme: true,
}
const SOURCE_ORIGINS: Record<SpecTraceSourceOrigin, true> = {
  'typespec-ast': true,
  'definition-fragment': true,
  'openapi-inline': true,
}
const EDGE_KINDS: Record<SpecTraceabilityEdgeKind, true> = {
  references: true,
  replaces: true,
  'emits-artifact': true,
}
const DIAGNOSTIC_CODES: Record<SpecTraceabilityDiagnosticCode, true> = {
  'traceability/duplicate-tracking-id': true,
  'traceability/unresolved-ref': true,
  'traceability/unmapped-source': true,
}
const SEVERITIES: Record<SpecTraceabilityDiagnostic['severity'], true> = { error: true, warning: true }
const TRACKING_ID_SOURCES: Record<SpecTraceabilityNode['trackingIdSource'], true> = { explicit: true, generated: true }
const ARTIFACT_MAPPING_KINDS: Record<SpecTraceArtifactKind, true> = {
  types: true,
  contract: true,
  router: true,
  client: true,
  queries: true,
  keys: true,
  guards: true,
  schemas: true,
  'crdt-contract': true,
  'crdt-router': true,
  'crdt-client': true,
  'crdt-hooks': true,
}

/**
 * A `.oa-trace.json` sidecar. Every member the traceability API reads is checked; unknown
 * members are dropped. Sidecars written before `governance.personas` existed get it from their
 * `governance.persona`.
 */
export function createSpecTraceabilityGraphSchema(
  schemaVersion: SpecTraceabilityGraph['schemaVersion'],
): TraceInputSchema<SpecTraceabilityGraph> {
  return {
    parse(value: unknown): SpecTraceabilityGraph {
      const graph = new Fields(value, 'trace sidecar')
      const version = graph.string('schemaVersion')
      if (version !== schemaVersion) {
        throw new TypeError(`Unsupported trace sidecar schemaVersion ${JSON.stringify(version)} (expected ${schemaVersion})`)
      }
      const summary = graph.record('summary')
      const nodes: Record<string, SpecTraceabilityNode> = {}
      for (const [pointer, node] of graph.record('nodes').entries()) {
        nodes[pointer] = parseNode(new Fields(node, `trace sidecar nodes[${JSON.stringify(pointer)}]`))
      }
      return {
        schemaVersion,
        specSha256: graph.string('specSha256'),
        summary: parseSummary(summary),
        nodes,
        edges: graph.array('edges').map((edge, index) => parseEdge(new Fields(edge, `trace sidecar edges[${index}]`))),
        diagnostics: graph
          .array('diagnostics')
          .map((diagnostic, index) => parseDiagnostic(new Fields(diagnostic, `trace sidecar diagnostics[${index}]`))),
      }
    },
  }
}

function parseSummary(summary: Fields): SpecTraceabilitySummary {
  return {
    nodeCount: summary.number('nodeCount'),
    schemaCount: summary.number('schemaCount'),
    operationCount: summary.number('operationCount'),
    componentCount: summary.number('componentCount'),
    explicitTrackingIdCount: summary.number('explicitTrackingIdCount'),
    generatedTrackingIdCount: summary.number('generatedTrackingIdCount'),
    mappedSourceCount: summary.number('mappedSourceCount'),
    referenceEdgeCount: summary.number('referenceEdgeCount'),
    generatedSymbolCount: summary.number('generatedSymbolCount'),
    diagnosticCount: summary.number('diagnosticCount'),
  }
}

function parseNode(node: Fields): SpecTraceabilityNode {
  const method = node.optionalString('method')
  const openApiPath = node.optionalString('openApiPath')
  return {
    pointer: node.string('pointer'),
    canonicalId: node.string('canonicalId'),
    kind: node.oneOf('kind', SPEC_DEFINITION_KINDS),
    symbol: node.string('symbol'),
    trackingId: node.string('trackingId'),
    trackingIdSource: node.oneOf('trackingIdSource', TRACKING_ID_SOURCES),
    stableKey: node.string('stableKey'),
    contentHash: node.string('contentHash'),
    replaces: node.stringArray('replaces'),
    source: parseSource(node.record('source')),
    governance: parseGovernance(node.record('governance')),
    references: node.stringArray('references'),
    referencedBy: node.stringArray('referencedBy'),
    generatedArtifacts: node
      .array('generatedArtifacts')
      .map((artifact, index) => parseArtifact(new Fields(artifact, `${node.at}.generatedArtifacts[${index}]`))),
    ...(method !== undefined ? { method } : {}),
    ...(openApiPath !== undefined ? { openApiPath } : {}),
  }
}

function parseSource(source: Fields): SpecTraceSourceCoordinates {
  const parsed: SpecTraceSourceCoordinates = { origin: source.oneOf('origin', SOURCE_ORIGINS) }
  for (const key of ['filePath', 'sourcePointer', 'symbol'] as const) {
    const value = source.optionalString(key)
    if (value !== undefined) parsed[key] = value
  }
  for (const key of ['line', 'column', 'endLine', 'endColumn'] as const) {
    const value = source.optionalNumber(key)
    if (value !== undefined) parsed[key] = value
  }
  return parsed
}

function parseGovernance(governance: Fields): SpecTraceGovernanceCapabilities {
  const persona = governance.optionalString('persona')
  const personas = governance.has('personas')
    ? governance.stringArray('personas')
    : persona !== undefined
      ? [persona]
      : []
  const parsed: SpecTraceGovernanceCapabilities = {
    personas,
    personaTraits: governance.stringArray('personaTraits'),
    requirements: governance.stringArray('requirements'),
  }
  if (persona !== undefined) parsed.persona = persona
  for (const key of ['dpmProjection', 'storageRef', 'behaviorRef'] as const) {
    const value = governance.optionalString(key)
    if (value !== undefined) parsed[key] = value
  }
  return parsed
}

function parseArtifact(artifact: Fields): SpecTraceGeneratedArtifactMapping {
  const filePath = artifact.optionalString('filePath')
  return {
    kind: artifact.oneOf('kind', ARTIFACT_MAPPING_KINDS),
    ...(filePath !== undefined ? { filePath } : {}),
    exportedSymbols: artifact.stringArray('exportedSymbols'),
  }
}

function parseEdge(edge: Fields): SpecTraceabilityEdge {
  const detail = edge.optionalString('detail')
  return {
    kind: edge.oneOf('kind', EDGE_KINDS),
    from: edge.string('from'),
    to: edge.string('to'),
    ...(detail !== undefined ? { detail } : {}),
  }
}

function parseDiagnostic(diagnostic: Fields): SpecTraceabilityDiagnostic {
  const trackingId = diagnostic.optionalString('trackingId')
  return {
    code: diagnostic.oneOf('code', DIAGNOSTIC_CODES),
    severity: diagnostic.oneOf('severity', SEVERITIES),
    pointer: diagnostic.string('pointer'),
    message: diagnostic.string('message'),
    ...(trackingId !== undefined ? { trackingId } : {}),
    ...(diagnostic.has('relatedPointers') ? { relatedPointers: diagnostic.stringArray('relatedPointers') } : {}),
  }
}

/** Typed member access on one JSON object, with the object's location in every error. */
class Fields {
  private readonly value: Record<string, unknown>

  constructor(value: unknown, readonly at: string) {
    if (!isRecord(value)) throw new TypeError(`${at} must be an object`)
    this.value = value
  }

  has(key: string): boolean {
    return this.value[key] !== undefined
  }

  entries(): Array<[string, unknown]> {
    return Object.entries(this.value)
  }

  string(key: string): string {
    const value = this.value[key]
    if (typeof value !== 'string') throw new TypeError(`${this.at}.${key} must be a string`)
    return value
  }

  optionalString(key: string): string | undefined {
    return this.has(key) ? this.string(key) : undefined
  }

  number(key: string): number {
    const value = this.value[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${this.at}.${key} must be a number`)
    return value
  }

  optionalNumber(key: string): number | undefined {
    return this.has(key) ? this.number(key) : undefined
  }

  stringArray(key: string): string[] {
    const value = this.value[key]
    if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) {
      throw new TypeError(`${this.at}.${key} must be an array of strings`)
    }
    return [...value]
  }

  array(key: string): unknown[] {
    const value = this.value[key]
    if (!Array.isArray(value)) throw new TypeError(`${this.at}.${key} must be an array`)
    return value
  }

  record(key: string): Fields {
    return new Fields(this.value[key], `${this.at}.${key}`)
  }

  oneOf<T extends string>(key: string, allowed: Readonly<Record<T, true>>): T {
    const value = this.string(key)
    if (!isAllowed(value, allowed)) {
      throw new TypeError(`${this.at}.${key} must be one of ${Object.keys(allowed).join(', ')}`)
    }
    return value
  }
}

function isAllowed<T extends string>(value: string, allowed: Readonly<Record<T, true>>): value is T {
  return Object.prototype.hasOwnProperty.call(allowed, value)
}

function isOpenApiInfo(value: unknown): boolean {
  return isRecord(value) && typeof value.title === 'string' && typeof value.version === 'string'
}

/** Narrowing for the members checked by `TraceOpenApiDocumentSchema`. */
function isOpenApiDocument(value: Record<string, unknown>): value is OasDocument {
  return typeof value.openapi === 'string' && isOpenApiInfo(value.info)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
