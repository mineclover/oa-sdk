/**
 * TypeSpec origin of generated TypeScript declarations, as a graph semantic
 * index sidecar (`oa-sdk.typespec-ts-graph-semantic.v1`).
 *
 * Input: the OpenAPI document typegen read (restored from TypeSpec), the
 * generated source with the declarations typegen reported for it, and the
 * `oa-sdk.typespec-ref-provenance.v1` artifact of the same TypeSpec check.
 * Output: one host per generated declaration whose OpenAPI origin a TypeSpec
 * declaration owns, with that declaration's `.tsp` file and line as evidence.
 * The generated source itself stays free of origin comments; the sidecar is
 * hash-bound to the generated source, the OpenAPI document and the provenance.
 */
import { createHash } from 'node:crypto'
import { formatJsonPointer, parseJsonPointer, type OasDocument } from '@oa-sdk/parser'
import { stableJsonSha256, typeSpecRestoredOpenApiSha256 } from '../typespec-restored-openapi-digest.js'
import type { GeneratedTypeDeclaration } from './generate-types.js'

export const TYPESPEC_TS_GRAPH_SEMANTIC_SCHEMA = 'oa-sdk.typespec-ts-graph-semantic.v1' as const

const TYPESPEC_GRAPH_SEMANTIC_TAG = 'oa-sdk-typespec' as const

/**
 * The fields of `oa-sdk.typespec-ref-provenance.v1` the semantic index reads;
 * an artifact may carry more. Validate untrusted input with
 * `typeSpecGraphProvenanceSchema` (package root) first.
 */
export type TypeSpecGraphProvenance = {
  schemaVersion: 'oa-sdk.typespec-ref-provenance.v1'
  inputs: { restoredOpenApiSha256: string }
  declarations: ReadonlyArray<{
    id: string
    source: { file: string; start: { line: number; column: number } }
  }>
  edges: ReadonlyArray<{
    kind: 'emits' | 'restores' | 'references'
    declarationId: string
    outputPointer: string
  }>
}

export type TypeSpecGeneratedGraphHost = {
  host: { publicName: string; symbol: 'type'; declaration: { file: string; line: number } }
  semanticTags: [typeof TYPESPEC_GRAPH_SEMANTIC_TAG]
  evidence: Array<{ tag: 'evidence'; target: string; source: { file: string; line: number } }>
}

export type TypeSpecGeneratedGraphSemanticIndex = {
  version: 1
  originSchemaVersion: typeof TYPESPEC_TS_GRAPH_SEMANTIC_SCHEMA
  inputs: { generatedTypesSha256: string; restoredOpenApiSha256: string; typeSpecProvenanceSha256: string }
  hosts: TypeSpecGeneratedGraphHost[]
}

export type TypeSpecGeneratedGraphSemanticIndexInput = {
  /** The OpenAPI document typegen generated from (the TypeSpec-restored document). */
  document: OasDocument
  /** The generated source exactly as written. */
  generatedTypeScript: string
  /** What typegen reported for that source (`TypegenOptions.declarations`). */
  declarations: readonly GeneratedTypeDeclaration[]
  /** Project-relative path of the generated source as the graph sees it. */
  generatedFile: string
  typeSpecProvenance: TypeSpecGraphProvenance
}

type ProvenanceOwner = {
  id: string
  pointer: string
  kind: 'emits' | 'restores'
  source: { file: string; line: number }
}

/**
 * Bind each generated declaration to the TypeSpec declaration that owns its
 * OpenAPI origin: the owner of the origin pointer itself or, for a nested
 * schema with its own alias, of its nearest enclosing pointer. An `emits` edge
 * outranks a `restores` edge of the same pointer.
 *
 * Fails when the provenance describes another document, when it names one
 * pointer's owner ambiguously, and when a declaration generated from the
 * document has no owner. Declarations of schemas inlined from other documents
 * have no TypeSpec origin and get no host.
 */
