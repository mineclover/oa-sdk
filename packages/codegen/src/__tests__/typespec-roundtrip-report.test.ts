import { describe, expect, it } from 'vitest'
import type { OasDocument } from '@oa-sdk/parser'
import type { TspExportReport } from '../cli/lib/tsp-export.js'
import { diffEndpoints } from '../cli/lib/openapi-breaking-diff.js'
import {
  createTypeSpecRoundtripReport,
  groupDiagnosticPolicies,
  groupDiagnosticsByCode,
  groupDiagnosticsByPolicy,
} from '../cli/lib/typespec-roundtrip-report.js'

describe('TypeSpec roundtrip report', () => {
  it('summarizes paths, counts, diagnostics, and changed operations', () => {
    const sourceDocument: OasDocument = {
      openapi: '3.2.0',
      info: { title: 'Roundtrip source', version: '0.1.0' },
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            responses: {
              '200': {
                description: 'Users',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/UserList' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          UserList: {
            type: 'object',
            required: ['items'],
            properties: {
              items: {
                type: 'array',
                items: { $ref: '#/components/schemas/User' },
              },
            },
          },
          User: {
            type: 'object',
            required: ['id'],
            properties: {
              id: { type: 'string' },
            },
          },
        },
      },
    }
    const emittedDocument: OasDocument = {
      ...sourceDocument,
      components: {
        schemas: {
          ...sourceDocument.components?.schemas,
          UserList: {
            type: 'object',
            required: ['items', 'total'],
            properties: {
              items: {
                type: 'array',
                items: { $ref: '#/components/schemas/User' },
              },
              total: { type: 'integer' },
            },
          },
          GeneratedWrapper: {
            type: 'object',
            properties: {
              body: { $ref: '#/components/schemas/UserList' },
            },
          },
        },
      },
    }
    const exportReport: TspExportReport = {
      schemaVersion: 'oa-gen.tsp-export-report.v1',
      namespace: 'OaSdkApi',
      sourceOpenapi: '3.2.0',
      counts: {
        componentSchemas: 2,
        generatedModels: 1,
        operations: 1,
        diagnostics: 3,
      },
      diagnostics: [
        {
          severity: 'warning',
          code: 'schema/default-dropped',
          pointer: '#/components/schemas/UserList',
          message: 'Schema default is not emitted.',
        },
        {
          severity: 'warning',
          code: 'schema/default-dropped',
          pointer: '#/components/schemas/User',
          message: 'Schema default is not emitted.',
        },
        {
          severity: 'warning',
          code: 'operation/security-dropped',
          pointer: '#/paths/~1users/get/security',
          message: 'Security is not emitted.',
        },
      ],
    }

    const report = createTypeSpecRoundtripReport({
      namespace: 'OaSdkApi',
      sourceOpenapiPath: '/repo/packages/schemas/src/.merged.yaml',
      emittedOpenapiPath: '/tmp/roundtrip/openapi.yaml',
      tspSourcePath: '/tmp/roundtrip/main.tsp',
      workspacePath: '/tmp/roundtrip',
      sourceDocument,
      emittedDocument,
      exportReport,
      diff: diffEndpoints(sourceDocument, emittedDocument),
      validation: {
        valid: true,
        summary: 'Valid',
      },
    })

    expect(report.schemaVersion).toBe('oa-sdk.typespec-roundtrip-report.v1')
    expect(report.paths.sourceOpenapi).toBe('/repo/packages/schemas/src/.merged.yaml')
    expect(report.paths.emittedOpenapi).toBe('/tmp/roundtrip/openapi.yaml')
    expect(report.counts.operations).toEqual({ source: 1, emitted: 1 })
    expect(report.counts.componentSchemas).toEqual({ source: 2, emitted: 3 })
    expect(report.counts.exportDiagnostics).toBe(3)
    expect(report.counts.diff.breaking).toBe(1)
    expect(report.counts.diff.nonBreaking).toBe(0)
    expect(report.diagnosticsByCode).toEqual([
      { code: 'operation/security-dropped', count: 1 },
      { code: 'schema/default-dropped', count: 2 },
    ])
    expect(report.diagnosticsByPolicy).toEqual([
      { disposition: 'contract-bearing', accepted: false, count: 1 },
      { disposition: 'unclassified', accepted: false, count: 2 },
    ])
    expect(report.diagnosticPolicies).toEqual([
      {
        code: 'operation/security-dropped',
        count: 1,
        policy: {
          disposition: 'contract-bearing',
          accepted: false,
          owner: 'tsp-export-auth-mapping',
          rationale: 'Operation-level security requirements are request contract semantics.',
        },
      },
      {
        code: 'schema/default-dropped',
        count: 2,
        policy: {
          disposition: 'unclassified',
          accepted: false,
          owner: 'tsp-export',
          rationale: 'No accepted TypeSpec roundtrip policy is registered for this diagnostic code.',
        },
      },
    ])
    expect(report.diagnostics[0]).toMatchObject({
      code: 'schema/default-dropped',
      policy: {
        disposition: 'unclassified',
        accepted: false,
      },
    })
    expect(report.changedOperations.modified).toEqual([
      {
        method: 'GET',
        path: '/users',
        operationId: 'listUsers',
        changes: ['response 200 schema changed'],
      },
    ])
    expect(report.changes.breaking[0]).toMatchObject({
      code: 'response-schema-changed',
      endpoint: 'GET /users',
      severity: 'breaking',
    })
    expect(report.gates.breakingDiff).toBe('fail')
    expect(report.gates.exportDiagnostics).toBe('fail')
  })

  it('classifies current accepted externalized diagnostics as an export diagnostics pass', () => {
    const sourceDocument: OasDocument = {
      openapi: '3.2.0',
      info: { title: 'Roundtrip source', version: '0.1.0' },
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            parameters: [
              {
                name: 'page',
                in: 'query',
                schema: { type: 'integer' },
                examples: { default: { value: 1 } },
              },
            ],
            responses: {
              '200': {
                description: 'Users',
                content: {
                  'application/json': {
                    schema: { type: 'object' },
                    examples: { default: { value: {} } },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        securitySchemes: {
          oauth2: {
            type: 'oauth2',
            flows: {},
          },
        },
      },
    }
    const exportReport: TspExportReport = {
      schemaVersion: 'oa-gen.tsp-export-report.v1',
      namespace: 'OaSdkApi',
      sourceOpenapi: '3.2.0',
      counts: {
        componentSchemas: 0,
        generatedModels: 0,
        operations: 1,
        diagnostics: 3,
      },
      diagnostics: [
        {
          severity: 'warning',
          code: 'parameter/examples-dropped',
          pointer: '#/paths/~1users/get/parameters/0',
          message: 'Parameter examples are not emitted.',
        },
        {
          severity: 'warning',
          code: 'response/examples-dropped',
          pointer: '#/paths/~1users/get/responses/200/content/application~1json',
          message: 'Response examples are not emitted.',
        },
        {
          severity: 'warning',
          code: 'components/security-scheme-dropped',
          pointer: '#/components/securitySchemes/oauth2',
          message: 'OAuth2 is not emitted.',
        },
      ],
    }

    const report = createTypeSpecRoundtripReport({
      namespace: 'OaSdkApi',
      sourceOpenapiPath: '/repo/packages/schemas/src/.merged.yaml',
      emittedOpenapiPath: '/tmp/roundtrip/openapi.yaml',
      tspSourcePath: '/tmp/roundtrip/main.tsp',
      workspacePath: '/tmp/roundtrip',
      sourceDocument,
      emittedDocument: sourceDocument,
      exportReport,
      diff: diffEndpoints(sourceDocument, sourceDocument),
      validation: {
        valid: true,
        summary: 'Valid',
      },
    })

    expect(report.gates.exportDiagnostics).toBe('pass')
    expect(report.diagnosticsByPolicy).toEqual([
      { disposition: 'externalized', accepted: true, count: 2 },
      { disposition: 'metadata-only', accepted: true, count: 1 },
    ])
    expect(report.diagnosticPolicies).toEqual([
      {
        code: 'components/security-scheme-dropped',
        count: 1,
        policy: expect.objectContaining({
          disposition: 'metadata-only',
          accepted: true,
          owner: 'openapi-security-component-metadata',
        }),
      },
      {
        code: 'parameter/examples-dropped',
        count: 1,
        policy: expect.objectContaining({
          disposition: 'externalized',
          accepted: true,
          owner: 'oa-sdk-openapi-example-sidecar',
        }),
      },
      {
        code: 'response/examples-dropped',
        count: 1,
        policy: expect.objectContaining({
          disposition: 'externalized',
          accepted: true,
          owner: 'oa-sdk-openapi-example-sidecar',
        }),
      },
    ])
  })

  it('keeps referenced unsupported security schemes as contract-bearing diagnostics', () => {
    const sourceDocument: OasDocument = {
      openapi: '3.2.0',
      info: { title: 'Roundtrip source', version: '0.1.0' },
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            security: [{ oauth2: ['read'] }],
            responses: {
              '200': { description: 'Users' },
            },
          },
        },
      },
      components: {
        securitySchemes: {
          oauth2: {
            type: 'oauth2',
            flows: {},
          },
        },
      },
    }
    const exportReport: TspExportReport = {
      schemaVersion: 'oa-gen.tsp-export-report.v1',
      namespace: 'OaSdkApi',
      sourceOpenapi: '3.2.0',
      counts: {
        componentSchemas: 0,
        generatedModels: 0,
        operations: 1,
        diagnostics: 1,
      },
      diagnostics: [
        {
          severity: 'warning',
          code: 'components/security-scheme-dropped',
          pointer: '#/components/securitySchemes/oauth2',
          message: 'OAuth2 is not emitted.',
        },
      ],
    }

    const report = createTypeSpecRoundtripReport({
      namespace: 'OaSdkApi',
      sourceOpenapiPath: '/repo/packages/schemas/src/.merged.yaml',
      emittedOpenapiPath: '/tmp/roundtrip/openapi.yaml',
      tspSourcePath: '/tmp/roundtrip/main.tsp',
      workspacePath: '/tmp/roundtrip',
      sourceDocument,
      emittedDocument: sourceDocument,
      exportReport,
      diff: diffEndpoints(sourceDocument, sourceDocument),
      validation: {
        valid: true,
        summary: 'Valid',
      },
    })

    expect(report.gates.exportDiagnostics).toBe('fail')
    expect(report.diagnosticPolicies).toEqual([
      {
        code: 'components/security-scheme-dropped',
        count: 1,
        policy: {
          disposition: 'contract-bearing',
          accepted: false,
          owner: 'tsp-export-auth-mapping',
          rationale: 'A referenced security scheme that is not emitted can change operation auth semantics.',
        },
      },
    ])
  })

  it('includes compatibility sidecar restore evidence when provided', () => {
    const document: OasDocument = {
      openapi: '3.2.0',
      info: { title: 'Roundtrip source', version: '0.1.0' },
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            responses: {
              '200': { description: 'Users' },
            },
          },
        },
      },
    }
    const exportReport: TspExportReport = {
      schemaVersion: 'oa-gen.tsp-export-report.v1',
      namespace: 'OaSdkApi',
      sourceOpenapi: '3.2.0',
      counts: {
        componentSchemas: 0,
        generatedModels: 0,
        operations: 1,
        diagnostics: 0,
      },
      diagnostics: [],
    }

    const report = createTypeSpecRoundtripReport({
      namespace: 'OaSdkApi',
      sourceOpenapiPath: '/repo/packages/schemas/src/.merged.yaml',
      emittedOpenapiPath: '/tmp/roundtrip/openapi.yaml',
      tspSourcePath: '/tmp/roundtrip/main.tsp',
      workspacePath: '/tmp/roundtrip',
      sourceDocument: document,
      emittedDocument: document,
      exportReport,
      diff: diffEndpoints(document, document),
      validation: {
        valid: true,
        summary: 'Valid',
      },
      compatibilitySidecar: {
        sidecarPath: '/tmp/roundtrip/sidecar.json',
        restoredOpenapiPath: '/tmp/roundtrip/openapi.restored.yaml',
        sidecar: {
          schemaVersion: 'oa-sdk.typespec-compat-sidecar.v1',
          counts: {
            entries: 1,
            parameterExamples: 0,
            responseMediaExamples: 1,
            securitySchemes: 0,
          },
          entries: [
            {
              kind: 'response-media-examples',
              pointer: '#/paths/~1users/get/responses/200/content/application~1json',
              target: {
                path: '/users',
                method: 'get',
                statusCode: '200',
                mediaType: 'application/json',
              },
              value: {
                examples: {
                  default: { dataValue: {} },
                },
              },
            },
          ],
        },
        reExtractedSidecar: {
          schemaVersion: 'oa-sdk.typespec-compat-sidecar.v1',
          counts: {
            entries: 1,
            parameterExamples: 0,
            responseMediaExamples: 1,
            securitySchemes: 0,
          },
          entries: [
            {
              kind: 'response-media-examples',
              pointer: '#/paths/~1users/get/responses/200/content/application~1json',
              target: {
                path: '/users',
                method: 'get',
                statusCode: '200',
                mediaType: 'application/json',
              },
              value: {
                examples: {
                  default: { dataValue: {} },
                },
              },
            },
          ],
        },
        restoreReport: {
          schemaVersion: 'oa-sdk.typespec-compat-restore-report.v1',
          counts: {
            entries: 1,
            applied: 1,
            missingTargets: 0,
          },
          diagnostics: [],
        },
        stabilityReport: {
          schemaVersion: 'oa-sdk.typespec-compat-compare-report.v1',
          counts: {
            expectedEntries: 1,
            actualEntries: 1,
            expectedSatisfied: 1,
            actualCovered: 1,
            missingExpected: 0,
            unexpectedActual: 0,
            valueMismatches: 0,
          },
          diagnostics: [],
        },
        restoredDiff: diffEndpoints(document, document),
        validation: {
          valid: true,
          summary: 'Valid',
        },
      },
    })

    expect(report.paths.compatibilitySidecar).toBe('/tmp/roundtrip/sidecar.json')
    expect(report.paths.restoredOpenapi).toBe('/tmp/roundtrip/openapi.restored.yaml')
    expect(report.counts.compatibilitySidecar).toEqual({
      entries: 1,
      parameterExamples: 0,
      responseMediaExamples: 1,
      securitySchemes: 0,
    })
    expect(report.compatibilitySidecar?.reExtractedCounts).toEqual({
      entries: 1,
      parameterExamples: 0,
      responseMediaExamples: 1,
      securitySchemes: 0,
    })
    expect(report.compatibilitySidecar?.restore.counts).toEqual({
      entries: 1,
      applied: 1,
      missingTargets: 0,
    })
    expect(report.compatibilitySidecar?.stability.counts).toEqual({
      expectedEntries: 1,
      actualEntries: 1,
      expectedSatisfied: 1,
      actualCovered: 1,
      missingExpected: 0,
      unexpectedActual: 0,
      valueMismatches: 0,
    })
    expect(report.compatibilitySidecar?.diff.breaking).toBe(0)
    expect(report.gates.compatibilitySidecar).toBe('pass')
  })

  it('groups diagnostics by code in stable order', () => {
    expect(groupDiagnosticsByCode([
      { severity: 'warning', code: 'b', pointer: '#/b', message: 'b' },
      { severity: 'warning', code: 'a', pointer: '#/a1', message: 'a1' },
      { severity: 'warning', code: 'a', pointer: '#/a2', message: 'a2' },
    ])).toEqual([
      { code: 'a', count: 2 },
      { code: 'b', count: 1 },
    ])
  })

  it('groups diagnostics by policy in stable order', () => {
    expect(groupDiagnosticsByPolicy([
      {
        severity: 'warning',
        code: 'response/examples-dropped',
        pointer: '#/a',
        message: 'a',
        policy: {
          disposition: 'externalized',
          accepted: true,
          owner: 'oa-sdk-openapi-example-sidecar',
          rationale: 'a',
        },
      },
      {
        severity: 'warning',
        code: 'schema/type-unknown',
        pointer: '#/b',
        message: 'b',
        policy: {
          disposition: 'unclassified',
          accepted: false,
          owner: 'tsp-export',
          rationale: 'b',
        },
      },
    ])).toEqual([
      { disposition: 'unclassified', accepted: false, count: 1 },
      { disposition: 'externalized', accepted: true, count: 1 },
    ])
  })

  it('groups diagnostic policies by code and rationale', () => {
    expect(groupDiagnosticPolicies([
      {
        severity: 'warning',
        code: 'a',
        pointer: '#/a1',
        message: 'a1',
        policy: {
          disposition: 'externalized',
          accepted: true,
          owner: 'owner',
          rationale: 'same',
        },
      },
      {
        severity: 'warning',
        code: 'a',
        pointer: '#/a2',
        message: 'a2',
        policy: {
          disposition: 'externalized',
          accepted: true,
          owner: 'owner',
          rationale: 'same',
        },
      },
    ])).toEqual([
      {
        code: 'a',
        count: 2,
        policy: {
          disposition: 'externalized',
          accepted: true,
          owner: 'owner',
          rationale: 'same',
        },
      },
    ])
  })
})
