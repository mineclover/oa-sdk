import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractOperationsFromSource, parseDocument, type OasDocument } from '@oa-sdk/parser'
import { traceCommand } from '../../cli/commands/trace.js'
import { CliExitError } from '../../cli/lib/errors.js'
import {
  analyzeSpecImpact,
  buildSpecTraceabilityGraph,
  formatSpecTraceabilityHumanReport,
  loadSpecTraceabilitySidecar,
  querySpecTrace,
  saveSpecTraceabilitySidecar,
  SPEC_TRACEABILITY_SCHEMA_VERSION,
  toTypegenProvenanceMap,
} from '../../traceability/index.js'
import { generateTypes } from '../../typegen/generate-types.js'

function createSampleSpec(): OasDocument {
  return {
    openapi: '3.2.0',
    info: { title: 'Traceability Test API', version: '1.0.0' },
    components: {
      schemas: {
        Address: {
          type: 'object',
          description: 'Postal address model',
          required: ['city'],
          properties: {
            city: { type: 'string' },
          },
          'x-oa-sdk-trace': {
            trackingId: 'TRC-ADDR-001',
            requirements: ['REQ-CORE-010'],
          },
        },
        User: {
          type: 'object',
          description: 'User account entity',
          required: ['id', 'address'],
          properties: {
            id: { type: 'string' },
            address: { $ref: '#/components/schemas/Address' },
          },
          'x-oa-sdk-trace': {
            trackingId: 'TRC-USER-001',
            replaces: 'schema.LegacyUser',
            requirements: ['REQ-AUTH-101', 'REQ-GDPR-002'],
          },
          'x-persona': 'customer-admin',
          'x-oa-sdk-persona-traits': ['auditable', 'pii-masked'],
        },
      },
    },
    paths: {
      '/users/{id}': {
        get: {
          operationId: 'getUser',
          summary: 'Fetch user by ID',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/User' },
                },
              },
            },
          },
          'x-oa-sdk-trace': {
            trackingId: 'TRC-OP-GET-USER',
            requirements: ['REQ-AUTH-101'],
          },
          'x-persona': 'customer-admin',
        },
      },
    },
  } as unknown as OasDocument
}

