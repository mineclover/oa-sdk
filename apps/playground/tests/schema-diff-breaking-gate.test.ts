import { describe, expect, it } from 'vitest'
import {
  classifyBreakingChanges,
  diffEndpoints,
  formatMarkdown,
  hasBreakingChanges,
} from '../../../scripts/spec-diff.js'

describe('schema diff breaking change gate', () => {
  it('classifies contract-breaking endpoint, parameter, request, and response changes', () => {
    const diff = diffEndpoints(baseSpec(), headSpec())
    const breaking = classifyBreakingChanges(diff)

    expect(diff.added.map(endpoint => `${endpoint.method} ${endpoint.path}`)).toEqual(['get /status'])
    expect(diff.removed.map(endpoint => `${endpoint.method} ${endpoint.path}`)).toEqual(['get /legacy'])
    expect(hasBreakingChanges(diff)).toBe(true)
    expect(breaking.map(change => change.code)).toEqual(expect.arrayContaining([
      'endpoint-removed',
      'operation-id-changed',
      'required-parameter-added',
      'request-required-field-added',
      'request-schema-changed',
      'response-removed',
      'response-schema-changed',
    ]))

    const markdown = formatMarkdown(diff)
    expect(markdown).toContain('#### Breaking Changes')
    expect(markdown).toContain('**!7** breaking')
    expect(markdown).toContain('`GET /legacy`')
    expect(markdown).toContain('Required parameter query:tenantId was added.')
  })

  it('keeps additive endpoints, responses, and optional query parameters non-breaking', () => {
    const diff = diffEndpoints(baseSpec(), additiveSpec())

    expect(diff.added.map(endpoint => `${endpoint.method} ${endpoint.path}`)).toEqual(['get /status'])
    expect(diff.modified).toHaveLength(1)
    expect(classifyBreakingChanges(diff)).toEqual([])
    expect(hasBreakingChanges(diff)).toBe(false)
    expect(formatMarkdown(diff)).not.toContain('Breaking Changes')
  })
})

function baseSpec(): Record<string, unknown> {
  return {
    openapi: '3.2.0',
    info: { title: 'Diff fixture', version: '1.0.0' },
    paths: {
      '/users': {
        get: {
          operationId: 'listUsers',
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
          ],
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['items'],
                    properties: {
                      items: { type: 'array', items: { $ref: '#/components/schemas/User' } },
                    },
                  },
                },
              },
            },
            '404': { description: 'Not found' },
          },
        },
        post: {
          operationId: 'createUser',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name'],
                  properties: {
                    name: { type: 'string' },
                    email: { type: 'string', format: 'email' },
                  },
                },
              },
            },
          },
          responses: {
            '201': { description: 'Created' },
          },
        },
      },
      '/legacy': {
        get: {
          operationId: 'getLegacy',
          responses: { '200': { description: 'OK' } },
        },
      },
    },
    components: {
      schemas: {
        User: {
          type: 'object',
          required: ['id', 'email'],
          properties: {
            id: { type: 'string' },
            email: { type: 'string', format: 'email' },
          },
        },
      },
    },
  }
}

function headSpec(): Record<string, unknown> {
  const spec = baseSpec()
  const paths = spec.paths as Record<string, Record<string, unknown>>

  delete paths['/legacy']
  paths['/status'] = {
    get: {
      operationId: 'getStatus',
      responses: { '200': { description: 'OK' } },
    },
  }

  const listUsers = paths['/users']!.get as Record<string, unknown>
  listUsers.operationId = 'searchUsers'
  listUsers.parameters = [
    { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
    { name: 'tenantId', in: 'query', required: true, schema: { type: 'string' } },
  ]
  listUsers.responses = {
    '200': {
      description: 'OK',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['items'],
            properties: {
              items: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
  }

  const createUser = paths['/users']!.post as Record<string, unknown>
  createUser.requestBody = {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['name', 'email'],
          properties: {
            name: { type: 'string' },
            email: { type: 'string', format: 'email' },
          },
        },
      },
    },
  }

  return spec
}

function additiveSpec(): Record<string, unknown> {
  const spec = baseSpec()
  const paths = spec.paths as Record<string, Record<string, unknown>>

  paths['/status'] = {
    get: {
      operationId: 'getStatus',
      responses: { '200': { description: 'OK' } },
    },
  }

  const listUsers = paths['/users']!.get as Record<string, unknown>
  listUsers.parameters = [
    { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
    { name: 'search', in: 'query', schema: { type: 'string' } },
  ]
  listUsers.responses = {
    ...(listUsers.responses as Record<string, unknown>),
    '206': { description: 'Partial content' },
  }

  return spec
}
