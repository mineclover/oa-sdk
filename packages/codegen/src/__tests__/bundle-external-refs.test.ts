import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { stringify as stringifyYaml } from 'yaml'
import { resolvePointer } from '@oa-sdk/parser'
import { bundleExternalRefs } from '../cli/lib/bundle-external-refs.js'

const USER = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string' }, address: { $ref: '#/Address' } },
}
const ADDRESS = { type: 'object', properties: { city: { type: 'string' } } }

function jsonResponse(schema: unknown): Record<string, unknown> {
  return { description: 'OK', content: { 'application/json': { schema } } }
}

/** Every `$ref` value in `value`. */
function refsIn(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(refsIn)
  if (value === null || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, child]) => (key === '$ref' && typeof child === 'string' ? [child] : refsIn(child)))
}

describe('bundleExternalRefs', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-bundle-external-refs-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const write = (file: string, content: unknown) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    fs.writeFileSync(path.join(dir, file), file.endsWith('.json') ? JSON.stringify(content) : stringifyYaml(content))
  }
  const entry = (document: Record<string, unknown>, file = 'api/openapi.yaml') => {
    write(file, document)
    return bundleExternalRefs(document, path.join(dir, file))
  }

  it('copies what a ref to another file names, resolving each ref against the file it is written in', () => {
    write('api/paths/users.yaml', { get: { operationId: 'listUsers', responses: { '200': jsonResponse({ $ref: '../schemas.json#/User' }) } } })
    write('api/schemas.json', { User: USER, Address: ADDRESS })
    const document = {
      openapi: '3.2.0',
      info: { title: 'Users', version: '1.0.0' },
      paths: { '/users': { $ref: './paths/users.yaml' } },
    }
    const before = structuredClone(document)

    const bundled = entry(document)

    expect(bundled.paths).toEqual({
      '/users': {
        get: {
          operationId: 'listUsers',
          responses: { '200': jsonResponse({ ...USER, properties: { ...USER.properties, address: ADDRESS } }) },
        },
      },
    })
    expect(refsIn(bundled)).toEqual([])
    expect(document).toEqual(before)
  })

  it('refers to the components entry that is just a ref to the same target, which holds the copy', () => {
    write('api/schemas/User.yaml', { type: 'object', properties: { manager: { $ref: './User.yaml' }, tag: { $ref: '../openapi.yaml#/components/schemas/Tag' } } })
    const bundled = entry({
      openapi: '3.2.0',
      info: { title: 'Users', version: '1.0.0' },
      paths: { '/users': { get: { responses: { '200': jsonResponse({ type: 'array', items: { $ref: './schemas/User.yaml' } }) } } } },
      components: { schemas: { User: { $ref: './schemas/User.yaml' }, Tag: { type: 'string' } } },
    })

    expect(bundled.paths).toEqual({
      '/users': { get: { responses: { '200': jsonResponse({ type: 'array', items: { $ref: '#/components/schemas/User' } }) } } },
    })
    // The recursion and the ref back into the entry document are local refs.
    expect(bundled.components).toEqual({
      schemas: {
        User: { type: 'object', properties: { manager: { $ref: '#/components/schemas/User' }, tag: { $ref: '#/components/schemas/Tag' } } },
        Tag: { type: 'string' },
      },
    })
  })

  it('refers recursion to the copy being made when the target has no components entry', () => {
    write('api/tree.yaml', { Tree: { type: 'object', properties: { children: { type: 'array', items: { $ref: '#/Tree' } } } } })
    const bundled = entry({
      openapi: '3.2.0',
      info: { title: 'Trees', version: '1.0.0' },
      paths: { '/trees/{id}': { get: { responses: { '200': jsonResponse({ $ref: './tree.yaml#/Tree' }) } } } },
    })

    const schemaPointer = '#/paths/~1trees~1{id}/get/responses/200/content/application~1json/schema'
    const schema = resolvePointer(schemaPointer, bundled) as { properties: { children: { items: { $ref: string } } } }
    expect(schema.properties.children.items).toEqual({ $ref: schemaPointer })
    expect(refsIn(bundled)).toEqual([schemaPointer])
  })

  it('keeps the meaning of the keywords next to a schema ref', () => {
    write('api/schemas.yaml', { User: { type: 'object', description: 'A user', required: ['id'], allOf: [{ required: ['name'] }] } })
    const user = { type: 'object', description: 'A user', required: ['id'], allOf: [{ required: ['name'] }] }
    const schemas = (bundled: Record<string, unknown>) => (bundled.components as { schemas: Record<string, unknown> }).schemas
    const document = (openapi: string) => ({
      openapi,
      info: { title: 'Users', version: '1.0.0' },
      paths: {},
      components: {
        schemas: {
          // Annotations of a reference override those of its target ...
          Annotated: { $ref: './schemas.yaml#/User', description: 'The author', 'x-internal': true },
          // ... and assertions apply with it, as `allOf` keeps them.
          Constrained: { $ref: './schemas.yaml#/User', required: ['email'], allOf: [{ minProperties: 1 }] },
        },
      },
    })

    expect(schemas(entry(document('3.2.0')))).toEqual({
      Annotated: { ...user, description: 'The author', 'x-internal': true },
      Constrained: { required: ['email'], allOf: [{ minProperties: 1 }, user] },
    })
    // OpenAPI 3.0 ignores the fields next to a ref.
    expect(schemas(entry(document('3.0.3'), 'api/openapi-30.yaml'))).toEqual({ Annotated: user, Constrained: user })
  })

  it('sets the fields next to a Path Item ref, which are fields of the path item, on the copy in every version', () => {
    const operations = {
      summary: 'A user',
      get: { operationId: 'getUser', responses: { '200': jsonResponse({ $ref: '../schemas.json#/User' }) } },
      delete: { operationId: 'deleteUser', responses: { '204': { description: 'Deleted' } } },
    }
    write('api/paths/user.yaml', operations)
    write('api/schemas.json', { User: USER, Address: ADDRESS })
    const user = { ...USER, properties: { ...USER.properties, address: ADDRESS } }
    const document = (version: Record<string, string>, id: Record<string, unknown>) => ({
      ...version,
      info: { title: 'Users', version: '1.0.0' },
      paths: { '/users/{id}': { $ref: './paths/user.yaml', summary: 'One user', parameters: [id] } },
    })

    for (const [version, id] of [
      [{ openapi: '3.2.0' }, { name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      [{ openapi: '3.0.3' }, { name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      [{ swagger: '2.0' }, { name: 'id', in: 'path', required: true, type: 'string' }],
    ] as const) {
      // On a conflict (summary) the fields next to the ref win, as in the parser's dereference.
      expect(entry(document(version, id)).paths, JSON.stringify(version)).toEqual({
        '/users/{id}': {
          ...operations,
          get: { ...operations.get, responses: { '200': jsonResponse(user) } },
          summary: 'One user',
          parameters: [id],
        },
      })
    }
  })

  it('keeps the summary and description next to a Reference Object where its target has that field, and drops its other fields', () => {
    const limit = { name: 'limit', in: 'query', description: 'How many', schema: { type: 'integer' } }
    const ok = { description: 'OK' }
    const hook = { '{$request.body#/url}': { post: { responses: { '200': ok } } } }
    write('api/components.yaml', { Limit: limit, Ok: ok, Hook: hook, Retry: { description: 'Seconds to wait', schema: { type: 'integer' } } })
    const document = (openapi: string) => ({
      openapi,
      info: { title: 'Items', version: '1.0.0' },
      paths: {
        '/items': {
          get: {
            parameters: [{ $ref: './components.yaml#/Limit', required: true, summary: 'Limit', description: 'Page size' }],
            responses: {
              '200': { $ref: './components.yaml#/Ok', summary: 'Items', description: 'The items', 'x-internal': true },
              '503': {
                description: 'Unavailable',
                headers: { 'Retry-After': { $ref: './components.yaml#/Retry', required: true } },
              },
            },
            callbacks: { onItem: { $ref: './components.yaml#/Hook', description: 'Called per item' } },
          },
        },
      },
    })
    const operation = (openapi: string) => (entry(document(openapi)).paths as Record<string, { get: unknown }>)['/items']!.get
    const unavailable = { description: 'Unavailable', headers: { 'Retry-After': { description: 'Seconds to wait', schema: { type: 'integer' } } } }

    // OpenAPI 3.1: a parameter and a response have a description (not a summary), a callback neither.
    expect(operation('3.1.0')).toEqual({
      parameters: [{ ...limit, description: 'Page size' }],
      responses: { '200': { description: 'The items' }, '503': unavailable },
      callbacks: { onItem: hook },
    })
    // OpenAPI 3.2 gave the Response Object a summary.
    expect((operation('3.2.0') as { responses: unknown }).responses).toEqual({
      '200': { summary: 'Items', description: 'The items' },
      '503': unavailable,
    })
    // OpenAPI 3.0 ignores every field next to a Reference Object.
    expect(operation('3.0.3')).toEqual({ parameters: [limit], responses: { '200': ok, '503': unavailable }, callbacks: { onItem: hook } })
  })

  it('refers a Path Item ref to the components entry that holds its copy, with the fields next to it as written', () => {
    const operations = { get: { operationId: 'listUsers', responses: { '200': { description: 'OK' } } } }
    write('api/paths/users.yaml', operations)
    const bundled = entry({
      openapi: '3.2.0',
      info: { title: 'Users', version: '1.0.0' },
      paths: { '/users': { $ref: './paths/users.yaml', description: 'All users' } },
      components: { pathItems: { Users: { $ref: './paths/users.yaml' } } },
    })

    expect(bundled.paths).toEqual({ '/users': { $ref: '#/components/pathItems/Users', description: 'All users' } })
    expect(bundled.components).toEqual({ pathItems: { Users: operations } })
  })

  it('sets the fields next to a ref outside the OpenAPI objects on the copy, as the parser\'s dereference does', () => {
    write('api/samples.yaml', { User: { id: 'u1' } })
    const bundled = entry({
      openapi: '3.0.3',
      info: { title: 'Users', version: '1.0.0' },
      paths: {},
      'x-samples': { ada: { $ref: './samples.yaml#/User', name: 'Ada' } },
    })

    expect(bundled['x-samples']).toEqual({ ada: { id: 'u1', name: 'Ada' } })
  })

  it('keeps refs within the entry document, plain-name fragments and refs to URLs as written', () => {
    const document = {
      openapi: '3.2.0',
      info: { title: 'Users', version: '1.0.0' },
      paths: {},
      components: {
        schemas: {
          Local: { $ref: '#/components/schemas/Other' },
          Self: { $ref: './openapi.yaml#/components/schemas/Other' },
          Anchored: { $ref: '#user' },
          Remote: { $ref: 'https://example.com/schemas/user.json' },
          Other: { $anchor: 'user', type: 'string' },
        },
      },
    }

    expect(entry(document).components).toEqual({
      schemas: { ...document.components.schemas, Self: { $ref: '#/components/schemas/Other' } },
    })
  })

  it('fails, naming the ref and the file it is written in, on a target it cannot read', () => {
    write('api/schemas.yaml', { User: USER })
    const document = (ref: string) => ({
      openapi: '3.2.0',
      info: { title: 'Users', version: '1.0.0' },
      paths: { '/users': { get: { responses: { '200': jsonResponse({ $ref: ref }) } } } },
    })
    const at = '#/paths/~1users/get/responses/200/content/application~1json/schema'

    expect(() => entry(document('./missing.yaml#/User'))).toThrow(
      new RegExp(`^\\$ref "\\./missing\\.yaml#/User" in openapi\\.yaml \\(at ${at.replace(/[~/]/g, '\\$&')} of the bundled document\\): cannot read missing\\.yaml: `),
    )
    expect(() => entry(document('./schemas.yaml#/Order'))).toThrow(
      `$ref "./schemas.yaml#/Order" in openapi.yaml (at ${at} of the bundled document): schemas.yaml has nothing at #/Order`,
    )
    expect(() => entry(document('./schemas.yaml#User'))).toThrow(
      `$ref "./schemas.yaml#User" in openapi.yaml (at ${at} of the bundled document): "#User" is not a JSON pointer`,
    )
  })
})
