/**
 * `oa-sdk.ref-projection.v1` — the ref-preserving graph of an OpenAPI document
 * (`projectRefGraph` in `@oa-sdk/parser`) as a versioned exchange artifact.
 *
 * The artifact is a pure function of its inputs: nodes, edges and diagnostics
 * are sorted by code unit, it carries no timestamps, and every file path is
 * written relative to the entry document's directory, so the same files give
 * byte-identical output on any machine. Each node also carries the definition
 * identity behind it: the build-spec provenance `canonicalId` of its nearest
 * enclosing output pointer, or the reason it has none.
 *
 * The JSON Schema of the artifact is `REF_PROJECTION_ARTIFACT_SCHEMA_V1`.
 */

import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  findNearestJsonPointerEntry,
  projectRefGraph,
  type OasDocument,
  type RefGraphDiagnostic,
  type RefGraphDiagnosticCode,
  type RefProjectionNode,
  type RefProjectionNodeKind,
} from '@oa-sdk/parser'
import type { BuildSpecProvenanceEntry, BuildSpecProvenanceMap } from './provenance-report.js'

export const REF_PROJECTION_SCHEMA_VERSION = 'oa-sdk.ref-projection.v1' as const

/** Node kinds of the v1 artifact: every `RefProjectionNodeKind` of the parser. */
export const REF_PROJECTION_NODE_KINDS = [
  'schema',
  'response',
  'parameter',
  'example',
  'requestBody',
  'header',
  'securityScheme',
  'link',
  'callback',
  'pathItem',
  'mediaType',
  'path',
  'webhook',
  'external',
] as const satisfies readonly RefProjectionNodeKind[]

/**
 * Diagnostic codes of the v1 artifact: every `RefGraphDiagnosticCode` of the
 * parser.
 */
export const REF_PROJECTION_DIAGNOSTIC_CODES = [
  'ref-cycle',
  'ref-not-found',
  'external-ref-read-failed',
  'external-ref-pointer-not-found',
  'unsupported-ref',
] as const satisfies readonly RefGraphDiagnosticCode[]

// A parser value the lists above leave out fails to compile here, so the schema
// enums cannot fall behind the projection silently.
type AssertAllListed<Unlisted extends never> = Unlisted
type NodeKindsAreListed = AssertAllListed<
  Exclude<RefProjectionNodeKind, typeof REF_PROJECTION_NODE_KINDS[number]>
>
type DiagnosticCodesAreListed = AssertAllListed<
  Exclude<RefGraphDiagnosticCode, typeof REF_PROJECTION_DIAGNOSTIC_CODES[number]>
>

/**
 * How an edge relates to recursion: `guarded` lies on a cycle that descends
 * into the instance (valid recursion), `unguarded` on a cycle that never does
 * (also reported as a `ref-cycle` diagnostic), `none` on no cycle.
 */
export const REF_PROJECTION_RECURSIONS = ['none', 'guarded', 'unguarded'] as const

/**
 * Why a node has no `canonicalId`:
 * - `external-document`: the node lives in another file, outside the output
 *   document that provenance maps.
 * - `provenance-not-supplied`: no provenance map was given.
 * - `no-enclosing-provenance-entry`: neither the node's pointer nor any of its
 *   ancestors has a provenance entry.
 */
export const REF_PROJECTION_UNMAPPED_REASONS = [
  'external-document',
  'provenance-not-supplied',
  'no-enclosing-provenance-entry',
] as const

export type RefProjectionArtifactRecursion = typeof REF_PROJECTION_RECURSIONS[number]

export type RefProjectionUnmappedReason = typeof REF_PROJECTION_UNMAPPED_REASONS[number]

/** A file the artifact was derived from. */
export type RefProjectionArtifactSourceFile = {
  /** Path as the producer names it; the CLI writes it relative to the project root. */
  path: string
  /** `sha256:` followed by the hex digest of the file's bytes. */
  contentHash: string
}

