import { describe, it, expect } from 'vitest'
import { parseDocument } from '../parse.js'
import { resolveServerUrl } from '../query.js'
import type { OasDocument } from '../oas32-types.js'

function doc(overrides: Partial<OasDocument> = {}): OasDocument {
  return {
    openapi: '3.2.0',
    info: { title: 'T', version: '0' },
    paths: {},
    ...overrides,
  } as OasDocument
}

describe('Server Object', () => {
  it('single server URL extraction', () => {
    const result = parseDocument(doc({
      servers: [{ url: 'https://api.example.com' }],
    }))
    expect(result.servers).toHaveLength(1)
    expect(result.servers[0]!.url).toBe('https://api.example.com')
  })

  it('multiple servers', () => {
    const result = parseDocument(doc({
      servers: [
        { url: 'https://api.example.com' },
        { url: 'https://staging.example.com' },
        { url: 'https://localhost:3000' },
      ],
    }))
    expect(result.servers).toHaveLength(3)
    expect(result.servers.map(s => s.url)).toEqual([
      'https://api.example.com',
      'https://staging.example.com',
      'https://localhost:3000',
    ])
  })

  it('server with variables (default and enum)', () => {
    const result = parseDocument(doc({
      servers: [{
        url: 'https://{env}.example.com:{port}',
        variables: {
          env: { default: 'production', enum: ['production', 'staging', 'dev'] },
          port: { default: '443' },
        },
      }],
    }))
    const server = result.servers[0]!
    expect(server.url).toBe('https://{env}.example.com:{port}')
    expect(server.variables).toBeDefined()
    expect(server.variables!['env']!.default).toBe('production')
    expect(server.variables!['env']!.enum).toEqual(['production', 'staging', 'dev'])
    expect(server.variables!['port']!.default).toBe('443')
    expect(server.variables!['port']!.enum).toBeUndefined()
  })

  it('global servers inherited by operations (when operation has no servers)', () => {
    const result = parseDocument(doc({
      servers: [{ url: 'https://api.example.com' }],
      paths: {
        '/users': {
          get: { responses: { '200': { description: 'OK' } } },
        },
      },
    }))
    const op = result.operations[0]!
    expect(op.servers).toHaveLength(1)
    expect(op.servers[0]!.url).toBe('https://api.example.com')
  })

  it('path-level servers override global', () => {
    const result = parseDocument(doc({
      servers: [{ url: 'https://global.example.com' }],
      paths: {
        '/users': {
          servers: [{ url: 'https://path.example.com' }],
          get: { responses: { '200': { description: 'OK' } } },
        },
      },
    }))
    const op = result.operations[0]!
    expect(op.servers).toHaveLength(1)
    expect(op.servers[0]!.url).toBe('https://path.example.com')
  })

  it('operation-level servers override path-level', () => {
    const result = parseDocument(doc({
      servers: [{ url: 'https://global.example.com' }],
      paths: {
        '/users': {
          servers: [{ url: 'https://path.example.com' }],
          get: {
            servers: [{ url: 'https://operation.example.com' }],
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }))
    const op = result.operations[0]!
    expect(op.servers).toHaveLength(1)
    expect(op.servers[0]!.url).toBe('https://operation.example.com')
  })

  it('server name field (3.2 new) preserved', () => {
    const result = parseDocument(doc({
      servers: [{ url: 'https://api.example.com', name: 'production' }],
    }))
    expect(result.servers[0]!.name).toBe('production')
  })

  it('no servers → empty array', () => {
    const result = parseDocument(doc())
    expect(result.servers).toEqual([])
  })

  it('같은 변수가 URL에 2번 이상 쓰일 때 모두 치환', () => {
    const server = { url: 'https://{env}.example.com/{env}/v1', variables: { env: { default: 'staging' } } }
    expect(resolveServerUrl(server)).toBe('https://staging.example.com/staging/v1')
  })
})
