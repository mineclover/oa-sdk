import { describe, expect, it } from 'vitest'
import {
  buildParallelEvidence,
  buildParallelEvidenceFromArtifacts,
  createParallelEvidenceMetricDelta,
  createParallelEvidenceReport,
  parseParallelEvidenceMetrics,
  type ImplementationProvenanceArtifact,
  type TtscContractProvenanceV2,
} from '../cli/lib/parallel-evidence.js'
import type { TypeSpecRefProvenanceV1 } from '../cli/lib/typespec-ref-provenance.js'

describe('parallel provenance evidence', () => {
  it('joins only shared OpenAPI pointers while preserving TypeSpec authority and ttsc observations', () => {
    const result = buildParallelEvidence({ contract: contractArtifact(), implementation: implementationArtifact() })

    expect(result).toEqual(buildParallelEvidence({ contract: contractArtifact(), implementation: implementationArtifact() }))
    expect(result).toMatchObject({
      schemaVersion: 'oa-sdk.parallel-evidence.v1',
      purpose: 'review-evidence-only',
      contractAuthority: 'typespec',
      summary: {
        matchedPointers: 2,
        contractOnlyPointers: 1,
        implementationOnlyPointers: 1,
        contractRelations: 1,
        implementationRelations: 1,
      },
    })
    expect(result.subjects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        outputPointer: '#/components/schemas/Widget',
        status: 'matched-pointer',
        contract: [expect.objectContaining({ sourceId: 'typespec', declarationId: 'model:models.tsp:Widget' })],
        implementation: [expect.objectContaining({
          sourceId: 'ttsc',
          declarationId: 'schema:contracts.ts:Widget',
          observations: { astKind: 'InterfaceDeclaration', typeShape: { features: ['object'], typeSpecProjection: 'direct' } },
        })],
      }),
      expect.objectContaining({ outputPointer: '#/components/schemas/ContractOnly', status: 'contract-only' }),
      expect.objectContaining({ outputPointer: '#/components/schemas/LocalOnly', status: 'implementation-only' }),
    ]))
    expect(result.relations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceId: 'typespec',
        kind: 'openapi-ref',
        target: { ref: '#/components/schemas/Widget', subjectId: 'openapi-pointer:#/components/schemas/Widget' },
      }),
      expect.objectContaining({
        sourceId: 'ttsc',
        kind: 'type-ref',
        source: { declarationId: 'property:contracts.ts:Envelope.widget' },
        target: { declarationId: 'schema:contracts.ts:Widget', subjectId: 'openapi-pointer:#/components/schemas/Widget' },
      }),
    ]))
    expect(result.metrics).toEqual(expect.objectContaining({
      schemaVersion: 'oa-sdk.parallel-evidence-metrics.v1',
      pointers: {
        contract: 3,
        implementation: 3,
        union: 4,
        matched: 2,
        contractCoverageRatio: 2 / 3,
        implementationCoverageRatio: 2 / 3,
        unionCoverageRatio: 0.5,
      },
      declarations: expect.objectContaining({
        contractTotal: 3,
        implementationTotal: 4,
        implementationShapeAnnotated: 3,
      }),
      implementationShapes: expect.objectContaining({
        direct: 2,
        unsupported: 1,
        unclassified: 1,
        features: { conditional: 1, object: 1, reference: 1 },
      }),
    }))
  })

  it('creates a stable baseline delta that includes newly observed TypeScript shape features', () => {
    const evidence = buildParallelEvidence({ contract: contractArtifact(), implementation: implementationArtifact() })
    const baseline = structuredClone(evidence.metrics)
    baseline.pointers.matched = 1
    baseline.implementationShapes.features = { object: 1 }
    const delta = createParallelEvidenceMetricDelta(baseline, evidence.metrics)
    const report = createParallelEvidenceReport({ evidence, baseline })

    expect(delta.changed).toBe(true)
    expect(delta.values['pointers.matched']).toEqual({ baseline: 1, current: 2, delta: 1 })
    expect(delta.values['implementationShapes.features.conditional']).toEqual({ baseline: 0, current: 1, delta: 1 })
    expect(report.baseline).toEqual(delta)
    expect(parseParallelEvidenceMetrics(report)).toEqual(evidence.metrics)
    expect(parseParallelEvidenceMetrics(evidence.metrics)).toEqual(evidence.metrics)
    expect(() => parseParallelEvidenceMetrics({
      schemaVersion: 'oa-sdk.parallel-evidence-metrics.v1',
      pointers: {},
    })).toThrow('parallel evidence metrics declarations must be an object')
  })

  it('accepts a trusted non-ttsc implementation adapter without changing TypeSpec authority', () => {
    const implementation: ImplementationProvenanceArtifact = {
      ...implementationArtifact(),
      schemaVersion: 'example-ts-ast-provenance.v1',
    }
    const result = buildParallelEvidenceFromArtifacts({
      contract: contractArtifact(),
      implementation,
      implementationAdapter: {
        sourceId: 'example-ts-ast',
        provenanceKind: 'typescript-compiler-api',
        parse: value => value as ImplementationProvenanceArtifact,
      },
    })

    expect(result.contractAuthority).toBe('typespec')
    expect(result.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceId: 'example-ts-ast',
        artifactSchemaVersion: 'example-ts-ast-provenance.v1',
        provenanceKind: 'typescript-compiler-api',
      }),
    ]))
    expect(result.subjects.find(subject => subject.outputPointer === '#/components/schemas/Widget')?.implementation[0]?.sourceId).toBe('example-ts-ast')
  })
})