export type RefProjectionArtifactGenerator = {
  name: string
  version: string
}

export type RefProjectionNodeIdentity =
  | {
    status: 'mapped'
    canonicalId: string
    /** The provenance key that matched: the node's pointer or its nearest ancestor. */
    provenancePointer: string
    sourcePath: string
    sourcePointer: string
    contentHash: string
  }
  | {
    status: 'unmapped'
    reason: RefProjectionUnmappedReason
  }

export type RefProjectionArtifactNode = {
  /** `pointer` for a node of the entry document, `filePath` + `pointer` otherwise. */
  id: string
  kind: RefProjectionNodeKind
  name: string
  /** Canonical, unencoded JSON Pointer URI fragment of the declaration in its file. */
  pointer: string
  /** File of a node outside the entry document, relative to the entry document's directory. */
  filePath?: string
  identity: RefProjectionNodeIdentity
}

export type RefProjectionArtifactEdge = {
  /** Location of the `$ref` occurrence: `sourcePointer`, prefixed by `sourceFilePath` outside the entry document. */
  id: string
  /** Id of the node that contains the occurrence. */
  source: string
  /** Id of the node that contains the reference target. */
  target: string
  /** The `$ref` value as written. */
  ref: string
  /** Pointer of the occurrence (`.../$ref`) in its file. */
  sourcePointer: string
  /** File of an occurrence outside the entry document, relative to the entry document's directory. */
  sourceFilePath?: string
  recursion: RefProjectionArtifactRecursion
}

/** A ref graph diagnostic with file paths relative to the entry document's directory. */
export type RefProjectionArtifactDiagnostic = {
  code: RefGraphDiagnosticCode
  ref: string
  message: string
  sourcePointer?: string
  sourceFilePath?: string
  filePath?: string
  pointer?: string
  line?: number
  column?: number
}

export type RefProjectionArtifact = {
  schemaVersion: typeof REF_PROJECTION_SCHEMA_VERSION
  generator: RefProjectionArtifactGenerator
  source: {
    spec: RefProjectionArtifactSourceFile
    provenance?: RefProjectionArtifactSourceFile
  }
  nodes: RefProjectionArtifactNode[]
  edges: RefProjectionArtifactEdge[]
  diagnostics: RefProjectionArtifactDiagnostic[]
}

export type CreateRefProjectionArtifactOptions = {
  /** Parsed entry document. It is read, never modified. */
  document: OasDocument | Record<string, unknown>
  /**
   * Absolute path of the file `document` was read from. Relative external
   * `$ref`s resolve against it and file paths in the artifact are written
   * relative to its directory. Without it, external `$ref`s are reported as
   * `unsupported-ref`.
   */
  entryPath?: string
  spec: RefProjectionArtifactSourceFile
  /** Build-spec provenance of `document` (`oa-gen build-spec --provenance`). */
  provenance?: {
    map: BuildSpecProvenanceMap
    source: RefProjectionArtifactSourceFile
  }
  generator: RefProjectionArtifactGenerator
}