export function buildTypeSpecGeneratedGraphSemanticIndex(
  input: TypeSpecGeneratedGraphSemanticIndexInput,
): TypeSpecGeneratedGraphSemanticIndex {
  const provenance = input.typeSpecProvenance
  if (provenance.schemaVersion !== 'oa-sdk.typespec-ref-provenance.v1') {
    throw new Error('TypeSpec generated graph index requires oa-sdk.typespec-ref-provenance.v1.')
  }
  const restoredOpenApiSha256 = typeSpecRestoredOpenApiSha256(input.document)
  if (provenance.inputs.restoredOpenApiSha256 !== restoredOpenApiSha256) {
    throw new Error('TypeSpec provenance restoredOpenApiSha256 does not match the typegen input document.')
  }
  const generatedFile = projectRelativeFile(input.generatedFile)
  const owners = collectOwners(provenance)
  const sourceLines = input.generatedTypeScript.split('\n')

  const hosts: TypeSpecGeneratedGraphHost[] = []
  for (const declaration of input.declarations) {
    assertDeclarationLine(declaration, sourceLines)
    if (declaration.origin.kind !== 'pointer') continue
    const owner = findOwner(declaration.origin.pointer, owners)
    if (!owner) {
      throw new Error(`Generated declaration ${declaration.name} has no TypeSpec provenance owner for ${declaration.origin.pointer}.`)
    }
    hosts.push({
      host: { publicName: declaration.name, symbol: 'type', declaration: { file: generatedFile, line: declaration.line } },
      semanticTags: [TYPESPEC_GRAPH_SEMANTIC_TAG],
      evidence: [{
        tag: 'evidence',
        target: `${TYPESPEC_GRAPH_SEMANTIC_TAG}:${owner.id}:${owner.pointer}`,
        source: owner.source,
      }],
    })
  }

  return {
    version: 1,
    originSchemaVersion: TYPESPEC_TS_GRAPH_SEMANTIC_SCHEMA,
    inputs: {
      // The bytes of the generated file, which a graph reader hashes to detect a stale sidecar.
      generatedTypesSha256: createHash('sha256').update(input.generatedTypeScript).digest('hex'),
      restoredOpenApiSha256,
      typeSpecProvenanceSha256: stableJsonSha256(provenance),
    },
    hosts,
  }
}

function collectOwners(provenance: TypeSpecGraphProvenance): Map<string, ProvenanceOwner> {
  const declarations = new Map(provenance.declarations.map(declaration => [declaration.id, declaration]))
  const owners = new Map<string, ProvenanceOwner>()
  for (const edge of provenance.edges) {
    if (edge.kind !== 'emits' && edge.kind !== 'restores') continue
    const declaration = declarations.get(edge.declarationId)
    if (!declaration) {
      throw new Error(`TypeSpec provenance edge for ${edge.outputPointer} names unknown declaration ${edge.declarationId}.`)
    }
    const pointer = canonicalPointer(edge.outputPointer)
    const owner: ProvenanceOwner = {
      id: declaration.id,
      pointer,
      kind: edge.kind,
      source: { file: declaration.source.file, line: declaration.source.start.line },
    }
    const existing = owners.get(pointer)
    if (!existing || (existing.kind === 'restores' && owner.kind === 'emits')) {
      owners.set(pointer, owner)
    } else if (existing.kind === owner.kind && existing.id !== owner.id) {
      throw new Error(`Ambiguous TypeSpec owner for ${edge.outputPointer}.`)
    }
  }
  return owners
}

/** The owner of `pointer` or of its nearest ancestor. */
function findOwner(pointer: string, owners: ReadonlyMap<string, ProvenanceOwner>): ProvenanceOwner | undefined {
  const tokens = pointer.startsWith('#') ? parseJsonPointer(pointer.slice(1)) : undefined
  if (!tokens) return owners.get(pointer)
  for (let length = tokens.length; length >= 0; length -= 1) {
    const owner = owners.get(`#${formatJsonPointer(tokens.slice(0, length))}`)
    if (owner) return owner
  }
  return undefined
}

/** One spelling per pointer: RFC 6901 escaping of the parsed tokens. */
function canonicalPointer(pointer: string): string {
  const tokens = pointer.startsWith('#') ? parseJsonPointer(pointer.slice(1)) : undefined
  return tokens ? `#${formatJsonPointer(tokens)}` : pointer
}

/** The reported line must be where the declaration starts; anything else is a typegen defect. */
function assertDeclarationLine(declaration: GeneratedTypeDeclaration, sourceLines: readonly string[]): void {
  const text = sourceLines[declaration.line - 1]
  const declares = text !== undefined
    && (text.startsWith(`export type ${declaration.name} `) || text.startsWith(`export interface ${declaration.name} `))
  if (!declares) {
    throw new Error(`typegen reported ${declaration.name} at line ${declaration.line}, which does not declare it.`)
  }
}

function projectRelativeFile(file: string): string {
  const normalized = file.replaceAll('\\', '/')
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error(`--graph-file must be a project-relative path: ${file}`)
  }
  return normalized.replace(/^(?:\.\/)+/, '')
}