describe('SpecTraceabilityEngine', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
    vi.restoreAllMocks()
  })

  it('builds an end-to-end traceability graph with $ref edges, governance capabilities, and artifact symbol mappings', () => {
    const spec = createSampleSpec()
    const graph = buildSpecTraceabilityGraph({
      spec,
      specPath: 'specs/openapi.yaml',
      artifactFilePaths: {
        types: 'src/generated/api.types.ts',
        contract: 'src/generated/api.contract.ts',
        router: 'src/generated/api.router.ts',
        client: 'src/generated/api.client.ts',
        keys: 'src/generated/api.keys.ts',
        queries: 'src/generated/api.queries.ts',
        guards: 'src/generated/api.guard.ts',
        schemas: 'src/generated/api.schema.json',
      },
    })

    expect(graph.schemaVersion).toBe(SPEC_TRACEABILITY_SCHEMA_VERSION)
    expect(graph.summary.nodeCount).toBe(3)
    expect(graph.summary.schemaCount).toBe(2)
    expect(graph.summary.operationCount).toBe(1)
    expect(graph.summary.explicitTrackingIdCount).toBe(3)
    expect(graph.summary.referenceEdgeCount).toBe(2)
    expect(graph.diagnostics).toEqual([])

    const addressNode = graph.nodes['#/components/schemas/Address']!
    const userNode = graph.nodes['#/components/schemas/User']!
    const getUserNode = graph.nodes['#/paths/~1users~1{id}/get']!

    expect(addressNode.trackingId).toBe('TRC-ADDR-001')
    expect(addressNode.referencedBy).toEqual(['#/components/schemas/User'])

    expect(userNode.trackingId).toBe('TRC-USER-001')
    expect(userNode.replaces).toEqual(['schema.LegacyUser'])
    expect(userNode.governance.persona).toBe('customer-admin')
    expect(userNode.governance.personaTraits).toEqual(['auditable', 'pii-masked'])
    expect(userNode.governance.requirements).toEqual(['REQ-AUTH-101', 'REQ-GDPR-002'])
    expect(userNode.references).toEqual(['#/components/schemas/Address'])
    expect(userNode.referencedBy).toEqual(['#/paths/~1users~1{id}/get'])

    expect(getUserNode.trackingId).toBe('TRC-OP-GET-USER')
    expect(getUserNode.references).toEqual(['#/components/schemas/User'])
    expect(
      getUserNode.generatedArtifacts.find(a => a.kind === 'contract')?.exportedSymbols,
    ).toEqual(['GetUserHandler', 'GetUserContract'])
    expect(
      getUserNode.generatedArtifacts.find(a => a.kind === 'queries')?.exportedSymbols,
    ).toEqual(['useGetUserQuery'])
  })

  it('extracts TypeSpec AST source coordinates when typespecRoot is provided', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oa-trace-tsp-'))
    tempDirs.push(dir)

    writeFileSync(
      join(dir, 'main.tsp'),
      [
        'model Address {',
        '  city: string;',
        '}',
        '',
        'model User {',
        '  id: string;',
        '  address: Address;',
        '}',
      ].join('\n'),
      'utf-8',
    )

    const graph = buildSpecTraceabilityGraph({
      spec: createSampleSpec(),
      typespecRoot: dir,
    })

    const userNode = graph.nodes['#/components/schemas/User']!
    expect(userNode.source.origin).toBe('typespec-ast')
    expect(userNode.source.filePath).toBe('main.tsp')
    expect(userNode.source.line).toBe(5)
    expect(userNode.source.symbol).toBe('User')
  })

  it('supports multi-criteria queries across symbols, generated TS symbols, requirements, and personas', () => {
    const graph = buildSpecTraceabilityGraph({
      spec: createSampleSpec(),
      specPath: 'specs/openapi.yaml',
    })

    // Query by generated TypeScript symbol (e.g. TanStack Query hook or Handler contract)
    const byHook = querySpecTrace(graph, { symbol: 'useGetUserQuery' })
    expect(byHook.map(n => n.pointer)).toEqual(['#/paths/~1users~1{id}/get'])

    const byGuard = querySpecTrace(graph, { symbol: 'isUser' })
    expect(byGuard.map(n => n.pointer)).toEqual(['#/components/schemas/User'])

    // Query by requirement
    const byReq = querySpecTrace(graph, { requirement: 'REQ-AUTH-101' })
    expect(byReq.map(n => n.pointer)).toEqual([
      '#/components/schemas/User',
      '#/paths/~1users~1{id}/get',
    ])

    // Query by persona trait
    const byTrait = querySpecTrace(graph, { personaTrait: 'pii-masked' })
    expect(byTrait.map(n => n.pointer)).toEqual(['#/components/schemas/User'])
  })

  it('computes transitive reverse-dependency impact analysis (blast radius)', () => {
    const graph = buildSpecTraceabilityGraph({
      spec: createSampleSpec(),
      specPath: 'specs/openapi.yaml',
      artifactFilePaths: {
        types: 'src/generated/api.types.ts',
        contract: 'src/generated/api.contract.ts',
      },
    })

    // Modifying Address should transitively impact User and getUser!
    const impact = analyzeSpecImpact(graph, ['Address'])
    expect(impact.seedPointers).toEqual(['#/components/schemas/Address'])
    expect(impact.affectedPointers).toEqual([
      '#/components/schemas/Address',
      '#/components/schemas/User',
      '#/paths/~1users~1{id}/get',
    ])
    expect(impact.affectedSchemas.map(s => s.symbol)).toEqual(['Address', 'User'])
    expect(impact.affectedOperations.map(o => o.symbol)).toEqual(['getUser'])
    expect(impact.affectedRequirements).toEqual([
      'REQ-AUTH-101',
      'REQ-CORE-010',
      'REQ-GDPR-002',
    ])
    expect(impact.affectedPersonas).toEqual(['customer-admin'])
    expect(impact.affectedFiles).toEqual([
      'src/generated/api.contract.ts',
      'src/generated/api.types.ts',
    ])
    expect(impact.affectedGeneratedSymbols).toContain('GetUserHandler')
    expect(impact.affectedGeneratedSymbols).toContain('useGetUserQuery')
  })

  it('emits JSDoc provenance tags in generateTypes without breaking @oaOperation AST extraction', () => {
    const spec = createSampleSpec()
    const graph = buildSpecTraceabilityGraph({
      spec,
      specPath: 'specs/openapi.yaml',
    })
    const provenance = toTypegenProvenanceMap(graph)
    const parsedDoc = parseDocument(spec, [])

    const tsCode = generateTypes(parsedDoc, {
      includeProvenanceAnnotations: true,
      provenance,
    })

    expect(tsCode).toContain('@oa-pointer #/components/schemas/User')
    expect(tsCode).toContain('@oa-source specs/openapi.yaml#/components/schemas/User')
    expect(tsCode).toContain('@oa-id schema.User')
    expect(tsCode).toContain('@oa-trace-id TRC-USER-001')
    expect(tsCode).toContain('@oa-replaces schema.LegacyUser')
    expect(tsCode).toContain('@oa-requirement REQ-AUTH-101')
    expect(tsCode).toContain('@oa-pointer #/paths/~1users~1{id}/get')
    expect(tsCode).toContain('@oa-trace-id TRC-OP-GET-USER')

    // Ensure @oaOperation extraction still works cleanly on generated types
    const extracted = extractOperationsFromSource(tsCode, 'api.types.ts')
    expect(extracted.diagnostics).toEqual([])
    expect(extracted.operations).toHaveLength(1)
    expect(extracted.operations[0]?.method).toBe('get')
    expect(extracted.operations[0]?.path).toBe('/users/{id}')
  })

  it('saves and loads .oa-trace.json sidecar files and runs oa-gen trace CLI command', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oa-trace-cli-'))
    tempDirs.push(dir)

    const specPath = join(dir, 'openapi.json')
    const tracePath = join(dir, '.oa-trace.json')
    writeFileSync(specPath, JSON.stringify(createSampleSpec(), null, 2), 'utf-8')

    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '))
    })

    await traceCommand.run({
      spec: specPath,
      output: tracePath,
      impact: 'Address',
      format: 'json',
    })

    const loaded = loadSpecTraceabilitySidecar(tracePath)
    expect(loaded.schemaVersion).toBe(SPEC_TRACEABILITY_SCHEMA_VERSION)
    expect(Object.keys(loaded.nodes)).toHaveLength(3)

    const cliJson = JSON.parse(logs.join('\n')) as {
      impact: { affectedPointers: string[] }
    }
    expect(cliJson.impact.affectedPointers).toEqual([
      '#/components/schemas/Address',
      '#/components/schemas/User',
      '#/paths/~1users~1{id}/get',
    ])

    const humanReport = formatSpecTraceabilityHumanReport(
      Object.values(loaded.nodes),
      analyzeSpecImpact(loaded, ['Address']),
    )
    expect(humanReport).toContain('=== Spec Traceability Report (3 definition(s)) ===')
    expect(humanReport).toContain('=== Impact Analysis (Blast Radius) ===')
  })

  it('detects duplicate trackingIds and fails --verify when diagnostics exist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oa-trace-dup-'))
    tempDirs.push(dir)

    const spec = createSampleSpec()
    const addrSchema = spec.components!.schemas!.Address as unknown as Record<string, unknown>
    addrSchema['x-oa-sdk-trace'] = { trackingId: 'TRC-USER-001' } // duplicate with User!

    const specPath = join(dir, 'openapi.json')
    writeFileSync(specPath, JSON.stringify(spec, null, 2), 'utf-8')

    vi.spyOn(console, 'log').mockImplementation(() => {})

    await expect(
      traceCommand.run({
        spec: specPath,
        verify: true,
      }),
    ).rejects.toThrow(CliExitError)
  })

  it('bridges x-samchon-evidence requirements and typeSpecSource coordinates into traceability and JSDoc provenance', () => {
    const spec: OasDocument = {
      openapi: '3.2.0',
      info: { title: 'Samchon Evidence Bridge Test', version: '1.0.0' },
      components: {
        schemas: {
          Account: {
            type: 'object',
            required: ['id'],
            properties: {
              id: { type: 'string' },
            },
            'x-samchon-evidence': {
              upstreamRequirement: 'docs/requirements.md#req-account-root',
              requirements: [
                {
                  target: 'docs/requirements.md#req-account-root',
                  reason: 'Canonical account entity root',
                },
                {
                  target: 'docs/security.md#req-account-audit',
                  reason: 'Audit compliance\nLine 2 checklist',
                },
              ],
              typeSpecSource: {
                file: 'specs/account.tsp',
                symbol: 'Account',
                kind: 'Model',
                start: { line: 12, column: 1 },
                end: { line: 18, column: 2 },
              },
            },
          },
        },
      },
      paths: {},
    } as unknown as OasDocument

    const graph = buildSpecTraceabilityGraph({ spec })
    const accountNode = graph.nodes['#/components/schemas/Account']!

    expect(accountNode.source).toEqual({
      origin: 'typespec-ast',
      filePath: 'specs/account.tsp',
      sourcePointer: '#/model/Account',
      symbol: 'Account',
      line: 12,
      column: 1,
      endLine: 18,
      endColumn: 2,
    })
    expect(accountNode.governance.requirements).toEqual([
      'docs/requirements.md#req-account-root',
      'docs/security.md#req-account-audit',
    ])

    // Content hash must ignore x-samchon-evidence rationale changes
    const mutatedSpec = structuredClone(spec)
    ;((mutatedSpec.components!.schemas!.Account as unknown as Record<string, unknown>)[
      'x-samchon-evidence'
    ] as Record<string, unknown>).requirements = [
      {
        target: 'docs/requirements.md#req-account-root',
        reason: 'Updated rationale text only',
      },
    ]
    const mutatedGraph = buildSpecTraceabilityGraph({ spec: mutatedSpec })
    expect(mutatedGraph.nodes['#/components/schemas/Account']!.contentHash).toBe(
      accountNode.contentHash,
    )

    // Direct generateTypes without external provenance map still emits @oa-source, @oa-requirement, and @evidence / ## @evidence from x-samchon-evidence
    const parsedDoc = parseDocument(spec, [])
    const tsCode = generateTypes(parsedDoc, {
      includeProvenanceAnnotations: true,
    })
    expect(tsCode).toContain('@oa-source specs/account.tsp#/model/Account')
    expect(tsCode).toContain('@oa-requirement docs/requirements.md#req-account-root')
    expect(tsCode).toContain('@oa-requirement docs/security.md#req-account-audit')
    expect(tsCode).toContain(
      '@evidence docs/requirements.md#req-account-root - Canonical account entity root',
    )
    expect(tsCode).toContain('## @evidence docs/security.md#req-account-audit')
    expect(tsCode).toContain('Line 2 checklist')
  })
})
