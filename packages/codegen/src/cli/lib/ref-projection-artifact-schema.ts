/**
 * JSON Schema (2020-12) of the `oa-sdk.ref-projection.v1` artifact.
 *
 * This constant is the authoring source; `docs/cli-spec/` holds its
 * language-neutral mirror for non-TypeScript consumers, and `pnpm
 * check:cli-spec` fails when the two drift apart. The schema checks the wire
 * shape; `createRefProjectionArtifact` additionally guarantees that ids are
 * unique and that every edge end names a node.
 */

// Ajv's CommonJS entrypoint assigns `exports.Ajv2020`, which Node exposes as a
// named ESM export.
import { Ajv2020 } from 'ajv/dist/2020.js'
import {
  REF_PROJECTION_DIAGNOSTIC_CODES,
  REF_PROJECTION_NODE_KINDS,
  REF_PROJECTION_RECURSIONS,
  REF_PROJECTION_SCHEMA_VERSION,
  REF_PROJECTION_UNMAPPED_REASONS,
} from './ref-projection-artifact.js'

export const REF_PROJECTION_ARTIFACT_SCHEMA_V1 = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://oa-sdk.dev/schema/ref-projection/oa-sdk.ref-projection.v1.schema.json',
  title: 'OA SDK ref projection artifact v1',
  description: 'Ref-preserving graph of an OpenAPI document: one node per reusable declaration or external reference target, one edge per $ref occurrence, and the canonical definition id of each node when build-spec provenance maps it.',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'generator', 'source', 'nodes', 'edges', 'diagnostics'],
  properties: {
    schemaVersion: { const: REF_PROJECTION_SCHEMA_VERSION },
    generator: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'version'],
      properties: {
        name: { $ref: '#/$defs/nonEmptyString' },
        version: { $ref: '#/$defs/nonEmptyString' },
      },
    },
    source: {
      type: 'object',
      additionalProperties: false,
      required: ['spec'],
      properties: {
        spec: { $ref: '#/$defs/sourceFile' },
        provenance: { $ref: '#/$defs/sourceFile' },
      },
    },
    nodes: { type: 'array', items: { $ref: '#/$defs/node' } },
    edges: { type: 'array', items: { $ref: '#/$defs/edge' } },
    diagnostics: { type: 'array', items: { $ref: '#/$defs/diagnostic' } },
  },
  $defs: {
    nonEmptyString: { type: 'string', minLength: 1 },
    pointerFragment: {
      description: 'Canonical, unencoded JSON Pointer URI fragment: "#" or "#/" followed by RFC 6901 escaped tokens.',
      type: 'string',
      pattern: '^#(?:/(?:[^~/]|~[01])*)*$',
    },
    filePath: {
      description: 'File relative to the entry document\'s directory, written as a $ref file part ("./shared.yaml", "../common/types.yaml").',
      $ref: '#/$defs/nonEmptyString',
    },
    sourceFile: {
      type: 'object',
      additionalProperties: false,
      required: ['path', 'contentHash'],
      properties: {
        path: { $ref: '#/$defs/nonEmptyString' },
        contentHash: { type: 'string', pattern: '^sha256:[0-9a-f]{64}$' },
      },
    },
    node: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'kind', 'name', 'pointer', 'identity'],
      properties: {
        id: { $ref: '#/$defs/nonEmptyString' },
        kind: { enum: [...REF_PROJECTION_NODE_KINDS] },
        name: { type: 'string' },
        pointer: { $ref: '#/$defs/pointerFragment' },
        filePath: { $ref: '#/$defs/filePath' },
        identity: {
          oneOf: [
            { $ref: '#/$defs/mappedIdentity' },
            { $ref: '#/$defs/unmappedIdentity' },
          ],
        },
      },
    },
    mappedIdentity: {
      type: 'object',
      additionalProperties: false,
      required: ['status', 'canonicalId', 'provenancePointer', 'sourcePath', 'sourcePointer', 'contentHash'],
      properties: {
        status: { const: 'mapped' },
        canonicalId: { $ref: '#/$defs/nonEmptyString' },
        provenancePointer: { $ref: '#/$defs/pointerFragment' },
        sourcePath: { type: 'string' },
        sourcePointer: { type: 'string' },
        contentHash: { type: 'string' },
      },
    },
    unmappedIdentity: {
      type: 'object',
      additionalProperties: false,
      required: ['status', 'reason'],
      properties: {
        status: { const: 'unmapped' },
        reason: { enum: [...REF_PROJECTION_UNMAPPED_REASONS] },
      },
    },
    edge: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'source', 'target', 'ref', 'sourcePointer', 'recursion'],
      properties: {
        id: { $ref: '#/$defs/nonEmptyString' },
        source: { $ref: '#/$defs/nonEmptyString' },
        target: { $ref: '#/$defs/nonEmptyString' },
        ref: { type: 'string' },
        sourcePointer: { $ref: '#/$defs/pointerFragment' },
        sourceFilePath: { $ref: '#/$defs/filePath' },
        recursion: { enum: [...REF_PROJECTION_RECURSIONS] },
      },
    },
    diagnostic: {
      type: 'object',
      additionalProperties: false,
      required: ['code', 'ref', 'message'],
      properties: {
        code: { enum: [...REF_PROJECTION_DIAGNOSTIC_CODES] },
        ref: { type: 'string' },
        message: { type: 'string' },
        sourcePointer: { type: 'string' },
        sourceFilePath: { $ref: '#/$defs/filePath' },
        filePath: { $ref: '#/$defs/filePath' },
        pointer: { type: 'string' },
        line: { type: 'integer', minimum: 1 },
        column: { type: 'integer', minimum: 1 },
      },
    },
  },
} as const

export type RefProjectionArtifactSchemaIssue = {
  instancePath: string
  keyword: string
  message: string
}

type CompiledSchema = {
  (value: unknown): boolean
  errors?: ReadonlyArray<{ instancePath: string; keyword: string; message?: string }> | null
}

let compiled: CompiledSchema | undefined

/** Check `value` against `REF_PROJECTION_ARTIFACT_SCHEMA_V1`; an empty list means it conforms. */
export function validateRefProjectionArtifact(value: unknown): RefProjectionArtifactSchemaIssue[] {
  compiled ??= new Ajv2020({ allErrors: true, strict: true }).compile(REF_PROJECTION_ARTIFACT_SCHEMA_V1) as CompiledSchema
  if (compiled(value)) return []
  return (compiled.errors ?? []).map(error => ({
    instancePath: error.instancePath,
    keyword: error.keyword,
    message: error.message ?? 'schema validation failed',
  }))
}
