import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { stringifyOpenApiYaml, normalizeOpenApiDocument, upgradeOpenApiDocumentTo32 } from '../cli/lib/openapi-collect.js'

describe('openapi collect scaffold', () => {
  it('normalizes NestJS Swagger noise without changing the source version', () => {
    const normalized = normalizeOpenApiDocument({
      paths: {
        '/users/{id}': {
          get: {
            security: [{ bearer: [] }],
            tags: ['users'],
            responses: { '200': { description: '' } },
          },
        },
      },
      tags: [],
      info: { version: '1.0', contact: {}, title: 'NestJS Reference API' },
      openapi: '3.0.0',
      servers: [],
      components: {},
    }, { profile: 'nestjs-swagger' })

    expect(normalized).toEqual({
      openapi: '3.0.0',
      info: { title: 'NestJS Reference API', version: '1.0' },
      paths: {
        '/users/{id}': {
          get: {
            tags: ['users'],
            responses: { '200': { description: '' } },
            security: [{ bearer: [] }],
          },
        },
      },
      components: {},
    })
    expect(stringifyOpenApiYaml(normalized)).not.toContain('&ref_')
  })

  it('creates a derived 3.2 artifact and converts nullable schemas', () => {
    const result = upgradeOpenApiDocumentTo32({
      openapi: '3.0.0',
      info: { title: 'T', version: '1' },
      paths: {},
      components: {
        schemas: {
          MaybeName: { type: 'string', nullable: true },
          MaybeUser: { $ref: '#/components/schemas/User', nullable: true },
        },
      },
    })

    expect(result.document.openapi).toBe('3.2.0')
    expect(result.document.components).toMatchObject({
      schemas: {
        MaybeName: { type: ['string', 'null'] },
        MaybeUser: { anyOf: [{ $ref: '#/components/schemas/User' }, { type: 'null' }] },
      },
    })
    expect(result.report.conversions.map(item => item.code)).toContain('openapi/version-upgraded')
    expect(result.report.conversions.map(item => item.code)).toContain('schema/nullable-upgraded')
  })

  it('fastapi profile preserves auto-generated operationId and 422 ValidationError responses', () => {
    // FastAPI emits operationId like `read_user_users__user_id__get` and a default 422
    // ValidationError response on every operation with body/path/query validation.
    // We intentionally PRESERVE both: operationId rename = breaking change for clients,
    // and the 422 envelope is signal (not noise) that consumers may rely on.
    const normalized = normalizeOpenApiDocument({
      openapi: '3.1.0',
      info: { title: 'F', version: '1.0' },
      paths: {
        '/users/{user_id}': {
          get: {
            operationId: 'read_user_users__user_id__get',
            parameters: [{ name: 'user_id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: {
              '200': { description: 'ok' },
              '422': {
                description: 'Validation Error',
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/HTTPValidationError' } },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          HTTPValidationError: { type: 'object', properties: { detail: { type: 'array', items: { type: 'string' } } } },
        },
      },
    }, { profile: 'fastapi' })

    const op = (normalized.paths as Record<string, { get: { operationId: string; responses: Record<string, unknown> } }>)['/users/{user_id}']!.get
    expect(op.operationId).toBe('read_user_users__user_id__get')
    expect(op.responses['422']).toBeDefined()
    const schemas = (normalized.components as { schemas: Record<string, unknown> }).schemas
    expect(schemas.HTTPValidationError).toBeDefined()
  })

  it('fastapi profile drops empty info.contact / root servers / root tags', () => {
    const normalized = normalizeOpenApiDocument({
      openapi: '3.1.0',
      info: { title: 'F', version: '1.0', contact: {} },
      servers: [],
      tags: [],
      paths: { '/items': { get: { responses: { '200': { description: 'ok' } } } } },
      components: {
        schemas: {
          HTTPValidationError: { type: 'object', properties: { detail: { type: 'array', items: { type: 'string' } } } },
        },
      },
    }, { profile: 'fastapi' })

    expect(Object.keys(normalized)).toEqual(['openapi', 'info', 'paths', 'components'])
    expect(normalized.info).toEqual({ title: 'F', version: '1.0' })
  })

  it('upgrades a 3.1 input by setting the version with no nullable conversions', () => {
    const result = upgradeOpenApiDocumentTo32({
      openapi: '3.1.0',
      info: { title: 'T', version: '1' },
      paths: {},
      components: {
        schemas: {
          Tuple: { type: 'array', prefixItems: [{ type: 'string' }, { type: 'number' }] },
          NullableUnion: { type: ['string', 'null'] },
        },
      },
    })

    expect(result.document.openapi).toBe('3.2.0')
    expect(result.document.components).toMatchObject({
      schemas: {
        Tuple: { type: 'array', prefixItems: [{ type: 'string' }, { type: 'number' }] },
        NullableUnion: { type: ['string', 'null'] },
      },
    })
    expect(result.report.sourceOpenapi).toBe('3.1.0')
    expect(result.report.conversions.map(item => item.code)).toEqual(['openapi/version-upgraded'])
    expect(result.report.warnings).toEqual([])
  })

  it('is a no-op for an already 3.2 input', () => {
    const result = upgradeOpenApiDocumentTo32({
      openapi: '3.2.0',
      info: { title: 'T', version: '1' },
      paths: {},
      components: { schemas: { Name: { type: 'string' } } },
    })

    expect(result.document.openapi).toBe('3.2.0')
    expect(result.report.sourceOpenapi).toBe('3.2.0')
    expect(result.report.conversions).toEqual([])
    expect(result.report.warnings).toEqual([])
  })

  it('records a warning when a nullable $ref also has sibling keywords', () => {
    const result = upgradeOpenApiDocumentTo32({
      openapi: '3.0.0',
      info: { title: 'T', version: '1' },
      paths: {},
      components: {
        schemas: {
          Decorated: {
            $ref: '#/components/schemas/Inner',
            nullable: true,
            description: 'inherited but nullable',
          },
        },
      },
    })

    const warningCodes = result.report.warnings.map(w => w.code)
    expect(warningCodes).toContain('schema/ref-nullable-siblings')
    expect(result.document.components).toMatchObject({
      schemas: {
        Decorated: {
          description: 'inherited but nullable',
          anyOf: [{ $ref: '#/components/schemas/Inner' }, { type: 'null' }],
        },
      },
    })
  })

  it('upgrades inline nullable schemas inside paths/responses/parameters/headers', () => {
    const result = upgradeOpenApiDocumentTo32({
      openapi: '3.0.0',
      info: { title: 'T', version: '1' },
      paths: {
        '/items': {
          parameters: [
            { name: 'tag', in: 'query', schema: { type: 'string', nullable: true } },
          ],
          get: {
            parameters: [
              { name: 'limit', in: 'query', schema: { type: 'integer', nullable: true } },
            ],
            requestBody: {
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { note: { type: 'string', nullable: true } } },
                },
              },
            },
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { type: 'array', items: { type: 'string', nullable: true } },
                  },
                },
                headers: {
                  'X-Trace': { schema: { type: 'string', nullable: true } },
                },
              },
            },
            callbacks: {
              onChange: {
                '{$request.body#/url}': {
                  post: {
                    requestBody: {
                      content: {
                        'application/json': {
                          schema: { type: 'string', nullable: true },
                        },
                      },
                    },
                    responses: { '200': { description: 'ok' } },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        responses: {
          NotFound: {
            content: { 'application/json': { schema: { type: 'string', nullable: true } } },
          },
        },
        parameters: {
          MaybeId: { name: 'id', in: 'query', schema: { type: 'integer', nullable: true } },
        },
        requestBodies: {
          MaybeBody: {
            content: { 'application/json': { schema: { type: 'string', nullable: true } } },
          },
        },
        headers: {
          MaybeTrace: { schema: { type: 'string', nullable: true } },
        },
      },
    })

    const conversionPointers = result.report.conversions
      .filter(c => c.code === 'schema/nullable-upgraded')
      .map(c => c.pointer)
      .sort()

    expect(conversionPointers).toEqual([
      '#/components/headers/MaybeTrace/schema',
      '#/components/parameters/MaybeId/schema',
      '#/components/requestBodies/MaybeBody/content/application~1json/schema',
      '#/components/responses/NotFound/content/application~1json/schema',
      '#/paths/~1items/get/callbacks/onChange/{$request.body#~1url}/post/requestBody/content/application~1json/schema',
      '#/paths/~1items/get/parameters/0/schema',
      '#/paths/~1items/get/requestBody/content/application~1json/schema/properties/note',
      '#/paths/~1items/get/responses/200/content/application~1json/schema/items',
      '#/paths/~1items/get/responses/200/headers/X-Trace/schema',
      '#/paths/~1items/parameters/0/schema',
    ])

    const itemsParam = (result.document.paths as Record<string, { parameters: Array<{ schema: { type: string[] } }> }>)['/items']!.parameters[0]!
    expect(itemsParam.schema.type).toEqual(['string', 'null'])
  })

  it('survives documents that omit components and paths', () => {
    const upgrade = upgradeOpenApiDocumentTo32({
      openapi: '3.0.0',
      info: { title: 'T', version: '1' },
    })
    expect(upgrade.document.openapi).toBe('3.2.0')
    expect(upgrade.report.warnings).toEqual([])

    const normalized = normalizeOpenApiDocument({
      openapi: '3.0.0',
      info: { title: 'T', version: '1' },
    }, { profile: 'nestjs-swagger' })
    expect(Object.keys(normalized)).toEqual(['openapi', 'info'])
  })
})

// YAML aliases parse to shared objects (a recursive alias to a cycle) and
// structuredClone keeps that sharing, so normalization and upgrade receive a DAG.
const expandAliases = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

describe('normalizeOpenApiDocument on DAG-shaped input', () => {
  const responseAt = (document: Record<string, unknown>, path: string) =>
    (document.paths as Record<string, { get: { responses: Record<string, Record<string, unknown>> } }>)[path]!.get.responses['200']!

  it('normalizes every location of a node shared through YAML aliases', () => {
    const source = parseYaml(`
openapi: 3.1.0
info: &info
  version: '1'
  title: Shared
  contact: {}
x-source-info: *info
paths:
  /a:
    get:
      responses:
        '200': &ok
          description: ok
          content:
            application/json:
              schema: { type: object, title: Item }
  /b:
    get:
      responses:
        '200': *ok
  /c:
    get:
      responses:
        '200': *ok
`) as Record<string, unknown>

    const normalized = normalizeOpenApiDocument(source, { profile: 'nestjs-swagger' })

    expect(Object.keys(normalized['x-source-info'] as object)).toEqual(['title', 'version'])
    for (const path of ['/a', '/b', '/c']) {
      expect(Object.keys(responseAt(normalized, path))).toEqual(['content', 'description'])
    }
    const yaml = stringifyOpenApiYaml(normalized)
    expect(yaml).toBe(stringifyOpenApiYaml(normalizeOpenApiDocument(expandAliases(source), { profile: 'nestjs-swagger' })))
    expect(yaml).not.toContain('&ref_')
  })

  it('applies location-specific ordering to each location of a shared node', () => {
    const source = parseYaml(`
openapi: 3.1.0
info: { title: Zones, version: '1' }
paths:
  /pets: &pets
    delete: { responses: { '204': { description: gone } } }
    post: { responses: { '201': { description: made } } }
    get:
      x-tag-order: &tags [pets, animals]
      tags: *tags
      responses: { '200': { description: ok } }
components:
  pathItems:
    Pets: *pets
`) as Record<string, unknown>

    const normalized = normalizeOpenApiDocument(source)
    const pathItem = (normalized.paths as Record<string, Record<string, Record<string, unknown>>>)['/pets']!
    const componentItem = ((normalized.components as Record<string, unknown>).pathItems as Record<string, Record<string, Record<string, unknown>>>).Pets!

    // HTTP method order applies only under #/paths; tags sort only under a `tags` key.
    expect(Object.keys(pathItem)).toEqual(['get', 'post', 'delete'])
    expect(Object.keys(componentItem)).toEqual(['delete', 'get', 'post'])
    for (const operation of [pathItem.get!, componentItem.get!]) {
      expect(operation.tags).toEqual(['animals', 'pets'])
      expect(operation['x-tag-order']).toEqual(['pets', 'animals'])
    }
    expect(stringifyOpenApiYaml(normalized)).toBe(stringifyOpenApiYaml(normalizeOpenApiDocument(expandAliases(source))))
  })

  it('applies root-only noise rules to each location of a shared value', () => {
    const source = parseYaml(`
openapi: 3.1.0
info: { title: Servers, version: '1' }
servers: &none []
paths:
  /a:
    servers: *none
    get: { responses: { '200': { description: ok } } }
`) as Record<string, unknown>

    const normalized = normalizeOpenApiDocument(source, { profile: 'nestjs-swagger' })

    expect(normalized).not.toHaveProperty('servers')
    expect((normalized.paths as Record<string, Record<string, unknown>>)['/a']!.servers).toEqual([])
  })

  it('rebuilds a shared node once per location context and keeps the sharing', () => {
    // Each level holds the next one twice: depth + 1 nodes, 2^depth paths.
    const depth = 20
    let node: Record<string, unknown> = { leaf: true }
    for (let level = 0; level < depth; level++) node = { right: node, left: node }

    const normalized = normalizeOpenApiDocument({
      openapi: '3.1.0',
      info: { title: 'Deep', version: '1' },
      paths: {},
      'x-dag': node,
    })

    let current = normalized['x-dag'] as Record<string, unknown>
    for (let level = 0; level < depth; level++) {
      expect(Object.keys(current)).toEqual(['left', 'right'])
      // Identity as a boolean: a failure diff of two DAGs would print every path.
      expect(Object.is(current.left, current.right)).toBe(true)
      current = current.left as Record<string, unknown>
    }
    expect(current).toEqual({ leaf: true })
  })

  it('terminates on recursive YAML aliases and keeps the cycle in the output', () => {
    const source = parseYaml(`
openapi: 3.1.0
info: { title: Cycle, version: '1' }
paths: {}
x-node: &node
  name: root
  child:
    parent: *node
x-meta: &meta
  contact: *meta
`) as Record<string, unknown>

    const normalized = normalizeOpenApiDocument(source, { profile: 'nestjs-swagger' })

    const node = normalized['x-node'] as { child: { parent: unknown }; name: string }
    expect(Object.keys(node)).toEqual(['child', 'name'])
    expect(node.child.parent).toBe(node)
    // A cycle back-edge is never an empty collection, so it is not dropped as noise.
    const meta = normalized['x-meta'] as Record<string, unknown>
    expect(Object.keys(meta)).toEqual(['contact'])
    expect(meta.contact).toBe(meta)
  })

  it('terminates when a cycle re-enters the document root from a nested location', () => {
    const source = parseYaml(`--- &root
paths: {}
openapi: 3.1.0
info: { title: Root cycle, version: '1' }
x-self: *root
`) as Record<string, unknown>

    const normalized = normalizeOpenApiDocument(source)

    expect(Object.keys(normalized)).toEqual(['openapi', 'info', 'paths', 'x-self'])
    // Below the root the same object follows nested-location rules (plain key order).
    const nested = normalized['x-self'] as Record<string, unknown>
    expect(Object.keys(nested)).toEqual(['info', 'openapi', 'paths', 'x-self'])
    expect(nested['x-self']).toBe(nested)
  })
})

describe('upgradeOpenApiDocumentTo32 on DAG-shaped input', () => {
  const nullableConversions = (result: ReturnType<typeof upgradeOpenApiDocumentTo32>) =>
    result.report.conversions.filter(conversion => conversion.code === 'schema/nullable-upgraded').map(conversion => conversion.pointer)

  const source = parseYaml(`
openapi: 3.0.3
info: { title: Shared, version: '1' }
paths:
  /a:
    get:
      parameters:
        - &limit { name: limit, in: query, schema: { type: integer, nullable: true } }
      responses:
        '200': &ok
          description: ok
          content:
            application/json:
              schema: { type: string, nullable: true }
  /b:
    get:
      parameters: [*limit]
      responses:
        '200': *ok
`) as Record<string, unknown>

  it('reports a conversion at every location of a shared container', () => {
    const result = upgradeOpenApiDocumentTo32(source)
    const expanded = upgradeOpenApiDocumentTo32(expandAliases(source))

    expect(nullableConversions(result)).toEqual([
      '#/paths/~1a/get/parameters/0/schema',
      '#/paths/~1a/get/responses/200/content/application~1json/schema',
      '#/paths/~1b/get/parameters/0/schema',
      '#/paths/~1b/get/responses/200/content/application~1json/schema',
    ])
    expect(result.report).toEqual(expanded.report)
    expect(stringifyOpenApiYaml(result.document)).toBe(stringifyOpenApiYaml(expanded.document))
  })

  it('reports the same conversions after normalization keeps the sharing', () => {
    // `oa-gen collect` upgrades the normalized document, which shares wherever the source shared.
    expect(upgradeOpenApiDocumentTo32(normalizeOpenApiDocument(source)).report)
      .toEqual(upgradeOpenApiDocumentTo32(normalizeOpenApiDocument(expandAliases(source))).report)
  })

  it('leaves the input document unchanged', () => {
    const before = stringifyOpenApiYaml(source)
    upgradeOpenApiDocumentTo32(source)
    expect(stringifyOpenApiYaml(source)).toBe(before)
  })
})