/** Project `document` into an `oa-sdk.ref-projection.v1` artifact. */
export function createRefProjectionArtifact(options: CreateRefProjectionArtifactOptions): RefProjectionArtifact {
  const { entryPath } = options
  const projection = projectRefGraph(options.document, entryPath === undefined ? {} : { basePath: entryPath })
  const files = new EntryRelativeFiles(entryPath)
  const provenance = options.provenance === undefined
    ? undefined
    : new Map(Object.entries(options.provenance.map))

  const nodeIds = new Map<string, string>()
  const nodes = projection.nodes.map((node): RefProjectionArtifactNode => {
    const filePath = files.reference(node.filePath)
    const id = filePath === undefined ? node.id : `${filePath}${node.pointer}`
    nodeIds.set(node.id, id)
    return {
      id,
      kind: node.kind,
      // The projection names a whole-file target after its file path.
      name: node.filePath !== undefined && node.name === node.filePath && filePath !== undefined ? filePath : node.name,
      pointer: node.pointer,
      ...(filePath !== undefined ? { filePath } : {}),
      identity: nodeIdentity(node, provenance),
    }
  })

  const nodeId = (projectionId: string): string => {
    const id = nodeIds.get(projectionId)
    if (id === undefined) throw new Error(`ref projection edge names an unknown node: ${projectionId}`)
    return id
  }
  const edges = projection.edges.map((edge): RefProjectionArtifactEdge => {
    const sourceFilePath = files.reference(edge.sourceFilePath)
    return {
      id: `${sourceFilePath ?? ''}${edge.sourcePointer}`,
      source: nodeId(edge.source),
      target: nodeId(edge.target),
      ref: edge.ref,
      sourcePointer: edge.sourcePointer,
      ...(sourceFilePath !== undefined ? { sourceFilePath } : {}),
      recursion: edge.recursion ?? 'none',
    }
  })

  const diagnostics = projection.diagnostics.map(diagnostic => toArtifactDiagnostic(diagnostic, files))

  return {
    schemaVersion: REF_PROJECTION_SCHEMA_VERSION,
    generator: { name: options.generator.name, version: options.generator.version },
    source: {
      spec: copySourceFile(options.spec),
      ...(options.provenance !== undefined ? { provenance: copySourceFile(options.provenance.source) } : {}),
    },
    nodes: nodes.sort((left, right) => compareCodeUnits(left.id, right.id)),
    edges: edges.sort((left, right) => compareCodeUnits(left.id, right.id)),
    diagnostics: diagnostics.sort(compareDiagnostics),
  }
}

/** The artifact as it is written to disk: two-space JSON with a trailing newline. */
export function serializeRefProjectionArtifact(artifact: RefProjectionArtifact): string {
  return `${JSON.stringify(artifact, null, 2)}\n`
}

export type RefProjectionArtifactSummary = {
  nodes: number
  edges: number
  diagnostics: number
  recursion: Record<RefProjectionArtifactRecursion, number>
  mappedNodes: number
  /** Unmapped node count per reason; reasons without nodes are left out. */
  unmappedNodes: Partial<Record<RefProjectionUnmappedReason, number>>
}

/** Counts a reader reports about an artifact. */
export function summarizeRefProjectionArtifact(artifact: RefProjectionArtifact): RefProjectionArtifactSummary {
  const recursion = Object.fromEntries(REF_PROJECTION_RECURSIONS.map(kind => [kind, 0])) as Record<RefProjectionArtifactRecursion, number>
  for (const edge of artifact.edges) recursion[edge.recursion] += 1

  let mappedNodes = 0
  const unmappedNodes: Partial<Record<RefProjectionUnmappedReason, number>> = {}
  for (const node of artifact.nodes) {
    if (node.identity.status === 'mapped') mappedNodes += 1
    else unmappedNodes[node.identity.reason] = (unmappedNodes[node.identity.reason] ?? 0) + 1
  }
  return {
    nodes: artifact.nodes.length,
    edges: artifact.edges.length,
    diagnostics: artifact.diagnostics.length,
    recursion,
    mappedNodes,
    unmappedNodes: Object.fromEntries(
      REF_PROJECTION_UNMAPPED_REASONS.flatMap(reason => unmappedNodes[reason] === undefined ? [] : [[reason, unmappedNodes[reason]]]),
    ),
  }
}

function nodeIdentity(
  node: RefProjectionNode,
  provenance: ReadonlyMap<string, BuildSpecProvenanceEntry> | undefined,
): RefProjectionNodeIdentity {
  if (node.filePath !== undefined) return { status: 'unmapped', reason: 'external-document' }
  if (provenance === undefined) return { status: 'unmapped', reason: 'provenance-not-supplied' }
  const match = findNearestJsonPointerEntry(node.pointer, provenance)
  if (match === undefined) return { status: 'unmapped', reason: 'no-enclosing-provenance-entry' }
  return {
    status: 'mapped',
    canonicalId: match.value.canonicalId,
    provenancePointer: match.pointer,
    sourcePath: match.value.sourcePath,
    sourcePointer: match.value.sourcePointer,
    contentHash: match.value.contentHash,
  }
}