function contractArtifact(): TypeSpecRefProvenanceV1 {
  return {
    schemaVersion: 'oa-sdk.typespec-ref-provenance.v1',
    provenanceKind: 'typespec-source-ast',
    inputs: {
      sourceRoot: '.',
      sourceSha256: 'typespec-source',
      restoredOpenApiSha256: 'openapi',
      toolchainFingerprint: 'typespec-toolchain',
    },
    declarations: [
      { id: 'model:models.tsp:Widget', kind: 'model', symbol: 'Widget', source: range('models.tsp', 1) },
      { id: 'model:models.tsp:ContractOnly', kind: 'model', symbol: 'ContractOnly', source: range('models.tsp', 5) },
      { id: 'operation:widgets.tsp:getWidget', kind: 'operation', symbol: 'getWidget', source: range('widgets.tsp', 1) },
    ],
    edges: [
      { kind: 'emits', declarationId: 'model:models.tsp:Widget', outputPointer: '#/components/schemas/Widget' },
      { kind: 'emits', declarationId: 'model:models.tsp:ContractOnly', outputPointer: '#/components/schemas/ContractOnly' },
      { kind: 'emits', declarationId: 'operation:widgets.tsp:getWidget', outputPointer: '#/paths/~1widgets~1{id}/get' },
      {
        kind: 'references',
        declarationId: 'operation:widgets.tsp:getWidget',
        outputPointer: '#/paths/~1widgets~1{id}/get/responses/200/content/application~1json/schema/$ref',
        targetRef: '#/components/schemas/Widget',
      },
    ],
    exclusions: [],
  }
}

function implementationArtifact(): TtscContractProvenanceV2 {
  return {
    schemaVersion: 'ttsc-contract-provenance.v2',
    inputs: { toolchain: { typescript: '7.0.2' } },
    declarations: [
      {
        id: 'schema:contracts.ts:Widget',
        kind: 'schema',
        astKind: 'InterfaceDeclaration',
        symbol: 'Widget',
        source: range('contracts.ts', 1),
        shape: { features: ['object'], typeSpecProjection: 'direct' },
      },
      {
        id: 'operation:contracts.ts:getWidget',
        kind: 'operation',
        astKind: 'FunctionDeclaration',
        symbol: 'getWidget',
        source: range('contracts.ts', 5),
      },
      {
        id: 'property:contracts.ts:Envelope.widget',
        kind: 'property',
        astKind: 'PropertySignature',
        symbol: 'Envelope.widget',
        source: range('contracts.ts', 9),
        shape: { features: ['reference'], typeSpecProjection: 'direct' },
      },
      {
        id: 'schema:contracts.ts:LocalOnly',
        kind: 'schema',
        astKind: 'TypeAliasDeclaration',
        symbol: 'LocalOnly',
        source: range('contracts.ts', 12),
        shape: { features: ['conditional'], typeSpecProjection: 'unsupported' },
      },
    ],
    edges: [
      { kind: 'emits', declarationId: 'schema:contracts.ts:Widget', outputPointer: '#/components/schemas/Widget' },
      { kind: 'emits', declarationId: 'operation:contracts.ts:getWidget', outputPointer: '#/paths/~1widgets~1{id}/get' },
      { kind: 'emits', declarationId: 'schema:contracts.ts:LocalOnly', outputPointer: '#/components/schemas/LocalOnly' },
      { kind: 'type-ref', declarationId: 'property:contracts.ts:Envelope.widget', targetDeclarationId: 'schema:contracts.ts:Widget' },
    ],
    diagnostics: [],
  }
}

function range(file: string, line: number) {
  return { file, start: { line, column: 1 }, end: { line, column: 2 } }
}
