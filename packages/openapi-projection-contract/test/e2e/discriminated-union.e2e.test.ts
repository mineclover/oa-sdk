import { describe, expect, it } from 'vitest'
import {
  attachOpenApiProjectionExtensions,
  getOpenApiProjectionProfileSemantics,
  isOpenApiProjectionProfile,
  OPENAPI_PROJECTION_PROFILE_EXTENSION,
  OPENAPI_PROJECTION_VERSION_HASH_EXTENSION,
  OPENAPI_SURFACE_ANCHOR_EXTENSION,
  OPENAPI_SURFACE_FINGERPRINT_EXTENSION,
  projectDiscriminatedUnion,
  validateOpenApiProjection,
} from '../../src/index.js'
import type {
  DiscriminatedUnionProjectionOptions,
  DiscriminatedUnionProjectionResult,
  OpenApiProjectionResult,
} from '../../src/index.js'

describe('E2E Discriminated Union Projection (Tiers 1-4)', () => {
  // =========================================================================
  // TIER 1: FEATURE COVERAGE (>=5 tests per feature)
  // =========================================================================

  describe('Tier 1: Feature Coverage', () => {
    describe('F1: projectDiscriminatedUnion Core API', () => {
      it('F1-1: projects basic two-variant polymorphic schema into discriminator and oneOf', () => {
        const options: DiscriminatedUnionProjectionOptions = {
          discriminatorProperty: 'kind',
          unionSchemaId: 'Pet',
          variants: {
            cat: {
              type: 'object',
              required: ['kind', 'meowVolume'],
              properties: {
                kind: { type: 'string', const: 'cat' },
                meowVolume: { type: 'number' },
              },
            },
            dog: {
              type: 'object',
              required: ['kind', 'barkPitch'],
              properties: {
                kind: { type: 'string', const: 'dog' },
                barkPitch: { type: 'string' },
              },
            },
          },
        }

        const result = projectDiscriminatedUnion(options)

        expect(result).toBeDefined()
        expect(result.unionSchema).toBeDefined()
        expect(result.unionSchema.type).toBe('object')
        expect((result.unionSchema.discriminator as any).propertyName).toBe('kind')
        expect((result.unionSchema.discriminator as any).mapping).toEqual({
          cat: '#/components/schemas/PetCat',
          dog: '#/components/schemas/PetDog',
        })
        expect(result.unionSchema.oneOf).toEqual([
          { $ref: '#/components/schemas/PetCat' },
          { $ref: '#/components/schemas/PetDog' },
        ])
        expect(result.variantSchemas).toHaveProperty('PetCat')
        expect(result.variantSchemas).toHaveProperty('PetDog')
      })

      it('F1-2: propagates description and metadata to root union schema', () => {
        const options: DiscriminatedUnionProjectionOptions = {
          discriminatorProperty: 'type',
          unionSchemaId: 'NotificationEvent',
          description: 'Polymorphic notification event payload stream',
          variants: {
            email: {
              type: 'object',
              properties: { type: { type: 'string', const: 'email' }, to: { type: 'string' } },
            },
            sms: {
              type: 'object',
              properties: { type: { type: 'string', const: 'sms' }, phoneNumber: { type: 'string' } },
            },
          },
        }

        const result = projectDiscriminatedUnion(options)
        expect(result.unionSchema.description).toBe('Polymorphic notification event payload stream')
      })

      it('F1-3: defaults to component-bundle profile semantics with empty paths', () => {
        const options: DiscriminatedUnionProjectionOptions = {
          discriminatorProperty: 'status',
          unionSchemaId: 'JobStatus',
          variants: {
            queued: { type: 'object', properties: { status: { const: 'queued' } } },
            running: { type: 'object', properties: { status: { const: 'running' } } },
            finished: { type: 'object', properties: { status: { const: 'finished' } } },
          },
        }

        const result = projectDiscriminatedUnion(options)
        expect(result.variantSchemas).toBeDefined()
        expect(Object.keys(result.variantSchemas)).toHaveLength(3)
        expect(result.paths).toBeUndefined()
      })

      it('F1-4: produces schemas compatible with OpenAPI component bundle validation', () => {
        const options: DiscriminatedUnionProjectionOptions = {
          discriminatorProperty: 'shape',
          unionSchemaId: 'Geometry',
          profile: 'component-bundle',
          variants: {
            circle: {
              type: 'object',
              properties: { shape: { const: 'circle' }, radius: { type: 'number' } },
            },
            square: {
              type: 'object',
              properties: { shape: { const: 'square' }, side: { type: 'number' } },
            },
          },
        }

        const result = projectDiscriminatedUnion(options)
        const projectionDoc: OpenApiProjectionResult<Record<string, unknown>> = {
          profile: 'component-bundle',
          projection: {
            openapi: '3.1.0',
            info: { title: 'Geometry Bundle', version: '1.0.0' },
            components: {
              schemas: {
                Geometry: result.unionSchema,
                ...result.variantSchemas,
              },
            },
          },
          refs: [],
          diagnostics: [],
          sources: {},
          versionHash: 'sha256:geometry-bundle-hash',
        }

        const validation = validateOpenApiProjection(projectionDoc)
        expect(validation.valid).toBe(true)
      })

      it('F1-5: projects multi-variant union with 4+ variants correctly', () => {
        const options: DiscriminatedUnionProjectionOptions = {
          discriminatorProperty: 'protocol',
          unionSchemaId: 'NetworkPacket',
          variants: {
            tcp: { type: 'object', properties: { protocol: { const: 'tcp' }, port: { type: 'number' } } },
            udp: { type: 'object', properties: { protocol: { const: 'udp' }, port: { type: 'number' } } },
            icmp: { type: 'object', properties: { protocol: { const: 'icmp' }, code: { type: 'number' } } },
            http: { type: 'object', properties: { protocol: { const: 'http' }, url: { type: 'string' } } },
          },
        }

        const result = projectDiscriminatedUnion(options)
        expect((result.unionSchema.oneOf as unknown[])).toHaveLength(4)
        expect(Object.keys(result.variantSchemas)).toHaveLength(4)
      })
    })

    describe('F2: Single-Stream Multiplexed RPC Projection', () => {
      it('F2-1: projects Chrome Native Messaging 4-byte RPC methods into discriminator mappings', () => {
        const options: DiscriminatedUnionProjectionOptions = {
          discriminatorProperty: 'method',
          unionSchemaId: 'NativeRpcRequest',
          profile: 'operation-contract',
          pathPrefix: '/rpc',
          variants: {
            'session.hello': {
              type: 'object',
              properties: {
                id: { type: 'string' },
                method: { type: 'string', const: 'session.hello' },
                params: { type: 'object', properties: { clientVersion: { type: 'string' } } },
              },
            },
            'workspace.snapshot.save': {
              type: 'object',
              properties: {
                id: { type: 'string' },
                method: { type: 'string', const: 'workspace.snapshot.save' },
                params: { type: 'object', properties: { snapshotId: { type: 'string' } } },
              },
            },
            'materialize.css': {
              type: 'object',
              properties: {
                id: { type: 'string' },
                method: { type: 'string', const: 'materialize.css' },
                params: { type: 'object', properties: { themeId: { type: 'string' } } },
              },
            },
            'lease.acquire': {
              type: 'object',
              properties: {
                id: { type: 'string' },
                method: { type: 'string', const: 'lease.acquire' },
                params: { type: 'object', properties: { resourceId: { type: 'string' } } },
              },
            },
          },
        }

        const result = projectDiscriminatedUnion(options)

        expect(result.paths).toBeDefined()
        expect(result.paths).toHaveProperty('/rpc/session.hello')
        expect(result.paths).toHaveProperty('/rpc/workspace.snapshot.save')
        expect(result.paths).toHaveProperty('/rpc/materialize.css')
        expect(result.paths).toHaveProperty('/rpc/lease.acquire')
      })

      it('F2-2: generates valid operation objects under /rpc/{method} with post method and responses', () => {
        const options: DiscriminatedUnionProjectionOptions = {
          discriminatorProperty: 'method',
          unionSchemaId: 'RpcEnvelope',
          profile: 'operation-contract',
          pathPrefix: '/rpc',
          variants: {
            'ping': {
              type: 'object',
              properties: { method: { const: 'ping' }, id: { type: 'string' } },
            },
          },
        }

        const result = projectDiscriminatedUnion(options)
        const pingPath = (result.paths as Record<string, any>)['/rpc/ping']
        expect(pingPath).toBeDefined()
        expect(pingPath.post).toBeDefined()
        expect(pingPath.post.responses).toBeDefined()
        expect(pingPath.post.responses['200']).toBeDefined()
      })

      it('F2-3: attaches requestBody schema referencing projected variant schema', () => {
        const options: DiscriminatedUnionProjectionOptions = {
          discriminatorProperty: 'action',
          unionSchemaId: 'ActionEnvelope',
          profile: 'operation-contract',
          pathPrefix: '/api/v1',
          variants: {
            'create': { type: 'object', properties: { action: { const: 'create' }, name: { type: 'string' } } },
            'delete': { type: 'object', properties: { action: { const: 'delete' }, id: { type: 'string' } } },
          },
        }

        const result = projectDiscriminatedUnion(options)
        const createPath = (result.paths as Record<string, any>)['/api/v1/create']
        expect(createPath.post.requestBody.content['application/json'].schema).toEqual({
          $ref: '#/components/schemas/ActionEnvelopeCreate',
        })
      })

      it('F2-4: creates clean operationId identifiers for RPC operations', () => {
        const options: DiscriminatedUnionProjectionOptions = {
          discriminatorProperty: 'method',
          unionSchemaId: 'DevLinkRpc',
          profile: 'operation-contract',
          pathPrefix: '/rpc',
          variants: {
            'workspace.open': { type: 'object', properties: { method: { const: 'workspace.open' } } },
          },
        }

        const result = projectDiscriminatedUnion(options)
        const op = (result.paths as Record<string, any>)['/rpc/workspace.open'].post
        expect(op.operationId).toBeDefined()
        expect(typeof op.operationId).toBe('string')
      })

      it('F2-5: operation contract projection satisfies validateOpenApiProjection', () => {
        const options: DiscriminatedUnionProjectionOptions = {
          discriminatorProperty: 'method',
          unionSchemaId: 'NativeRpcRequest',
          profile: 'operation-contract',
          pathPrefix: '/rpc',
          variants: {
            'session.hello': {
              type: 'object',
              properties: { method: { const: 'session.hello' } },
            },
          },
        }

        const result = projectDiscriminatedUnion(options)
        const projectionDoc: OpenApiProjectionResult<Record<string, unknown>> = {
          profile: 'operation-contract',
          projection: {
            openapi: '3.1.0',
            info: { title: 'Native RPC Contract', version: '1.0.0' },
            paths: result.paths,
            components: {
              schemas: {
                NativeRpcRequest: result.unionSchema,
                ...result.variantSchemas,
              },
            },
          },
          refs: [],
          diagnostics: [],
          sources: {},
          versionHash: 'sha256:native-rpc-contract-hash',
        }

        const validation = validateOpenApiProjection(projectionDoc)
        expect(validation.valid).toBe(true)
      })
    })

    describe('F3: MCP Stdio Protocol Projection', () => {
      it('F3-1: projects Model Context Protocol stdio tools/list operation', () => {
        const options: DiscriminatedUnionProjectionOptions = {
          discriminatorProperty: 'method',
          unionSchemaId: 'McpRequest',
          profile: 'operation-contract',
          pathPrefix: '/mcp',
          variants: {
            'tools/list': {
              type: 'object',
              properties: {
                jsonrpc: { type: 'string', const: '2.0' },
                id: { type: 'string' },
                method: { type: 'string', const: 'tools/list' },
                params: { type: 'object', properties: { cursor: { type: 'string' } } },
              },
            },
          },
        }

        const result = projectDiscriminatedUnion(options)
        expect(result.paths).toHaveProperty('/mcp/tools/list')
        expect((result.unionSchema.discriminator as any).mapping['tools/list']).toBe('#/components/schemas/McpRequestToolsList')
      })

      it('F3-2: projects MCP tools/call with dynamic arguments parameter object', () => {
        const options: DiscriminatedUnionProjectionOptions = {
          discriminatorProperty: 'method',
          unionSchemaId: 'McpRequest',
          profile: 'operation-contract',
          pathPrefix: '/mcp',
          variants: {
            'tools/call': {
              type: 'object',
              required: ['method', 'params'],
              properties: {
                method: { const: 'tools/call' },
                params: {
                  type: 'object',
                  required: ['name'],
                  properties: { name: { type: 'string' }, arguments: { type: 'object' } },
                },
              },
            },
          },
        }

        const result = projectDiscriminatedUnion(options)
        expect(result.variantSchemas).toHaveProperty('McpRequestToolsCall')
        expect(result.paths).toHaveProperty('/mcp/tools/call')
      })

      it('F3-3: projects MCP resources/read and prompts/get operations simultaneously', () => {
        const options: DiscriminatedUnionProjectionOptions = {
          discriminatorProperty: 'method',
          unionSchemaId: 'McpProtocol',
          profile: 'operation-contract',
          pathPrefix: '/mcp',
          variants: {
            'resources/read': {
              type: 'object',
              properties: { method: { const: 'resources/read' }, params: { properties: { uri: { type: 'string' } } } },
            },
            'prompts/get': {
              type: 'object',
              properties: { method: { const: 'prompts/get' }, params: { properties: { name: { type: 'string' } } } },
            },
          },
        }

        const result = projectDiscriminatedUnion(options)
        expect(result.paths).toHaveProperty('/mcp/resources/read')
        expect(result.paths).toHaveProperty('/mcp/prompts/get')
      })

      it('F3-4: projects MCP JSON-RPC 2.0 error responses mapping to 422/400 status codes', () => {
        const options: DiscriminatedUnionProjectionOptions = {
          discriminatorProperty: 'method',
          unionSchemaId: 'McpRequest',
          profile: 'operation-contract',
          pathPrefix: '/mcp',
          variants: {
            'sampling/createMessage': {
              type: 'object',
              properties: { method: { const: 'sampling/createMessage' } },
            },
          },
        }

        const result = projectDiscriminatedUnion(options)
        const op = (result.paths as Record<string, any>)['/mcp/sampling/createMessage'].post
        expect(op.responses['200']).toBeDefined()
        expect(op.responses['422']).toBeDefined()
      })

      it('F3-5: handles MCP notification methods without response expectation', () => {
        const options: DiscriminatedUnionProjectionOptions = {
          discriminatorProperty: 'method',
          unionSchemaId: 'McpNotification',
          profile: 'operation-contract',
          pathPrefix: '/mcp/notifications',
          variants: {
            'notifications/progress': {
              type: 'object',
              properties: { method: { const: 'notifications/progress' }, params: { properties: { progressToken: { type: 'string' } } } },
            },
          },
        }

        const result = projectDiscriminatedUnion(options)
        expect(result.paths).toHaveProperty('/mcp/notifications/notifications/progress')
      })
    })

    describe('F4: Projection Profile Integration', () => {
      it('F4-1: integrates with attachOpenApiProjectionExtensions', () => {
        const options: DiscriminatedUnionProjectionOptions = {
          discriminatorProperty: 'type',
          unionSchemaId: 'UiWidget',
          profile: 'component-bundle',
          variants: {
            button: { type: 'object', properties: { type: { const: 'button' }, label: { type: 'string' } } },
          },
        }

        const result = projectDiscriminatedUnion(options)
        const projectionEnvelope: OpenApiProjectionResult<Record<string, unknown>> = {
          profile: 'component-bundle',
          projection: {
            openapi: '3.1.0',
            info: { title: 'Widgets', version: '1.0.0' },
            components: {
              schemas: {
                UiWidget: result.unionSchema,
                ...result.variantSchemas,
              },
            },
          },
          refs: [],
          diagnostics: [],
          sources: {},
          versionHash: 'sha256:ui-widget-hash',
        }

        const attached = attachOpenApiProjectionExtensions(projectionEnvelope)
        expect(attached[OPENAPI_PROJECTION_PROFILE_EXTENSION]).toBe('component-bundle')
        expect(attached[OPENAPI_PROJECTION_VERSION_HASH_EXTENSION]).toBe('sha256:ui-widget-hash')
      })

      it('F4-2: validates profile semantics for component-bundle vs operation-contract', () => {
        const bundleSemantics = getOpenApiProjectionProfileSemantics('component-bundle')
        expect(bundleSemantics.paths.rule).toBe('may-be-empty')
        expect(bundleSemantics.components.schemas).toBe('required')

        const opSemantics = getOpenApiProjectionProfileSemantics('operation-contract')
        expect(opSemantics.paths.rule).toBe('requires-operation')
      })

      it('F4-3: validates isOpenApiProjectionProfile predicate', () => {
        expect(isOpenApiProjectionProfile('component-bundle')).toBe(true)
        expect(isOpenApiProjectionProfile('operation-contract')).toBe(true)
        expect(isOpenApiProjectionProfile('invalid-profile')).toBe(false)
      })

      it('F4-4: handles custom discriminator property names (kind, eventType, _tag)', () => {
        const options: DiscriminatedUnionProjectionOptions = {
          discriminatorProperty: '_tag',
          unionSchemaId: 'TaggedUnion',
          variants: {
            Alpha: { type: 'object', properties: { _tag: { const: 'Alpha' } } },
            Beta: { type: 'object', properties: { _tag: { const: 'Beta' } } },
          },
        }

        const result = projectDiscriminatedUnion(options)
        expect((result.unionSchema.discriminator as any).propertyName).toBe('_tag')
      })

      it('F4-5: validates resulting schema document without warnings or errors', () => {
        const options: DiscriminatedUnionProjectionOptions = {
          discriminatorProperty: 'mode',
          unionSchemaId: 'ExecutionMode',
          variants: {
            dryRun: { type: 'object', properties: { mode: { const: 'dryRun' } } },
            live: { type: 'object', properties: { mode: { const: 'live' } } },
          },
        }

        const result = projectDiscriminatedUnion(options)
        const envelope: OpenApiProjectionResult<Record<string, unknown>> = {
          profile: 'component-bundle',
          projection: {
            openapi: '3.1.0',
            info: { title: 'Execution Mode Spec', version: '2.0.0' },
            components: {
              schemas: {
                ExecutionMode: result.unionSchema,
                ...result.variantSchemas,
              },
            },
          },
          refs: [],
          diagnostics: [],
          sources: {},
          versionHash: 'sha256:exec-mode-hash',
        }

        const validation = validateOpenApiProjection(envelope)
        expect(validation.valid).toBe(true)
        expect(validation.diagnostics.filter(d => d.severity === 'error')).toHaveLength(0)
      })
    })

    describe('F5: zod-to-schema Discriminated Union Emission', () => {
      it('F5-1: correctly associates Zod / JSON object schemas with discriminator const values', () => {
        const variantA = {
          type: 'object',
          required: ['discriminator', 'dataA'],
          properties: {
            discriminator: { type: 'string', const: 'valA' },
            dataA: { type: 'string' },
          },
        }
        const variantB = {
          type: 'object',
          required: ['discriminator', 'dataB'],
          properties: {
            discriminator: { type: 'string', const: 'valB' },
            dataB: { type: 'number' },
          },
        }

        const result = projectDiscriminatedUnion({
          discriminatorProperty: 'discriminator',
          unionSchemaId: 'MyUnion',
          variants: { valA: variantA, valB: variantB },
        })

        expect((result.unionSchema.discriminator as any).mapping).toEqual({
          valA: '#/components/schemas/MyUnionValA',
          valB: '#/components/schemas/MyUnionValB',
        })
      })

      it('F5-2: preserves nested property constraints across variant schemas', () => {
        const variant = {
          type: 'object',
          required: ['type', 'count'],
          properties: {
            type: { type: 'string', const: 'counter' },
            count: { type: 'integer', minimum: 0, maximum: 100 },
          },
        }

        const result = projectDiscriminatedUnion({
          discriminatorProperty: 'type',
          unionSchemaId: 'State',
          variants: { counter: variant },
        })

        const emittedVariant = result.variantSchemas.StateCounter
        expect((emittedVariant.properties as any).count.minimum).toBe(0)
        expect((emittedVariant.properties as any).count.maximum).toBe(100)
      })

      it('F5-3: emits required array including discriminator property on all variants', () => {
        const result = projectDiscriminatedUnion({
          discriminatorProperty: 'kind',
          unionSchemaId: 'Item',
          variants: {
            book: { type: 'object', properties: { kind: { const: 'book' }, isbn: { type: 'string' } } },
          },
        })

        expect(result.unionSchema.required).toContain('kind')
      })

      it('F5-4: handles union schemas with string enum discriminator values', () => {
        const result = projectDiscriminatedUnion({
          discriminatorProperty: 'format',
          unionSchemaId: 'OutputFormat',
          variants: {
            json: { type: 'object', properties: { format: { enum: ['json'] } } },
            yaml: { type: 'object', properties: { format: { enum: ['yaml'] } } },
          },
        })

        expect((result.unionSchema.discriminator as any).mapping.json).toBe('#/components/schemas/OutputFormatJson')
        expect((result.unionSchema.discriminator as any).mapping.yaml).toBe('#/components/schemas/OutputFormatYaml')
      })

      it('F5-5: emits canonical $ref targets adhering to OpenAPI 3.1 JSON Pointer syntax', () => {
        const result = projectDiscriminatedUnion({
          discriminatorProperty: 'event',
          unionSchemaId: 'AnalyticsEvent',
          variants: {
            click: { type: 'object', properties: { event: { const: 'click' } } },
          },
        })

        const oneOfRef = (result.unionSchema.oneOf as any[])[0].$ref
        expect(oneOfRef).toMatch(/^#\/components\/schemas\//)
      })
    })
  })

  // =========================================================================
  // TIER 2: BOUNDARY & CORNER CASES (>=5 tests per feature)
  // =========================================================================

  describe('Tier 2: Boundary & Corner Cases', () => {
    describe('F1-B: projectDiscriminatedUnion Boundaries', () => {
      it('F1-B1: throws error when variants map is empty ({})', () => {
        expect(() => {
          projectDiscriminatedUnion({
            discriminatorProperty: 'kind',
            unionSchemaId: 'EmptyUnion',
            variants: {},
          })
        }).toThrow(/variant/i)
      })

      it('F1-B2: throws error when unionSchemaId is empty string', () => {
        expect(() => {
          projectDiscriminatedUnion({
            discriminatorProperty: 'kind',
            unionSchemaId: '',
            variants: { a: { type: 'object' } },
          })
        }).toThrow(/unionSchemaId/i)
      })

      it('F1-B3: throws error when discriminatorProperty is empty string', () => {
        expect(() => {
          projectDiscriminatedUnion({
            discriminatorProperty: '',
            unionSchemaId: 'TestUnion',
            variants: { a: { type: 'object' } },
          })
        }).toThrow(/discriminatorProperty/i)
      })

      it('F1-B4: supports single-variant boundary (N=1)', () => {
        const result = projectDiscriminatedUnion({
          discriminatorProperty: 'kind',
          unionSchemaId: 'SingleUnion',
          variants: {
            onlyOne: { type: 'object', properties: { kind: { const: 'onlyOne' } } },
          },
        })
        expect((result.unionSchema.oneOf as any[])).toHaveLength(1)
        expect(Object.keys(result.variantSchemas)).toHaveLength(1)
      })

      it('F1-B5: supports large scale union with 50 distinct variants', () => {
        const variants: Record<string, unknown> = {}
        for (let i = 0; i < 50; i++) {
          variants[`var_${i}`] = {
            type: 'object',
            properties: { kind: { const: `var_${i}` }, index: { type: 'integer' } },
          }
        }

        const result = projectDiscriminatedUnion({
          discriminatorProperty: 'kind',
          unionSchemaId: 'LargeUnion',
          variants,
        })

        expect((result.unionSchema.oneOf as any[])).toHaveLength(50)
        expect(Object.keys(result.variantSchemas)).toHaveLength(50)
      })
    })

    describe('F2-B: RPC Path & Discriminator Name Boundaries', () => {
      it('F2-B1: handles dot-separated RPC method names (e.g. workspace.snapshot.save)', () => {
        const result = projectDiscriminatedUnion({
          discriminatorProperty: 'method',
          unionSchemaId: 'Rpc',
          profile: 'operation-contract',
          pathPrefix: '/rpc',
          variants: {
            'workspace.snapshot.save': { type: 'object', properties: { method: { const: 'workspace.snapshot.save' } } },
          },
        })

        expect(result.paths).toHaveProperty('/rpc/workspace.snapshot.save')
        expect((result.unionSchema.discriminator as any).mapping['workspace.snapshot.save']).toBeDefined()
      })

      it('F2-B2: handles colon-separated RPC method names (e.g. session:connect)', () => {
        const result = projectDiscriminatedUnion({
          discriminatorProperty: 'method',
          unionSchemaId: 'Rpc',
          profile: 'operation-contract',
          pathPrefix: '/rpc',
          variants: {
            'session:connect': { type: 'object', properties: { method: { const: 'session:connect' } } },
          },
        })

        expect(result.paths).toHaveProperty('/rpc/session:connect')
      })

      it('F2-B3: handles hyphenated RPC method names (e.g. custom-action-v2)', () => {
        const result = projectDiscriminatedUnion({
          discriminatorProperty: 'method',
          unionSchemaId: 'Rpc',
          profile: 'operation-contract',
          pathPrefix: '/rpc',
          variants: {
            'custom-action-v2': { type: 'object', properties: { method: { const: 'custom-action-v2' } } },
          },
        })

        expect(result.paths).toHaveProperty('/rpc/custom-action-v2')
      })

      it('F2-B4: normalizes pathPrefix trailing slashes correctly', () => {
        const result = projectDiscriminatedUnion({
          discriminatorProperty: 'method',
          unionSchemaId: 'Rpc',
          profile: 'operation-contract',
          pathPrefix: '/rpc/',
          variants: {
            ping: { type: 'object', properties: { method: { const: 'ping' } } },
          },
        })

        expect(result.paths).toHaveProperty('/rpc/ping')
        expect((result.paths as any)['/rpc//ping']).toBeUndefined()
      })

      it('F2-B5: handles empty or undefined pathPrefix by defaulting to /rpc or /{method}', () => {
        const result = projectDiscriminatedUnion({
          discriminatorProperty: 'method',
          unionSchemaId: 'Rpc',
          profile: 'operation-contract',
          variants: {
            ping: { type: 'object', properties: { method: { const: 'ping' } } },
          },
        })

        expect(result.paths).toBeDefined()
        const keys = Object.keys(result.paths!)
        expect(keys.length).toBeGreaterThan(0)
        expect(keys[0].startsWith('/')).toBe(true)
      })
    })

    describe('F3-B: MCP Protocol Boundaries', () => {
      it('F3-B1: normalizes slash in method name (tools/call) for schema name PascalCase', () => {
        const result = projectDiscriminatedUnion({
          discriminatorProperty: 'method',
          unionSchemaId: 'McpRequest',
          variants: {
            'tools/call': { type: 'object', properties: { method: { const: 'tools/call' } } },
          },
        })

        expect(result.variantSchemas).toHaveProperty('McpRequestToolsCall')
      })

      it('F3-B2: handles multi-segment slashes in method names (a/b/c)', () => {
        const result = projectDiscriminatedUnion({
          discriminatorProperty: 'method',
          unionSchemaId: 'McpRequest',
          variants: {
            'a/b/c': { type: 'object', properties: { method: { const: 'a/b/c' } } },
          },
        })

        expect(result.variantSchemas).toHaveProperty('McpRequestABC')
      })

      it('F3-B3: handles Unicode characters in variant keys', () => {
        const result = projectDiscriminatedUnion({
          discriminatorProperty: 'action',
          unionSchemaId: 'Action',
          variants: {
            '⚡fast': { type: 'object', properties: { action: { const: '⚡fast' } } },
          },
        })

        expect(result.variantSchemas).toBeDefined()
      })

      it('F3-B4: generates unique schema identifiers for overlapping suffixes', () => {
        const result = projectDiscriminatedUnion({
          discriminatorProperty: 'method',
          unionSchemaId: 'Msg',
          variants: {
            'user.get': { type: 'object', properties: { method: { const: 'user.get' } } },
            'user_get': { type: 'object', properties: { method: { const: 'user_get' } } },
          },
        })

        const schemaKeys = Object.keys(result.variantSchemas)
        expect(schemaKeys).toHaveLength(2)
        expect(new Set(schemaKeys).size).toBe(2)
      })

      it('F3-B5: handles variants with additional nested $defs and internal references', () => {
        const result = projectDiscriminatedUnion({
          discriminatorProperty: 'type',
          unionSchemaId: 'Complex',
          variants: {
            nested: {
              type: 'object',
              $defs: { SubType: { type: 'string' } },
              properties: { type: { const: 'nested' }, sub: { $ref: '#/$defs/SubType' } },
            },
          },
        })

        expect(result.variantSchemas).toHaveProperty('ComplexNested')
      })
    })
  })

  // =========================================================================
  // TIER 3: CROSS-FEATURE INTERACTIONS
  // =========================================================================

  describe('Tier 3: Cross-Feature Interactions', () => {
    it('T3-1: projects discriminated union containing x-surface-* vendor extensions', () => {
      const result = projectDiscriminatedUnion({
        discriminatorProperty: 'kind',
        unionSchemaId: 'SurfaceElement',
        variants: {
          block: {
            type: 'object',
            [OPENAPI_SURFACE_ANCHOR_EXTENSION]: {
              id: 'block-anchor-01',
              line: 15,
              column: 2,
            },
            [OPENAPI_SURFACE_FINGERPRINT_EXTENSION]: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            properties: { kind: { const: 'block' }, content: { type: 'string' } },
          },
        },
      })

      const blockSchema = result.variantSchemas.SurfaceElementBlock
      expect(blockSchema[OPENAPI_SURFACE_ANCHOR_EXTENSION]).toBeDefined()
      expect(blockSchema[OPENAPI_SURFACE_FINGERPRINT_EXTENSION]).toBeDefined()
    })

    it('T3-2: projects full API document with both request union and response union', () => {
      const requestUnion = projectDiscriminatedUnion({
        discriminatorProperty: 'method',
        unionSchemaId: 'NativeRpcRequest',
        profile: 'operation-contract',
        pathPrefix: '/rpc',
        variants: {
          'session.hello': { type: 'object', properties: { method: { const: 'session.hello' } } },
        },
      })

      const responseUnion = projectDiscriminatedUnion({
        discriminatorProperty: 'status',
        unionSchemaId: 'NativeRpcResponse',
        profile: 'component-bundle',
        variants: {
          success: { type: 'object', properties: { status: { const: 'success' }, result: { type: 'object' } } },
          error: { type: 'object', properties: { status: { const: 'error' }, message: { type: 'string' } } },
        },
      })

      const fullDoc: OpenApiProjectionResult<Record<string, unknown>> = {
        profile: 'operation-contract',
        projection: {
          openapi: '3.1.0',
          info: { title: 'Multiplexed RPC Service', version: '1.0.0' },
          paths: requestUnion.paths,
          components: {
            schemas: {
              NativeRpcRequest: requestUnion.unionSchema,
              ...requestUnion.variantSchemas,
              NativeRpcResponse: responseUnion.unionSchema,
              ...responseUnion.variantSchemas,
            },
          },
        },
        refs: [],
        diagnostics: [],
        sources: {},
        versionHash: 'sha256:full-service-hash',
      }

      const validation = validateOpenApiProjection(fullDoc)
      expect(validation.valid).toBe(true)
    })
  })

  // =========================================================================
  // TIER 4: REAL-WORLD APPLICATION SCENARIOS
  // =========================================================================

  describe('Tier 4: Real-World Scenarios', () => {
    it('T4-1: Chrome Native Messaging 4-byte RPC Stream Full Protocol Projection', () => {
      // 4 operations representing Browser Studio Chrome Native Messaging backend bridge
      const nativeRpc = projectDiscriminatedUnion({
        discriminatorProperty: 'method',
        unionSchemaId: 'ChromeNativeRpcEnvelope',
        profile: 'operation-contract',
        pathPrefix: '/rpc',
        description: 'Multiplexed length-prefixed Chrome Native Messaging host protocol',
        variants: {
          'session.hello': {
            type: 'object',
            required: ['id', 'method', 'params'],
            properties: {
              id: { type: 'string' },
              method: { type: 'string', const: 'session.hello' },
              params: {
                type: 'object',
                required: ['clientVersion', 'protocolVersion'],
                properties: {
                  clientVersion: { type: 'string' },
                  protocolVersion: { type: 'integer', minimum: 1 },
                },
              },
            },
          },
          'workspace.snapshot.save': {
            type: 'object',
            required: ['id', 'method', 'params'],
            properties: {
              id: { type: 'string' },
              method: { type: 'string', const: 'workspace.snapshot.save' },
              params: {
                type: 'object',
                required: ['workspaceId', 'payload'],
                properties: {
                  workspaceId: { type: 'string' },
                  payload: { type: 'string' },
                },
              },
            },
          },
          'materialize.css': {
            type: 'object',
            required: ['id', 'method', 'params'],
            properties: {
              id: { type: 'string' },
              method: { type: 'string', const: 'materialize.css' },
              params: {
                type: 'object',
                required: ['cssText'],
                properties: {
                  cssText: { type: 'string' },
                  minify: { type: 'boolean' },
                },
              },
            },
          },
          'lease.acquire': {
            type: 'object',
            required: ['id', 'method', 'params'],
            properties: {
              id: { type: 'string' },
              method: { type: 'string', const: 'lease.acquire' },
              params: {
                type: 'object',
                required: ['resource', 'ttlMs'],
                properties: {
                  resource: { type: 'string' },
                  ttlMs: { type: 'integer', minimum: 1000 },
                },
              },
            },
          },
        },
      })

      // Verify discriminator structure
      const discriminator = nativeRpc.unionSchema.discriminator as any
      expect(discriminator.propertyName).toBe('method')
      expect(discriminator.mapping['session.hello']).toBe('#/components/schemas/ChromeNativeRpcEnvelopeSessionHello')
      expect(discriminator.mapping['workspace.snapshot.save']).toBe('#/components/schemas/ChromeNativeRpcEnvelopeWorkspaceSnapshotSave')
      expect(discriminator.mapping['materialize.css']).toBe('#/components/schemas/ChromeNativeRpcEnvelopeMaterializeCss')
      expect(discriminator.mapping['lease.acquire']).toBe('#/components/schemas/ChromeNativeRpcEnvelopeLeaseAcquire')

      // Verify all 4 operations are registered in paths
      expect(nativeRpc.paths).toHaveProperty('/rpc/session.hello')
      expect(nativeRpc.paths).toHaveProperty('/rpc/workspace.snapshot.save')
      expect(nativeRpc.paths).toHaveProperty('/rpc/materialize.css')
      expect(nativeRpc.paths).toHaveProperty('/rpc/lease.acquire')

      // Verify validation passes
      const envelope: OpenApiProjectionResult<Record<string, unknown>> = {
        profile: 'operation-contract',
        projection: {
          openapi: '3.1.0',
          info: { title: 'Chrome Native Messaging Bridge', version: '1.0.0' },
          paths: nativeRpc.paths,
          components: {
            schemas: {
              ChromeNativeRpcEnvelope: nativeRpc.unionSchema,
              ...nativeRpc.variantSchemas,
            },
          },
        },
        refs: [],
        diagnostics: [],
        sources: {},
        versionHash: 'sha256:chrome-native-rpc-hash',
      }
      expect(validateOpenApiProjection(envelope).valid).toBe(true)
    })

    it('T4-2: MCP Stdio Server Protocol Contract Complete Projection Pipeline', () => {
      const mcpProjection = projectDiscriminatedUnion({
        discriminatorProperty: 'method',
        unionSchemaId: 'DevLinkMcpControlRequestV1',
        profile: 'operation-contract',
        pathPrefix: '/mcp/v1',
        description: 'Model Context Protocol stdio JSON-RPC 2.0 operational contract',
        variants: {
          'tools/list': {
            type: 'object',
            required: ['jsonrpc', 'id', 'method'],
            properties: {
              jsonrpc: { type: 'string', const: '2.0' },
              id: { type: 'string' },
              method: { type: 'string', const: 'tools/list' },
              params: { type: 'object' },
            },
          },
          'tools/call': {
            type: 'object',
            required: ['jsonrpc', 'id', 'method', 'params'],
            properties: {
              jsonrpc: { type: 'string', const: '2.0' },
              id: { type: 'string' },
              method: { type: 'string', const: 'tools/call' },
              params: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string' },
                  arguments: { type: 'object' },
                },
              },
            },
          },
          'resources/read': {
            type: 'object',
            required: ['jsonrpc', 'id', 'method', 'params'],
            properties: {
              jsonrpc: { type: 'string', const: '2.0' },
              id: { type: 'string' },
              method: { type: 'string', const: 'resources/read' },
              params: {
                type: 'object',
                required: ['uri'],
                properties: { uri: { type: 'string' } },
              },
            },
          },
        },
      })

      expect(mcpProjection.paths).toHaveProperty('/mcp/v1/tools/list')
      expect(mcpProjection.paths).toHaveProperty('/mcp/v1/tools/call')
      expect(mcpProjection.paths).toHaveProperty('/mcp/v1/resources/read')

      const validation = validateOpenApiProjection({
        profile: 'operation-contract',
        projection: {
          openapi: '3.1.0',
          info: { title: 'MCP Stdio Protocol Server', version: '1.0.0' },
          paths: mcpProjection.paths,
          components: {
            schemas: {
              DevLinkMcpControlRequestV1: mcpProjection.unionSchema,
              ...mcpProjection.variantSchemas,
            },
          },
        },
        refs: [],
        diagnostics: [],
        sources: {},
        versionHash: 'sha256:mcp-stdio-contract-hash',
      })
      expect(validation.valid).toBe(true)
    })
  })
})