function toArtifactDiagnostic(
  diagnostic: RefGraphDiagnostic,
  files: EntryRelativeFiles,
): RefProjectionArtifactDiagnostic {
  const sourceFilePath = files.reference(diagnostic.sourceFilePath)
  const filePath = files.reference(diagnostic.filePath)
  return {
    code: diagnostic.code,
    ref: diagnostic.ref,
    message: files.relativizeText(diagnostic.message, [diagnostic.filePath, diagnostic.sourceFilePath]),
    ...(diagnostic.sourcePointer !== undefined ? { sourcePointer: diagnostic.sourcePointer } : {}),
    ...(sourceFilePath !== undefined ? { sourceFilePath } : {}),
    ...(filePath !== undefined ? { filePath } : {}),
    ...(diagnostic.pointer !== undefined ? { pointer: diagnostic.pointer } : {}),
    ...(diagnostic.line !== undefined ? { line: diagnostic.line } : {}),
    ...(diagnostic.column !== undefined ? { column: diagnostic.column } : {}),
  }
}

/**
 * Writes the files the projection names as `$ref`-style references from the
 * entry document's directory (`./shared.yaml`, `../common/types.yaml`), and
 * leaves the entry document itself unnamed, as the projection does.
 */
class EntryRelativeFiles {
  private readonly entryFile: string | undefined

  constructor(entryPath: string | undefined) {
    this.entryFile = entryPath === undefined ? undefined : resolve(entryPath)
  }

  reference(filePath: string | undefined): string | undefined {
    if (filePath === undefined) return undefined
    if (this.entryFile === undefined) return filePath
    const file = resolve(filePath)
    if (file === this.entryFile) return undefined
    return fileReference(dirname(this.entryFile), file)
  }

  /** Replace each absolute path of `paths` in a resolver message with its reference. */
  relativizeText(text: string, paths: ReadonlyArray<string | undefined>): string {
    if (this.entryFile === undefined) return text
    let result = text
    for (const path of paths) {
      if (path === undefined || !isAbsolute(path)) continue
      result = result.split(path).join(fileReference(dirname(this.entryFile), resolve(path)))
    }
    return result
  }
}

/** `$ref` file part naming `filePath` from `fromDirectory`, as the parser resolver writes it. */
function fileReference(fromDirectory: string, filePath: string): string {
  const path = relative(fromDirectory, filePath)
  // No relative path exists between filesystem roots (e.g. another Windows drive).
  if (isAbsolute(path)) return pathToFileURL(filePath).href
  const reference = path.split(sep).join('/')
  return reference.startsWith('../') ? reference : `./${reference}`
}

function copySourceFile(file: RefProjectionArtifactSourceFile): RefProjectionArtifactSourceFile {
  return { path: file.path, contentHash: file.contentHash }
}

function compareDiagnostics(left: RefProjectionArtifactDiagnostic, right: RefProjectionArtifactDiagnostic): number {
  return compareKeys(diagnosticKey(left), diagnosticKey(right))
}

function diagnosticKey(diagnostic: RefProjectionArtifactDiagnostic): string[] {
  return [
    diagnostic.sourceFilePath ?? '',
    diagnostic.sourcePointer ?? '',
    diagnostic.code,
    diagnostic.ref,
    diagnostic.filePath ?? '',
    diagnostic.pointer ?? '',
    diagnostic.message,
  ]
}

function compareKeys(left: readonly string[], right: readonly string[]): number {
  for (let index = 0; index < left.length; index += 1) {
    const order = compareCodeUnits(left[index]!, right[index]!)
    if (order !== 0) return order
  }
  return 0
}

/** Locale-independent string order, so the artifact sorts the same everywhere. */
function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
