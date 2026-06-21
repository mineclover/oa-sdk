import { describe, expect, it } from 'vitest'
import type { OasDocument } from '@oa-sdk/parser'
import type { TspExportReport } from '../cli/lib/tsp-export.js'
import { diffEndpoints } from '../cli/lib/openapi-breaking-diff.js'
import {
  createTypeSpecRoundtripReport,
  groupDiagnosticsByCode,
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
})
